from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.brain import Assistant, Conversation, Decision, TransferTarget
from app.call import CallHandler
from app.config import Settings
from app.esl import EslConnection
from app.speech import CANNED, FILLERS, SpeechRecognitionError

# A whole call, over a real socket, against the real EslConnection and
# CallHandler. Only the four things that reach outside the process are faked:
# the API, the voice, the recogniser and the model.
#
# This is the test that would have caught the two Event Socket faults fixed
# after the first pass — neither was visible from unit-testing the pieces.


class FakeFreeswitch:
    """
    The other end of the Event Socket, behaving the way FreeSWITCH does.

    Every `sendmsg` is acknowledged with +OK and then completed with a
    CHANNEL_EXECUTE_COMPLETE for that application, which is exactly the
    handshake the call loop waits on.
    """

    def __init__(self, *, channel_uuid: str = "uuid-1", caller: str = "+15551230000", dialled: str = "+18447161777", answered: bool = False):
        self.channel_uuid = channel_uuid
        self.caller = caller
        self.dialled = dialled
        #: Whether the dialplan answered before handing the call to the socket.
        self.answered = answered
        self.applications: list[tuple[str, str]] = []
        self.recordings: list[str] = []
        #: Text of each turn the caller "says", consumed one per `record`.
        self.caller_turns: list[str] = []
        self.hungup = False
        self.silent_records = 0
        #: When set and true, the fake caller hangs up at the next empty recording.
        self.should_hang_up = None

    def _channel_data(self) -> bytes:
        body = (
            f"Channel-Unique-ID: {self.channel_uuid}\n"
            f"Unique-ID: {self.channel_uuid}\n"
            f"Caller-Caller-ID-Number: {self.caller}\n"
            f"Caller-Destination-Number: {self.dialled}\n"
            "Caller-Caller-ID-Name: Sam%20Tailor\n"
            f"Answer-State: {'answered' if self.answered else 'ringing'}\n"
        ).encode()
        return b"Content-Type: command/reply\nReply-Text: +OK\nContent-Length: %d\n\n%s" % (len(body), body)

    @staticmethod
    def _complete(app: str, execution_id: str = "") -> bytes:
        body = f"Event-Name: CHANNEL_EXECUTE_COMPLETE\nApplication: {app}\nApplication-UUID: {execution_id}\n\n".encode()
        return b"Content-Type: text/event-plain\nContent-Length: %d\n\n%s" % (len(body), body)

    async def run(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        while True:
            headers: dict[str, str] = {}
            first = ""
            while True:
                raw = await reader.readline()
                if not raw:
                    writer.close()
                    return
                line = raw.decode().rstrip("\r\n")
                if line == "":
                    break
                if not first:
                    first = line
                name, separator, value = line.partition(":")
                if separator:
                    headers[name.strip()] = value.strip()

            if first.startswith("connect"):
                writer.write(self._channel_data())
            elif first.startswith(("linger", "myevents", "event ", "api ")):
                writer.write(b"Content-Type: command/reply\nReply-Text: +OK\n\n")
            elif first.startswith("sendmsg"):
                app = headers.get("execute-app-name", "")
                arg = headers.get("execute-app-arg", "")
                length = int(headers.get("content-length", "0") or 0)
                if length:
                    arg = (await reader.readexactly(length)).decode()
                self.applications.append((app, arg))
                writer.write(b"Content-Type: command/reply\nReply-Text: +OK\n\n")
                if app == "record":
                    self.recordings.append(arg)
                    self._write_turn(arg)
                    if not self.caller_turns:
                        self.silent_records += 1
                        if self.should_hang_up is not None and self.should_hang_up():
                            # The caller hangs up: the socket goes away.
                            writer.write(self._complete(app, headers.get("event-uuid", "")))
                            self.hungup = True
                            await writer.drain()
                            writer.close()
                            return
                if app == "hangup":
                    self.hungup = True
                writer.write(self._complete(app, headers.get("event-uuid", "")))
                if app in {"hangup", "transfer"}:
                    await writer.drain()
                    writer.close()
                    return
            else:
                writer.write(b"Content-Type: command/reply\nReply-Text: -ERR unknown\n\n")
            await writer.drain()

    def _write_turn(self, arg: str) -> None:
        """FreeSWITCH writes the file `record` was pointed at; so do we."""
        import wave

        path = Path(arg.split(" ")[0])
        path.parent.mkdir(parents=True, exist_ok=True)
        # An empty turn is a caller who has not started talking yet: the
        # recorder gives up after its silence window with next to nothing.
        if self.caller_turns and self.caller_turns[0] == "":
            self.caller_turns.pop(0)
            seconds = 0.05
        else:
            seconds = 1.5 if self.caller_turns else 0.05
        with wave.open(str(path), "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(8000)
            if seconds < 0.5:
                handle.writeframes(b"\x00\x00" * int(8000 * seconds))
            else:
                # A voice, as far as the energy check is concerned: a tone.
                import math
                import struct

                frames = int(8000 * seconds)
                handle.writeframes(b"".join(struct.pack("<h", int(3000 * math.sin(2 * math.pi * 440 * index / 8000))) for index in range(frames)))


class FakeVoice:
    def __init__(self, directory: str):
        self.said: list[str] = []
        self.prerendered: list[tuple[list[str], str | None]] = []
        self._dir = Path(directory) / "prompts"
        self._dir.mkdir(parents=True, exist_ok=True)

    async def say(self, text: str, voice: str | None = None) -> Path:
        # The same text rendered twice is one file, as in the real Voice.
        if text not in self.said:
            self.said.append(text)
        path = self._dir / f"{self.said.index(text) + 1}.wav"
        path.write_bytes(b"RIFF")
        return path

    async def prerender(self, texts: list[str], voice: str | None = None) -> None:
        self.prerendered.append((list(texts), voice))


class FakeEars:
    def __init__(self, freeswitch: FakeFreeswitch):
        self._freeswitch = freeswitch
        self.languages: list[str | None] = []
        self.hints: list[list[str]] = []
        self.failures = 0

    async def transcribe(self, path: Path, language: str | None = None, hints: list[str] | None = None) -> str:
        self.languages.append(language)
        self.hints.append(list(hints or []))
        text = self._freeswitch.caller_turns.pop(0) if self._freeswitch.caller_turns else ""
        if self.failures:
            self.failures -= 1
            raise SpeechRecognitionError("Recognizer overloaded")
        return text


class FakeBrain:
    def __init__(self, decisions: list[Decision], delay: float = 0.0):
        self._decisions = decisions
        self._delay = delay
        self.seen: list[Conversation] = []

    async def respond(self, conversation: Conversation, on_first_sentence=None) -> Decision:
        self.seen.append(conversation)
        if self._delay:
            await asyncio.sleep(self._delay)
        decision = self._decisions.pop(0) if self._decisions else Decision(action="wrap_up", say="Goodbye.")
        if on_first_sentence is not None and decision.say:
            # The real Brain announces the opening sentence while streaming.
            on_first_sentence(decision.say.split(". ")[0].rstrip(".") + ".")
        return decision


class FakeApi:
    def __init__(self, assistant: Assistant | None):
        self._assistant = assistant
        self.filed: list[dict] = []

    async def assistant_for(self, number: str, caller: str):
        return self._assistant

    async def record_conversation(self, payload: dict) -> None:
        self.filed.append(payload)


RECEPTION = Assistant(
    name="Reception",
    greeting="Thanks for calling Vocivo.",
    transfer_enabled=True,
    fallback_extension="1001",
    targets=(TransferTarget("1001", "Sam"),),
)


class CallFlow(unittest.IsolatedAsyncioTestCase):
    async def test_recognition_failure_is_not_counted_as_caller_silence(self):
        freeswitch, voice, api = await self._run(
            assistant=RECEPTION,
            turns=["I am still here.", "Can you hear me?", "Goodbye."],
            decisions=[Decision(action="wrap_up", say="Goodbye.")],
            transcription_failures=2,
        )
        self.assertGreaterEqual(len(freeswitch.recordings), 3)
        self.assertFalse(any(app == "transfer" for app, _ in freeswitch.applications))
        self.assertEqual([app for app, _ in freeswitch.applications].count("hangup"), 1)
        self.assertEqual(api.filed[0]["outcome"], "completed")
        self.assertIn("Sorry, I couldn't process that.", voice.said)
        self.assertIn("Could you repeat that, please?", voice.said)

    async def test_message_capture_does_not_hang_up_before_caller_finishes(self):
        freeswitch, voice, api = await self._run(
            assistant=RECEPTION,
            turns=["Please call me back about the invoice.", "Also, it's urgent.", "That's all, goodbye."],
            decisions=[
                Decision(action="message", say="I'll pass your message on. Anything else?", note="Call back about the invoice."),
                Decision(action="message", say="I've added that.", note="Urgent."),
                Decision(action="wrap_up", say="Goodbye."),
            ],
        )
        # Three turns with speech; after the goodbye the line stays open and
        # the recorder keeps listening until the caller hangs up.
        self.assertGreaterEqual(len(freeswitch.recordings), 3)
        self.assertEqual([app for app, _ in freeswitch.applications].count("hangup"), 1)
        self.assertEqual(api.filed[0]["note"], "Call back about the invoice.\nUrgent.")
        self.assertEqual(api.filed[0]["outcome"], "message_taken")

    async def test_persistent_asr_failure_transfers_to_the_tenant_fallback(self):
        switch, _, api = await self._run(assistant=RECEPTION, turns=['one', 'two', 'three'], decisions=[], transcription_failures=3)
        self.assertEqual(api.filed[0]['outcome'], 'transferred')
        self.assertEqual(api.filed[0]['transferredTo'], '1001')

    async def test_idle_watchdog_ends_a_stalled_listening_turn(self):
        switch, _, api = await self._run(assistant=RECEPTION, turns=[], decisions=[], idle_hangup_seconds=0.03)
        self.assertEqual(api.filed[0]['outcome'], 'caller_went_quiet')
        self.assertEqual([app for app, _ in switch.applications].count('hangup'), 1)

    async def _run(self, *, assistant: Assistant | None, turns: list[str], decisions: list[Decision], answered: bool = False, model_delay: float = 0.0, transcription_failures: int = 0, idle_hangup_seconds: int = 0, hang_up_when_said: str = ""):
        with TemporaryDirectory() as directory:
            settings = Settings(
                audio_dir=directory,
                tts_secret="x",
                llm_api_key="x",
                api_secret="x",
                listen_seconds=2,
                patience_seconds=1,
                # The receptionist never hangs up on a caller; in tests the
                # idle release fires on the first silent turn so a scripted
                # conversation with no more caller turns ends.
                idle_hangup_seconds=idle_hangup_seconds,
                speech_bed="",
                barge_in=False,
            )
            freeswitch = FakeFreeswitch(answered=answered)
            freeswitch.caller_turns = list(turns)
            voice = FakeVoice(directory)
            if hang_up_when_said:
                freeswitch.should_hang_up = lambda: hang_up_when_said in voice.said
            api = FakeApi(assistant)
            self.ears = FakeEars(freeswitch)
            self.ears.failures = transcription_failures
            handler = CallHandler(settings, voice, self.ears, FakeBrain(decisions, delay=model_delay), api)  # type: ignore[arg-type]

            async def on_connection(reader, writer):
                connection = EslConnection(reader, writer)
                try:
                    await handler.handle(connection)
                finally:
                    await connection.close()

            server = await asyncio.start_server(on_connection, "127.0.0.1", 0)
            port = server.sockets[0].getsockname()[1]
            async with server:
                reader, writer = await asyncio.open_connection("127.0.0.1", port)
                try:
                    await asyncio.wait_for(freeswitch.run(reader, writer), timeout=15)
                finally:
                    writer.close()
                    await writer.wait_closed()
                # Let the handler finish filing the conversation.
                await asyncio.sleep(0.1)
            return freeswitch, voice, api

    async def test_a_whole_conversation_answers_speaks_listens_and_hangs_up(self):
        freeswitch, voice, api = await self._run(
            assistant=RECEPTION,
            turns=["What time do you close?"],
            decisions=[Decision(action="wrap_up", say="We close at five. Thanks for calling.")],
        )
        applications = [app for app, _ in freeswitch.applications]
        self.assertEqual(applications[0], "answer")
        self.assertIn("record", applications)
        self.assertIn("hangup", applications)
        self.assertEqual(voice.said[0], "Thanks for calling Vocivo.")
        # Spoken a sentence at a time, so the first is playing while the second renders.
        self.assertIn("We close at five.", voice.said)
        self.assertIn("Thanks for calling.", voice.said)
        playbacks = [arg for app, arg in freeswitch.applications if app == "playback"]
        # The greeting, then the answer: its two sentences were both rendered
        # by the time the first was due, so they went to FreeSWITCH as one
        # gapless file_string playback rather than two.
        self.assertGreaterEqual(len(playbacks), 2, "greeting, then the answer")
        # The streamed opening now plays before the full decision is ready;
        # it must not be replayed as part of the final answer.
        opening = str(voice._dir / f"{voice.said.index('We close at five.') + 1}.wav")
        self.assertEqual(playbacks.count(opening), 1)

        filed = api.filed[0]
        self.assertEqual(filed["outcome"], "completed")
        self.assertIn("Caller: What time do you close?", filed["transcript"])
        self.assertIn("Reception: Thanks for calling Vocivo.", filed["transcript"])

    async def test_a_transfer_hands_the_call_back_to_the_dialplan(self):
        freeswitch, voice, api = await self._run(
            assistant=RECEPTION,
            turns=["Can I speak to Sam?"],
            decisions=[Decision(action="transfer", extension="1001", say="Putting you through to Sam.")],
        )
        transfer = [arg for app, arg in freeswitch.applications if app == "transfer"]
        # Back into the API's dialplan as a keyed extension, so the same rules
        # that route a menu choice ring the right phone and fall back properly.
        self.assertEqual(transfer, ["+18447161777 XML public"])
        self.assertIn(("set", "vocivo_stage=ext-select"), freeswitch.applications)
        self.assertIn(("set", "vocivo_digit=1001"), freeswitch.applications)
        self.assertIn("Putting you through to Sam.", voice.said)
        self.assertEqual(api.filed[0]["outcome"], "transferred")
        self.assertEqual(api.filed[0]["transferredTo"], "1001")

    async def test_the_recording_is_asked_for_with_silence_detection(self):
        freeswitch, _, _ = await self._run(
            assistant=RECEPTION,
            turns=["Hello?"],
            decisions=[Decision(action="wrap_up", say="Bye.")],
        )
        # path, time limit, silence threshold, silence seconds — without the
        # last two the app records until the limit on every single turn.
        parts = freeswitch.recordings[0].split(" ")
        self.assertEqual(len(parts), 4)
        self.assertTrue(parts[0].endswith(".wav"))
        self.assertEqual(parts[1:], ["2", "450", "1"], "one second of quiet is the end of a turn; the caller's thinking time before speaking is not counted (see _listen)")

    async def test_a_silent_caller_is_asked_twice_and_then_left_in_peace(self):
        # A long idle window: silence is met with two gentle prompts and then
        # patience, never a transfer to a person and never a hangup.
        freeswitch, voice, api = await self._run(assistant=RECEPTION, turns=[], decisions=[], idle_hangup_seconds=3600, hang_up_when_said="Take your time.")
        self.assertIn("Sorry, I didn't catch that.", voice.said)
        self.assertIn("Are you still there?", voice.said)
        self.assertIn("Take your time.", voice.said)
        self.assertNotIn("transfer", [app for app, _ in freeswitch.applications])
        self.assertNotIn("hangup", [app for app, _ in freeswitch.applications])
        self.assertEqual(api.filed[0]["outcome"], "caller_hung_up")

    async def test_a_line_nobody_speaks_on_is_released_with_a_goodbye(self):
        freeswitch, voice, api = await self._run(assistant=RECEPTION, turns=[], decisions=[])
        self.assertEqual(voice.said[-2:], ["I'll let you go now.", "Thanks for calling — goodbye."])
        self.assertEqual([app for app, _ in freeswitch.applications].count("hangup"), 1)
        self.assertEqual(api.filed[0]["outcome"], "caller_went_quiet")

    async def test_a_number_with_no_receptionist_is_released_not_answered(self):
        freeswitch, voice, api = await self._run(assistant=None, turns=[], decisions=[])
        applications = [app for app, _ in freeswitch.applications]
        self.assertNotIn("answer", applications)
        self.assertEqual(voice.said, [])
        # Nothing filed either: no conversation happened.
        self.assertEqual(api.filed, [])

    async def test_the_call_is_narrowband_and_prompts_cannot_be_cut_short_by_a_keypress(self):
        freeswitch, _, _ = await self._run(
            assistant=RECEPTION,
            turns=["Hi."],
            decisions=[Decision(action="wrap_up", say="Bye.")],
        )
        self.assertIn(("set", "playback_terminators=none"), freeswitch.applications)
        self.assertIn(("set", "record_sample_rate=8000"), freeswitch.applications)
        # Only the caller's side is recorded, and a one-word answer is kept.
        self.assertIn(("set", "RECORD_READ_ONLY=true"), freeswitch.applications)
        self.assertIn(("set", "RECORD_MIN_SEC=0"), freeswitch.applications)

    async def test_a_call_the_dialplan_already_answered_is_not_answered_again(self):
        # The dialplan answers and pauses before the socket; doing both again
        # added most of a second of dead air before every greeting.
        freeswitch, voice, _ = await self._run(
            assistant=RECEPTION,
            turns=["Hi."],
            decisions=[Decision(action="wrap_up", say="Bye.")],
            answered=True,
        )
        applications = [app for app, _ in freeswitch.applications]
        self.assertNotIn("answer", applications)
        self.assertNotIn("sleep", applications)
        self.assertEqual(voice.said[0], "Thanks for calling Vocivo.")

    async def test_a_slow_model_is_covered_by_a_short_filler_and_a_fast_one_is_not(self):
        _, slow, _ = await self._run(
            assistant=RECEPTION,
            turns=["What are your opening hours on Saturday?"],
            decisions=[Decision(action="wrap_up", say="Nine to one on Saturdays.")],
            model_delay=4.0,
        )
        answer = slow.said.index("Nine to one on Saturdays.")
        self.assertIn(slow.said[answer - 1], FILLERS, "a filler should be spoken while the model thinks")

        _, fast, _ = await self._run(
            assistant=RECEPTION,
            turns=["Goodbye."],
            decisions=[Decision(action="wrap_up", say="Goodbye.")],
        )
        self.assertFalse(set(fast.said) & set(FILLERS), "a quick reply needs no filler")

    async def test_canned_phrases_are_prerendered_in_the_receptionist_voice(self):
        _, voice, _ = await self._run(
            assistant=Assistant(name="Reception", greeting="Hello.", voice="am_adam"),
            turns=["Hi."],
            decisions=[Decision(action="wrap_up", say="Bye.")],
        )
        self.assertTrue(voice.prerendered)
        texts, spoken_by = voice.prerendered[0]
        self.assertEqual(spoken_by, "am_adam")
        for phrase in CANNED.values():
            self.assertIn(phrase, texts)  # the fake keeps whole phrases; the real Voice splits them as it renders

    async def test_recognition_listens_in_the_receptionist_language_with_the_names_it_may_hear(self):
        await self._run(
            assistant=Assistant(name="Accueil", greeting="Bonjour.", language="fr", transfer_enabled=True, targets=(TransferTarget("1001", "Musa"),)),
            turns=["Bonjour."],
            decisions=[Decision(action="wrap_up", say="Au revoir.")],
        )
        self.assertEqual(self.ears.languages, ["fr"])
        self.assertEqual(self.ears.hints, [["Accueil", "Musa"]])

    async def test_a_caller_who_takes_a_moment_to_speak_is_waited_for(self):
        # The recorder returns an empty file after two quiet seconds; the
        # handler records again rather than apologising, until patience runs out.
        freeswitch, voice, _ = await self._run(
            assistant=RECEPTION,
            turns=["", "", "Hello, is this Vocivo?"],
            decisions=[Decision(action="wrap_up", say="It is. Goodbye.")],
        )
        records = [app for app, _ in freeswitch.applications if app == "record"]
        self.assertGreaterEqual(len(records), 3, "kept listening through the quiet")
        self.assertNotIn("Sorry, I didn't catch that.", voice.said)
        self.assertIn("It is.", voice.said)
        self.assertIn("Goodbye.", voice.said)


if __name__ == "__main__":
    unittest.main()
