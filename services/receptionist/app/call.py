from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path

from .api import VocivoApi
from .brain import Assistant, Brain, Conversation, Decision
from .config import Settings
from .esl import EslConnection, channel_variable
from .speech import CANNED, FILLERS, Ears, SpeechRecognitionError, Voice, drop_hallucinated_transcript, recording_stats, split_sentences

log = logging.getLogger("vocivo.call")

# One call, start to finish. Answer, greet, then take turns: listen until the
# caller stops talking, transcribe, think, speak. Transfer to a person the
# moment the caller wants one.


class CallHandler:
    def __init__(self, settings: Settings, voice: Voice, ears: Ears, brain: Brain, api: VocivoApi):
        self._settings = settings
        self._voice = voice
        self._ears = ears
        self._brain = brain
        self._api = api
        self._filler_index = 0

    async def handle(self, connection: EslConnection) -> None:
        channel = await connection.connect()
        call_id = connection.uuid
        caller = channel_variable(channel, "Caller-Caller-ID-Number", "caller_id_number", "sip_from_user")
        dialled = channel_variable(channel, "Caller-Destination-Number", "destination_number", "sip_to_user")
        log.info("call %s from %s to %s", call_id[:8], caller or "unknown", dialled or "unknown")

        assistant = await self._api.assistant_for(dialled, caller)
        if assistant is None:
            log.warning("no receptionist is configured for %s; releasing the call", dialled)
            await connection.hangup("NO_ROUTE_DESTINATION")
            return

        # Everything this receptionist may say besides the greeting and the
        # model's answers is rendered now, in the background, so none of it is
        # a cold render later in the call.
        asyncio.create_task(self._voice.prerender([*CANNED.values(), *FILLERS], assistant.voice))

        if channel_variable(channel, "Answer-State").lower() != "answered":
            await connection.execute("answer")
            # The carrier's media takes a moment to arrive after the answer; a
            # greeting that starts before it does loses its first word or two.
            # The dialplan usually answers before handing the call over, and
            # then this pause has already happened.
            await connection.execute("sleep", "400", timeout=5)
        # Narrowband is what the caller hears anyway, and it keeps recordings
        # small enough that transcription starts the moment they stop talking.
        await connection.set("record_sample_rate", "8000")
        await connection.set("playback_terminators", "none")
        # Only the caller's side. The recorder mixes both directions by default,
        # so our own prompts and their echo were in every turn recording — the
        # recogniser heard the greeting back and answered it.
        await connection.set("RECORD_READ_ONLY", "true")
        # The recorder deletes anything shorter than RECORD_MIN_SEC (three
        # seconds by default) as if nothing had been said. "Yes." is a second
        # long: the caller answered and was asked again.
        await connection.set("RECORD_MIN_SEC", "0")

        conversation = Conversation(assistant=assistant, caller_number=caller)
        started = time.time()
        outcome = "completed"
        transferred_to = ""
        notes: list[str] = []

        try:
            if channel_variable(channel, "variable_vocivo_transfer_failed", "vocivo_transfer_failed") == "1":
                # Back from a transfer nobody answered. The caller already has
                # our attention; say so and carry on rather than greeting again.
                conversation.add("assistant", assistant.greeting)
                conversation.add("caller", "(the caller asked to be put through, and the receptionist transferred the call)")
                conversation.add("assistant", CANNED["transfer_unanswered"])
                await self._speak(connection, CANNED["transfer_unanswered"], assistant.voice)
            else:
                await self._speak(connection, assistant.greeting, assistant.voice)
                conversation.add("assistant", assistant.greeting)

            silent_turns = 0
            # No turn budget: the conversation lasts as long as the caller
            # needs it to. A line nobody is talking on is still released — two
            # silent turns in a row transfer or end the call below — and the
            # caller hanging up ends it at once.
            while True:
                if connection.hungup.is_set():
                    outcome = "caller_hung_up"
                    break

                try:
                    heard = await self._listen(connection, call_id, assistant)
                except SpeechRecognitionError:
                    if connection.hungup.is_set():
                        outcome = "caller_hung_up"
                        break
                    silent_turns = 0
                    await self._speak(connection, "Sorry, I couldn't process that. Could you repeat that, please?", assistant.voice)
                    continue
                if connection.hungup.is_set():
                    outcome = "caller_hung_up"
                    break
                if not heard:
                    silent_turns += 1
                    if silent_turns == 1:
                        await self._speak(connection, CANNED["not_heard"], assistant.voice)
                        continue
                    # Twice in a row is a bad line or an empty room. Hand the
                    # caller to a person rather than asking a third time.
                    outcome = "no_speech"
                    if assistant.transfer_enabled and assistant.fallback_extension:
                        await self._speak(connection, CANNED["transfer_fallback"], assistant.voice)
                        transferred_to = assistant.fallback_extension
                        await self._transfer(connection, assistant.fallback_extension, dialled)
                        outcome = "transferred"
                    else:
                        await self._speak(connection, CANNED["goodbye_no_speech"], assistant.voice)
                        await connection.hangup()
                    break

                silent_turns = 0
                conversation.add("caller", heard)
                decision = await self._think(connection, conversation, assistant.voice)
                conversation.add("assistant", decision.say)
                await self._act(connection, assistant, decision, dialled)

                if decision.action == "transfer":
                    transferred_to = decision.extension
                    outcome = "transferred"
                    break
                if decision.action == "message":
                    outcome = "message_taken"
                    if decision.note:
                        notes.append(decision.note)
                    continue
                if decision.action == "hangup":
                    outcome = "message_taken" if notes else "completed"
                    break
        except Exception as error:  # noqa: BLE001 - never leave a caller on a dead line
            log.exception("call %s failed: %s", call_id[:8], error)
            outcome = "error"
            try:
                await connection.hangup()
            except Exception:  # noqa: BLE001
                log.exception("call %s could not be terminated after failure", call_id[:8])
        finally:
            log.info("call %s ended: %s after %.0fs, %d turns%s", call_id[:8], outcome, time.time() - started, len(conversation.turns), f", transferred to {transferred_to}" if transferred_to else "")
            try:
                await self._api.record_conversation({
                    "callId": call_id,
                    "number": dialled,
                    "caller": caller,
                    "outcome": outcome,
                    "transferredTo": transferred_to,
                    "seconds": round(time.time() - started, 1),
                    "transcript": conversation.transcript(),
                    "note": "\n".join(notes),
                })
            finally:
                await connection.close()

    # -- the two halves of a turn ---------------------------------------

    async def _speak(self, connection: EslConnection, text: str, voice: str) -> None:
        """
        Says `text` a sentence at a time: while one sentence plays, the next is
        rendering, so the caller hears the answer start after one sentence's
        worth of synthesis rather than the whole answer's.
        """
        parts = split_sentences(text)
        if not parts:
            return
        rendering: asyncio.Task[Path] = asyncio.create_task(self._voice.say(parts[0], voice))
        for index, part in enumerate(parts):
            if connection.hungup.is_set():
                rendering.cancel()
                return
            try:
                path = await rendering
            except Exception as error:  # noqa: BLE001
                # Losing the voice engine mid-call is survivable; losing the call is not.
                log.error("could not synthesise %r: %s", part[:60], error)
                path = None
            if index + 1 < len(parts):
                rendering = asyncio.create_task(self._voice.say(parts[index + 1], voice))
            if path is not None:
                await connection.execute("playback", str(path), timeout=self._settings.greeting_timeout + 40)

    async def _think(self, connection: EslConnection, conversation: Conversation, voice: str) -> Decision:
        """
        Asks the model while saying a short filler.

        The model and the voice engine together take a few seconds; the filler
        covers most of that, and tells the caller they were heard. The answer's
        own synthesis starts as soon as the model replies, before the filler
        has finished, so the two overlap rather than add up.
        """
        # The model streams. Its first sentence goes to the voice engine the
        # moment it is complete — usually well under a second in — so by the
        # time the whole answer has arrived the opening is already on disk and
        # playback starts at once. Previously synthesis began only after the
        # entire reply, and that serial wait was most of the pause before every
        # answer.
        first_ready = asyncio.Event()
        early: list[asyncio.Task[Path]] = []

        def render_first(sentence: str) -> None:
            if not early:
                early.append(asyncio.create_task(self._voice.say(sentence, voice)))
            first_ready.set()

        thinking_started = time.monotonic()
        thinking = asyncio.create_task(self._brain.respond(conversation, render_first))
        # A filler ("one moment") only when the model has not even begun to
        # answer after a few seconds — the same phrase at the top of every
        # reply is what made the receptionist sound scripted, so it is kept
        # for the turns that would otherwise be dead air, and only those.
        waiter = asyncio.create_task(first_ready.wait())
        done, _ = await asyncio.wait({thinking, waiter}, timeout=3.0, return_when=asyncio.FIRST_COMPLETED)
        if not done:
            filler = FILLERS[self._filler_index % len(FILLERS)]
            self._filler_index += 1
            await self._speak(connection, filler, voice)
        decision = await thinking
        waiter.cancel()
        model_seconds = time.monotonic() - thinking_started
        if early:
            try:
                await early[0]
            except Exception as error:  # noqa: BLE001 - _speak reports the failure when it tries again
                log.debug("early render failed: %s", error)
        log.info(
            "model answered in %.1fs (%s), first sentence ready %.1fs after the caller finished%s",
            model_seconds, decision.action, time.monotonic() - thinking_started, "" if early else " (no early render)",
        )
        return decision

    async def _listen(self, connection: EslConnection, call_id: str, assistant: Assistant) -> str:
        """
        Waits for the caller to say something, then transcribes it.

        The recorder stops after `silence_seconds` of quiet, counted from the
        very start, so a caller who takes three seconds to begin used to be
        told "I couldn't hear you" — the receptionist looked as if it never
        listened. Empty recordings are simply started again until the caller
        speaks or `patience_seconds` have gone by.
        """
        deadline = time.monotonic() + self._settings.patience_seconds
        while True:
            path = Path(self._settings.audio_dir) / "turns" / f"{call_id}-{int(time.time() * 1000)}.wav"
            path.parent.mkdir(parents=True, exist_ok=True)
            argument = " ".join([
                str(path),
                str(self._settings.listen_seconds),
                str(self._settings.silence_threshold),
                str(self._settings.silence_seconds),
            ])
            recording_started = time.monotonic()
            await connection.execute("record", argument, timeout=self._settings.listen_seconds + 10)
            recorded_for = time.monotonic() - recording_started
            stats = recording_stats(path)
            if stats.has_audio:
                break
            log.info("call %s nothing yet (%.1fs, rms %d)", call_id[:8], recorded_for, stats.rms)
            self._discard(path)
            if connection.hungup.is_set() or time.monotonic() >= deadline:
                return ""
        hints = [assistant.name, *(target.label for target in assistant.targets)]
        transcribing = time.monotonic()
        try:
            heard = await self._ears.transcribe(path, assistant.language, hints)
        finally:
            self._discard(path)
        raw = heard
        heard = drop_hallucinated_transcript(heard, [assistant.greeting, assistant.name, *hints])
        if raw.strip() and not heard:
            log.info("call %s dropped %r as an echo or a recogniser filler", call_id[:8], raw[:120])
        # Timing per turn, so a slow answer can be blamed on the right stage
        # from the logs alone: how long the recorder ran (and whether it hit
        # its limit instead of hearing silence), and how long recognition took.
        log.info(
            "call %s heard %r (recorded %.1fs%s, rms %d, transcribed in %.1fs)",
            call_id[:8], heard[:120], recorded_for,
            " — hit the time limit, silence was never detected" if recorded_for >= self._settings.listen_seconds - 0.5 else "",
            stats.rms, time.monotonic() - transcribing,
        )
        return heard

    def _discard(self, path: Path) -> None:
        # A caller's voice is not kept: the transcript is what the tenant sees.
        try:
            path.unlink(missing_ok=True)
        except OSError:
            log.exception("could not remove temporary caller recording")

    async def _act(self, connection: EslConnection, assistant: Assistant, decision: Decision, dialled: str) -> None:
        await self._speak(connection, decision.say, assistant.voice)
        if decision.action == "transfer":
            await self._transfer(connection, decision.extension, dialled)
        elif decision.action == "hangup":
            await connection.hangup()

    async def _transfer(self, connection: EslConnection, extension: str, dialled: str) -> None:
        """
        Hands the call to the API's dialplan as if the caller had keyed the
        extension at the menu: the API resolves the extension to the phone
        registered for it, plays the waiting message, rings it, and falls to
        voicemail or the main line by the tenant's own rules.

        (A transfer into the switch's `default` context by extension number
        dialled the number as a SIP address, which is registered to nobody —
        the switch said "not found" and hung up on the caller.)
        """
        await connection.set("vocivo_stage", "ext-select")
        await connection.set("vocivo_digit", "".join(character for character in extension if character.isdigit())[:5])
        # If nobody answers, the dialplan hands the caller back here (see
        # sip-dialplan backToReceptionistActions) instead of to a recording.
        await connection.set("vocivo_from_receptionist", "1")
        await connection.set("vocivo_transfer_failed", "")
        await connection.execute("transfer", f"{dialled or extension} XML public", timeout=10)
