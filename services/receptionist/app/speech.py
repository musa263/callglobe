from __future__ import annotations

import asyncio
import hashlib
import logging
import wave
from pathlib import Path

import httpx

from .config import Settings

log = logging.getLogger("vocivo.speech")

# Speech in and speech out, both on Vocivo's own hardware. Recognition is
# faster-whisper running in this container; synthesis is the Kokoro service
# already on the SIP edge, reached over loopback.


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
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0))

    async def close(self) -> None:
        await self._client.aclose()

    def _path_for(self, text: str, voice: str) -> Path:
        digest = hashlib.sha256(f"{voice}\n{text}".encode("utf-8")).hexdigest()[:32]
        return self._dir / f"{digest}.wav"

    async def say(self, text: str, voice: str | None = None) -> Path:
        chosen = voice or self._settings.tts_voice
        path = self._path_for(text, chosen)
        if path.exists() and path.stat().st_size > 0:
            return path
        response = await self._client.post(
            f"{self._settings.tts_url}/v1/audio/render",
            headers={"Authorization": f"Bearer {self._settings.tts_secret}"},
            json={"input": text, "voice": chosen},
        )
        response.raise_for_status()
        # Written beside the target and moved into place, so a prompt half
        # written while another call reads the same path can never be played.
        staging = path.with_suffix(".partial")
        staging.write_bytes(response.content)
        staging.replace(path)
        return path


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

    async def transcribe(self, path: Path) -> str:
        if not path.exists() or path.stat().st_size == 0:
            return ""
        model = await self._load()

        def run() -> str:
            segments, _ = model.transcribe(
                str(path),
                language=self._settings.stt_language or None,
                beam_size=1,
                # Phone audio is narrowband and noisy; the VAD filter keeps
                # line noise from being transcribed as words.
                vad_filter=True,
                condition_on_previous_text=False,
            )
            return " ".join(segment.text.strip() for segment in segments).strip()

        try:
            return await asyncio.to_thread(run)
        except Exception as error:  # noqa: BLE001 - a failed transcription must not end the call
            log.warning("could not transcribe %s: %s", path.name, error)
            return ""


def recording_has_audio(path: Path, *, minimum_seconds: float = 0.35) -> bool:
    """
    Cheap guard before spending a transcription on silence.

    FreeSWITCH writes a valid but almost empty file when a caller says nothing,
    and running the model over it costs a second of the caller's patience for a
    result that is always the empty string.
    """
    try:
        with wave.open(str(path), "rb") as handle:
            frames = handle.getnframes()
            rate = handle.getframerate() or 8000
            return frames / rate >= minimum_seconds
    except (wave.Error, OSError):
        return path.exists() and path.stat().st_size > 4096
