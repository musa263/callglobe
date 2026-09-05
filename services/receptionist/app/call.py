from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path

from .api import VocivoApi
from .brain import Assistant, Brain, Conversation, Decision
from .config import Settings
from .esl import EslConnection, channel_variable
from .speech import CANNED, FILLERS, Ears, SpeechRecognitionError, Voice, recording_has_audio, split_sentences

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

        conversation = Conversation(assistant=assistant, caller_number=caller)
        started = time.time()
        outcome = "completed"
        transferred_to = ""
        notes: list[str] = []

        try:
            await self._speak(connection, assistant.greeting, assistant.voice)
            conversation.add("assistant", assistant.greeting)

            silent_turns = 0
            for _ in range(self._settings.max_turns):
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
            else:
                # The turn budget exists so a stuck conversation cannot hold a
                # line open indefinitely.
                outcome = "turn_limit"
                await self._speak(connection, CANNED["turn_limit"], assistant.voice)
                await connection.hangup()
        except Exception as error:  # noqa: BLE001 - never leave a caller on a dead line
            log.exception("call %s failed: %s", call_id[:8], error)
            outcome = "error"
            try:
                await connection.hangup()
            except Exception:  # noqa: BLE001
                log.exception("call %s could not be terminated after failure", call_id[:8])
        finally:
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
        thinking = asyncio.create_task(self._brain.respond(conversation))
        # A quick reply ("yes", "goodbye") comes back before a filler would be
        # worth saying, and "one moment" before "goodbye" sounds wrong. The
        # filler is what made the receptionist sound scripted — the same three
        # phrases at the top of every answer — so it is kept for the turns
        # that would otherwise be dead air, and only those.
        done, _ = await asyncio.wait({thinking}, timeout=2.5)
        if not done:
            filler = FILLERS[self._filler_index % len(FILLERS)]
            self._filler_index += 1
            await self._speak(connection, filler, voice)
        decision = await thinking
        first = split_sentences(decision.say)[:1]
        if first:
            # Start rendering the opening sentence now; _speak finds it on disk.
            try:
                await self._voice.say(first[0], voice)
            except Exception as error:  # noqa: BLE001 - _speak reports the failure when it tries again
                log.debug("early render failed: %s", error)
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
            await connection.execute("record", argument, timeout=self._settings.listen_seconds + 10)
            if recording_has_audio(path):
                break
            self._discard(path)
            if connection.hungup.is_set() or time.monotonic() >= deadline:
                return ""
        hints = [assistant.name, *(target.label for target in assistant.targets)]
        try:
            heard = await self._ears.transcribe(path, assistant.language, hints)
        finally:
            self._discard(path)
        log.info("call %s heard %r", call_id[:8], heard[:120])
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
        await connection.execute("transfer", f"{dialled or extension} XML public", timeout=10)
