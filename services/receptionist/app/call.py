from __future__ import annotations

import logging
import time
from pathlib import Path

from .api import VocivoApi
from .brain import Assistant, Brain, Conversation, Decision
from .config import Settings
from .esl import EslConnection, channel_variable
from .speech import Ears, Voice, recording_has_audio

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

        await connection.execute("answer")
        # Narrowband is what the caller hears anyway, and it keeps recordings
        # small enough that transcription starts the moment they stop talking.
        await connection.set("record_sample_rate", "8000")
        await connection.set("playback_terminators", "none")

        conversation = Conversation(assistant=assistant, caller_number=caller)
        started = time.time()
        outcome = "completed"
        transferred_to = ""

        try:
            await self._speak(connection, assistant.greeting, assistant.voice)
            conversation.add("assistant", assistant.greeting)

            silent_turns = 0
            for _ in range(self._settings.max_turns):
                if connection.hungup.is_set():
                    outcome = "caller_hung_up"
                    break

                heard = await self._listen(connection, call_id)
                if not heard:
                    silent_turns += 1
                    if silent_turns == 1:
                        await self._speak(connection, "Sorry, I couldn't hear you. Are you still there?", assistant.voice)
                        continue
                    # Twice in a row is a bad line or an empty room. Hand the
                    # caller to a person rather than asking a third time.
                    outcome = "no_speech"
                    if assistant.transfer_enabled and assistant.fallback_extension:
                        await self._speak(connection, "I'll put you through to someone.", assistant.voice)
                        transferred_to = assistant.fallback_extension
                        await self._transfer(connection, assistant.fallback_extension)
                        outcome = "transferred"
                    else:
                        await self._speak(connection, "I'll let the team know you called. Goodbye.", assistant.voice)
                        await connection.hangup()
                    break

                silent_turns = 0
                conversation.add("caller", heard)
                decision = await self._brain.respond(conversation)
                conversation.add("assistant", decision.say)
                await self._act(connection, assistant, decision)

                if decision.action == "transfer":
                    transferred_to = decision.extension
                    outcome = "transferred"
                    break
                if decision.action == "message":
                    outcome = "message_taken"
                    break
                if decision.action == "hangup":
                    outcome = "completed"
                    break
            else:
                # The turn budget exists so a stuck conversation cannot hold a
                # line open indefinitely.
                outcome = "turn_limit"
                await self._speak(connection, "Let me pass this on to the team. Thanks for calling.", assistant.voice)
                await connection.hangup()
        except Exception as error:  # noqa: BLE001 - never leave a caller on a dead line
            log.exception("call %s failed: %s", call_id[:8], error)
            outcome = "error"
            try:
                await connection.hangup()
            except Exception:  # noqa: BLE001
                pass
        finally:
            await self._api.record_conversation({
                "callId": call_id,
                "number": dialled,
                "caller": caller,
                "outcome": outcome,
                "transferredTo": transferred_to,
                "seconds": round(time.time() - started, 1),
                "transcript": conversation.transcript(),
                "note": next((turn.text for turn in reversed(conversation.turns) if turn.role == "assistant"), ""),
            })
            await connection.close()

    # -- the two halves of a turn ---------------------------------------

    async def _speak(self, connection: EslConnection, text: str, voice: str) -> None:
        if not text.strip():
            return
        try:
            path = await self._voice.say(text, voice)
        except Exception as error:  # noqa: BLE001
            # Losing the voice engine mid-call is survivable; losing the call is not.
            log.error("could not synthesise %r: %s", text[:60], error)
            return
        await connection.execute("playback", str(path), timeout=self._settings.greeting_timeout + 40)

    async def _listen(self, connection: EslConnection, call_id: str) -> str:
        path = Path(self._settings.audio_dir) / "turns" / f"{call_id}-{int(time.time() * 1000)}.wav"
        path.parent.mkdir(parents=True, exist_ok=True)
        argument = " ".join([
            str(path),
            str(self._settings.listen_seconds),
            str(self._settings.silence_threshold),
            str(self._settings.silence_seconds),
        ])
        await connection.execute("record", argument, timeout=self._settings.listen_seconds + 10)
        if not recording_has_audio(path):
            self._discard(path)
            return ""
        heard = await self._ears.transcribe(path)
        self._discard(path)
        log.info("call %s heard %r", call_id[:8], heard[:120])
        return heard

    def _discard(self, path: Path) -> None:
        # A caller's voice is not kept: the transcript is what the tenant sees.
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass

    async def _act(self, connection: EslConnection, assistant: Assistant, decision: Decision) -> None:
        await self._speak(connection, decision.say, assistant.voice)
        if decision.action == "transfer":
            await self._transfer(connection, decision.extension)
        elif decision.action in {"message", "hangup"}:
            await connection.hangup()

    async def _transfer(self, connection: EslConnection, extension: str) -> None:
        # Blind transfer back into the dialplan: the same rules that route an
        # ordinary internal call decide where this one lands, so a receptionist
        # can never reach somewhere a colleague could not.
        await connection.execute("transfer", f"{extension} XML default", timeout=10)
