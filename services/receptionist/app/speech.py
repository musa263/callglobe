from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import re
import struct
import tempfile
import wave
from pathlib import Path

import httpx

from .config import Settings

log = logging.getLogger("vocivo.speech")

# Speech in and speech out, both on Vocivo's own hardware. Recognition is
# faster-whisper running in this container; synthesis is the Kokoro service
# already on the SIP edge, reached over loopback.


# Everything the receptionist says that is not the tenant's greeting or the
# model's answer. Kept in one place so the API can have them rendered in the
# tenant's voice when the receptionist is saved (frontend/api/_lib/receptionist.ts
# carries the same list), and the first caller never waits for them.
CANNED = {
    "not_heard": "Sorry, I couldn't hear you. Are you still there?",
    "transfer_fallback": "I'll put you through to someone.",
    "goodbye_no_speech": "I'll let the team know you called. Goodbye.",
    "turn_limit": "Let me pass this on to the team. Thanks for calling.",
}

# Said while the language model and the voice engine work on the real answer:
# three to eight seconds of dead air after a question is what makes callers
# hang up or repeat themselves. Short, so the answer follows almost at once.
FILLERS = (
    "One moment.",
    "Let me check that for you.",
    "Sure, one second.",
)


_SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")


def split_sentences(text: str, *, minimum: int = 12, maximum_parts: int = 8) -> list[str]:
    """
    Breaks an answer into the pieces it is spoken in.

    The engine renders roughly a third of real time on the edge's share of the
    CPU, so a three-sentence answer rendered whole is fifteen seconds of dead
    air. Rendered a sentence at a time, the first is playing while the second
    renders, and the caller hears the answer begin after one sentence's worth.
    Short fragments ("Yes.") are joined to their neighbour so nothing is a
    file of half a second, and each part is cached on its own — "Thanks for
    calling." rendered once serves every answer that ends with it.
    """
    cleaned = " ".join(text.split())
    if not cleaned:
        return []
    parts: list[str] = []
    for piece in _SENTENCE_END.split(cleaned):
        piece = piece.strip()
        if not piece:
            continue
        if parts and (len(parts[-1]) < minimum or len(piece) < minimum):
            parts[-1] = f"{parts[-1]} {piece}"
        else:
            parts.append(piece)
    if len(parts) > maximum_parts:
        head, tail = parts[: maximum_parts - 1], " ".join(parts[maximum_parts - 1 :])
        parts = [*head, tail]
    return parts


class Voice:
    """
    Turns text into a file FreeSWITCH can play.

    Prompts are content-addressed and kept: a receptionist says "Thanks, please
    hold" thousands of times, and synthesising it once is the difference
    between a natural pause and a second of dead air on every call.
    """

    def __init__(self, settings: Settings):
        self._settings = settings
        self._dir = Path(settings.audio_dir) / "prompts"
        self._dir.mkdir(parents=True, exist_ok=True)
        # A prompt the engine has never rendered can take several seconds on
        # the SIP edge's share of the CPU; giving up at twenty meant a long
        # answer was sometimes replaced by silence.
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=5.0))

    async def close(self) -> None:
        await self._client.aclose()

    def _path_for(self, text: str, voice: str) -> Path:
        digest = hashlib.sha256(f"{voice}\n{text}".encode("utf-8")).hexdigest()[:32]
        return self._dir / f"{digest}.wav"

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._settings.tts_secret}"}

    async def say(self, text: str, voice: str | None = None) -> Path:
        chosen = voice or self._settings.tts_voice
        path = self._path_for(text, chosen)
        if path.exists():
            try:
                with wave.open(str(path), "rb") as cached:
                    if cached.getnframes() > 0 and cached.getframerate() > 0:
                        return path
            except (OSError, EOFError, wave.Error):
                log.warning("discarding invalid cached speech audio")
        # /v1/audio/speech answers with the WAV itself. (/v1/audio/render
        # answers with JSON naming a public URL — the first deploy wrote that
        # JSON into a .wav and every word the receptionist said was silence.)
        response = await self._client.post(
            f"{self._settings.tts_url}/v1/audio/speech",
            headers=self._headers(),
            json={"input": text, "voice": chosen, "format": "wav"},
        )
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        if "audio" not in content_type or len(response.content) < 64 or not response.content.startswith(b"RIFF"):
            raise RuntimeError(f"voice engine answered with {content_type or 'no content type'}, not audio")
        # Written beside the target and moved into place, so a prompt half
        # written while another call reads the same path can never be played.
        # Concurrent calls can request the same phrase. Each writer needs its
        # own staging file; otherwise one rename removes another writer's file.
        with tempfile.NamedTemporaryFile(dir=self._dir, suffix=".partial", delete=False) as output:
            staging = Path(output.name)
            output.write(response.content)
        try:
            staging.replace(path)
        finally:
            staging.unlink(missing_ok=True)
        return path

    async def prerender(self, texts: list[str], voice: str | None = None) -> None:
        """
        Asks the engine to have these ready, without waiting for it.

        Used for the canned phrases in a tenant's voice the moment a call for
        that tenant arrives: by the time the greeting has been said, "Sorry, I
        couldn't hear you" is on disk at the engine and plays without a pause.
        """
        chosen = voice or self._settings.tts_voice
        # Rendered in the pieces they are spoken in, so the cache the call
        # reads is the cache this fills.
        pieces = [part for text in texts for part in split_sentences(text)]
        items = [{"input": part, "voice": chosen, "format": "wav"} for part in dict.fromkeys(pieces)]
        if not items:
            return
        try:
            await self._client.post(
                f"{self._settings.tts_url}/v1/audio/prerender",
                headers=self._headers(),
                json={"items": items},
                timeout=httpx.Timeout(5.0, connect=2.0),
            )
        except httpx.HTTPError as error:
            # Purely an optimisation; the phrases render on demand if this fails.
            log.debug("could not pre-render %d phrases: %s", len(items), error)


class SpeechRecognitionError(RuntimeError):
    """Recognition failed; this is not evidence that the caller was silent."""


class Ears:
    """
    faster-whisper, loaded once and shared by every call on this process.

    Transcription is CPU-bound and would otherwise block the event loop that is
    also running live calls, so it is dispatched to a worker thread.
    """

    def __init__(self, settings: Settings):
        self._settings = settings
        self._model = None
        self._lock = asyncio.Lock()

    async def _load(self):
        if self._model is not None:
            return self._model
        async with self._lock:
            if self._model is None:
                from faster_whisper import WhisperModel  # imported late: it pulls in torch-sized deps

                log.info("loading speech recognition model %s (%s)", self._settings.stt_model, self._settings.stt_compute_type)
                self._model = await asyncio.to_thread(
                    WhisperModel,
                    self._settings.stt_model,
                    device="cpu",
                    compute_type=self._settings.stt_compute_type,
                )
        return self._model

    async def warm(self) -> None:
        """Loads the model at start-up rather than during the first call."""
        await self._load()

    async def transcribe(self, path: Path, language: str | None = None, hints: list[str] | None = None) -> str:
        """
        The caller's words. `language` is the tenant's receptionist language
        (en, fr, es, ...); without it recognition was pinned to English and a
        French receptionist heard nonsense. `hints` are names the caller is
        likely to say — the business, the people it can transfer to — which
        the recogniser otherwise turns into the nearest common word ("Musa"
        came out as "Mozart").
        """
        if not path.exists() or path.stat().st_size == 0:
            return ""
        try:
            model = await self._load()
        except Exception as error:
            log.exception("speech recognition model could not be loaded")
            raise SpeechRecognitionError("Speech recognition is temporarily unavailable") from error
        spoken = (language or self._settings.stt_language or "").strip().lower()[:2] or None
        names = [hint.strip() for hint in (hints or []) if hint and hint.strip()]
        prompt = f"Phone call to {', '.join(dict.fromkeys(names))}." if names else None

        def run() -> str:
            segments, _ = model.transcribe(
                str(path),
                language=spoken,
                initial_prompt=prompt,
                beam_size=1,
                # Phone audio is narrowband and noisy; the VAD filter keeps
                # line noise from being transcribed as words.
                vad_filter=True,
                condition_on_previous_text=False,
            )
            return " ".join(segment.text.strip() for segment in segments).strip()

        try:
            return await asyncio.to_thread(run)
        except Exception as error:  # noqa: BLE001 - distinguish failures from silence
            log.exception("speech recognition failed")
            raise SpeechRecognitionError("Speech recognition is temporarily unavailable") from error


def recording_has_audio(path: Path, *, minimum_seconds: float = 0.35, minimum_rms: int = 120) -> bool:
    """
    Cheap guard before spending a transcription on silence.

    FreeSWITCH's recorder stops after its silence window whether or not the
    caller ever spoke, so a caller who has not started yet produces a
    two-second file of line noise. Its length says nothing; its energy does.
    A file that is long enough *and* louder than line noise is worth a
    transcription; anything else is "nothing yet" and is listened for again.
    """
    try:
        with wave.open(str(path), "rb") as handle:
            frames = handle.getnframes()
            rate = handle.getframerate() or 8000
            if frames / rate < minimum_seconds:
                return False
            width = handle.getsampwidth()
            samples = handle.readframes(frames)
    except (wave.Error, OSError):
        return path.exists() and path.stat().st_size > 4096
    if width != 2 or not samples:
        return True
    return _rms(samples) >= minimum_rms


def _rms(samples: bytes) -> float:
    """Root mean square of 16-bit little-endian PCM, without numpy."""
    count = len(samples) // 2
    if not count:
        return 0.0
    total = 0
    for value in struct.unpack(f"<{count}h", samples[: count * 2]):
        total += value * value
    return math.sqrt(total / count)
