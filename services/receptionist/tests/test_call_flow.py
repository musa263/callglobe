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

    def __init__(self, *, channel_uuid: str = "uuid-1", caller: str = "+15551230000", dialled: str = "+18447161777"):
        self.channel_uuid = channel_uuid
        self.caller = caller
        self.dialled = dialled
        self.applications: list[tuple[str, str]] = []
        self.recordings: list[str] = []
        #: Text of each turn the caller "says", consumed one per `record`.
        self.caller_turns: list[str] = []
        self.hungup = False

    def _channel_data(self) -> bytes:
        body = (
            f"Channel-Unique-ID: {self.channel_uuid}\n"
            f"Unique-ID: {self.channel_uuid}\n"
            f"Caller-Caller-ID-Number: {self.caller}\n"
            f"Caller-Destination-Number: {self.dialled}\n"
            "Caller-Caller-ID-Name: Sam%20Tailor\n"
        ).encode()
        return b"Content-Type: command/reply\nReply-Text: +OK\nContent-Length: %d\n\n%s" % (len(body), body)

    @staticmethod
    def _complete(app: str) -> bytes:
        body = f"Event-Name: CHANNEL_EXECUTE_COMPLETE\nApplication: {app}\n\n".encode()
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
                if app == "hangup":
                    self.hungup = True
                writer.write(self._complete(app))
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
        seconds = 1.5 if self.caller_turns else 0.05
        with wave.open(str(path), "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(8000)
            handle.writeframes(b"\x00\x00" * int(8000 * seconds))


class FakeVoice:
    def __init__(self, directory: str):
        self.said: list[str] = []
        self._dir = Path(directory) / "prompts"
        self._dir.mkdir(parents=True, exist_ok=True)

    async def say(self, text: str, voice: str | None = None) -> Path:
        self.said.append(text)
        path = self._dir / f"{len(self.said)}.wav"
        path.write_bytes(b"RIFF")
        return path


class FakeEars:
    def __init__(self, freeswitch: FakeFreeswitch):
        self._freeswitch = freeswitch

    async def transcribe(self, path: Path) -> str:
        return self._freeswitch.caller_turns.pop(0) if self._freeswitch.caller_turns else ""


class FakeBrain:
    def __init__(self, decisions: list[Decision]):
        self._decisions = decisions
        self.seen: list[Conversation] = []

    async def respond(self, conversation: Conversation) -> Decision:
        self.seen.append(conversation)
        return self._decisions.pop(0) if self._decisions else Decision(action="hangup", say="Goodbye.")


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
    async def _run(self, *, assistant: Assistant | None, turns: list[str], decisions: list[Decision]):
        with TemporaryDirectory() as directory:
            settings = Settings(
                audio_dir=directory,
                tts_secret="x",
                llm_api_key="x",
                api_secret="x",
                listen_seconds=2,
            )
            freeswitch = FakeFreeswitch()
            freeswitch.caller_turns = list(turns)
            voice = FakeVoice(directory)
            api = FakeApi(assistant)
            handler = CallHandler(settings, voice, FakeEars(freeswitch), FakeBrain(decisions), api)  # type: ignore[arg-type]

            async def on_connection(reader, writer):
                await handler.handle(EslConnection(reader, writer))

            server = await asyncio.start_server(on_connection, "127.0.0.1", 0)
            port = server.sockets[0].getsockname()[1]
            async with server:
                reader, writer = await asyncio.open_connection("127.0.0.1", port)
                await asyncio.wait_for(freeswitch.run(reader, writer), timeout=15)
                # Let the handler finish filing the conversation.
                await asyncio.sleep(0.1)
            return freeswitch, voice, api

    async def test_a_whole_conversation_answers_speaks_listens_and_hangs_up(self):
        freeswitch, voice, api = await self._run(
            assistant=RECEPTION,
            turns=["What time do you close?"],
            decisions=[Decision(action="hangup", say="We close at five. Thanks for calling.")],
        )
        applications = [app for app, _ in freeswitch.applications]
        self.assertEqual(applications[0], "answer")
        self.assertIn("record", applications)
        self.assertIn("hangup", applications)
        self.assertEqual(voice.said[0], "Thanks for calling Vocivo.")
        self.assertIn("We close at five. Thanks for calling.", voice.said)

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
        # Back into the same dialplan, so the rules that route an ordinary
        # internal call decide where it lands.
        self.assertEqual(transfer, ["1001 XML default"])
        self.assertIn("Putting you through to Sam.", voice.said)
        self.assertEqual(api.filed[0]["outcome"], "transferred")
        self.assertEqual(api.filed[0]["transferredTo"], "1001")

    async def test_the_recording_is_asked_for_with_silence_detection(self):
        freeswitch, _, _ = await self._run(
            assistant=RECEPTION,
            turns=["Hello?"],
            decisions=[Decision(action="hangup", say="Bye.")],
        )
        # path, time limit, silence threshold, silence seconds — without the
        # last two the app records until the limit on every single turn.
        parts = freeswitch.recordings[0].split(" ")
        self.assertEqual(len(parts), 4)
        self.assertTrue(parts[0].endswith(".wav"))
        self.assertEqual(parts[1:], ["2", "300", "2"])

    async def test_a_silent_caller_is_asked_once_and_then_handed_to_a_person(self):
        freeswitch, voice, api = await self._run(assistant=RECEPTION, turns=[], decisions=[])
        self.assertIn("Sorry, I couldn't hear you. Are you still there?", voice.said)
        self.assertIn("I'll put you through to someone.", voice.said)
        self.assertEqual([arg for app, arg in freeswitch.applications if app == "transfer"], ["1001 XML default"])
        self.assertEqual(api.filed[0]["outcome"], "transferred")

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
            decisions=[Decision(action="hangup", say="Bye.")],
        )
        settings = dict(freeswitch.applications)
        self.assertEqual(settings.get("set"), "playback_terminators=none")
        self.assertIn(("set", "record_sample_rate=8000"), freeswitch.applications)


if __name__ == "__main__":
    unittest.main()
