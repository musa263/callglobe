from __future__ import annotations

import asyncio
import sys
import unittest
import wave
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.brain import Assistant, Conversation, TransferTarget, decision_from_response, system_prompt, tool_definitions
from app.esl import EslConnection, Message, parse_header_block
from app.speech import recording_has_audio

RECEPTION = Assistant(
    name="Reception",
    greeting="Thanks for calling Vocivo.",
    instructions="We are open nine to five.",
    transfer_enabled=True,
    fallback_extension="1001",
    targets=(TransferTarget("1001", "Sam"), TransferTarget("1002", "Accounts")),
)


class HeaderParsing(unittest.TestCase):
    def test_values_are_url_decoded(self):
        # FreeSWITCH escapes event header values; a caller called "Sam Tailor"
        # arrives as Sam%20Tailor and would otherwise be announced that way.
        headers = parse_header_block("Event-Name: CHANNEL_ANSWER\nCaller-Caller-ID-Name: Sam%20Tailor\n")
        self.assertEqual(headers["Caller-Caller-ID-Name"], "Sam Tailor")

    def test_a_value_containing_a_colon_survives(self):
        headers = parse_header_block("Channel-Presence-ID: 1001@sip.vocivo.app\nvariable_sip_to_uri: sip:1001@sip.vocivo.app\n")
        self.assertEqual(headers["variable_sip_to_uri"], "sip:1001@sip.vocivo.app")

    def test_blank_and_malformed_lines_are_ignored(self):
        headers = parse_header_block("\nEvent-Name: DTMF\nnot a header\n\n")
        self.assertEqual(headers, {"Event-Name": "DTMF"})


class MessageFraming(unittest.IsolatedAsyncioTestCase):
    async def _connection(self, script: bytes) -> EslConnection:
        reader = asyncio.StreamReader()
        reader.feed_data(script)
        reader.feed_eof()

        class NullWriter:
            def write(self, _data): pass
            async def drain(self): pass
            def close(self): pass
            async def wait_closed(self): pass

        return EslConnection(reader, NullWriter())  # type: ignore[arg-type]

    async def test_an_event_body_is_parsed_into_headers(self):
        body = b"Event-Name: CHANNEL_EXECUTE_COMPLETE\nApplication: playback\n\n"
        script = b"Content-Type: text/event-plain\nContent-Length: %d\n\n%s" % (len(body), body)
        connection = await self._connection(script)
        message: Message = await connection._read_message()  # noqa: SLF001 - framing is what is under test
        self.assertEqual(message.event_name, "CHANNEL_EXECUTE_COMPLETE")
        self.assertEqual(message.event["Application"], "playback")

    async def test_a_hangup_arriving_mid_command_is_not_lost(self):
        hangup = b"Event-Name: CHANNEL_HANGUP\n\n"
        script = (
            b"Content-Type: text/event-plain\nContent-Length: %d\n\n%s" % (len(hangup), hangup)
            + b"Content-Type: command/reply\nReply-Text: +OK\n\n"
        )
        connection = await self._connection(script)
        reply = await connection._send("noop\n\n")  # noqa: SLF001
        self.assertTrue(reply.reply_ok())
        # The hangup came first and must have been noticed, not skipped past on
        # the way to the reply we were waiting for.
        self.assertTrue(connection.hungup.is_set())


class SendMsgFraming(unittest.IsolatedAsyncioTestCase):
    async def test_an_ordinary_argument_goes_in_a_header(self):
        written: list[bytes] = []
        reader = asyncio.StreamReader()
        reader.feed_data(b"Content-Type: command/reply\nReply-Text: +OK\n\n")
        reader.feed_eof()

        class Recorder:
            def write(self, data): written.append(data)
            async def drain(self): pass
            def close(self): pass
            async def wait_closed(self): pass

        connection = EslConnection(reader, Recorder())  # type: ignore[arg-type]
        await connection._send(  # noqa: SLF001
            "sendmsg\ncall-command: execute\nexecute-app-name: record\nevent-lock: true\n"
            "execute-app-arg: /tmp/turn.wav 20 300 2\n\n"
        )
        sent = b"".join(written).decode()
        # The body form needs a byte-exact content-length; a stray newline after
        # it is read as the start of the next command. A header avoids the
        # problem entirely for the single-line arguments this app uses.
        self.assertIn("execute-app-arg: /tmp/turn.wav 20 300 2\n", sent)
        self.assertNotIn("content-length", sent)
        self.assertTrue(sent.endswith("\n\n"))


class SystemPrompt(unittest.TestCase):
    def test_it_names_every_transfer_target(self):
        prompt = system_prompt(RECEPTION)
        self.assertIn("Sam (extension 1001)", prompt)
        self.assertIn("Accounts (extension 1002)", prompt)
        self.assertIn("We are open nine to five.", prompt)

    def test_without_transfers_it_says_so(self):
        prompt = system_prompt(Assistant(transfer_enabled=False))
        self.assertIn("cannot transfer", prompt)

    def test_it_forbids_formatting_that_would_be_read_aloud(self):
        self.assertIn("markdown", system_prompt(RECEPTION))


class Tools(unittest.TestCase):
    def test_transfer_is_offered_only_when_there_is_somewhere_to_transfer(self):
        with_transfer = {tool["name"] for tool in tool_definitions(RECEPTION)}
        self.assertIn("transfer_call", with_transfer)
        without = {tool["name"] for tool in tool_definitions(Assistant(transfer_enabled=True, targets=()))}
        self.assertNotIn("transfer_call", without)

    def test_the_extension_enum_is_the_tenants_own_list(self):
        transfer = next(tool for tool in tool_definitions(RECEPTION) if tool["name"] == "transfer_call")
        self.assertEqual(transfer["input_schema"]["properties"]["extension"]["enum"], ["1001", "1002"])


class Decisions(unittest.TestCase):
    def test_plain_speech(self):
        decision = decision_from_response({"content": [{"type": "text", "text": "We're open until five."}]}, RECEPTION)
        self.assertEqual(decision.action, "speak")
        self.assertEqual(decision.say, "We're open until five.")

    def test_a_transfer_carries_what_to_say_first(self):
        decision = decision_from_response({
            "content": [{"type": "tool_use", "name": "transfer_call", "input": {"extension": "1002", "say": "Putting you through to accounts."}}]
        }, RECEPTION)
        self.assertEqual(decision.action, "transfer")
        self.assertEqual(decision.extension, "1002")
        self.assertEqual(decision.say, "Putting you through to accounts.")

    def test_an_invented_extension_is_refused_rather_than_dialled(self):
        decision = decision_from_response({
            "content": [{"type": "tool_use", "name": "transfer_call", "input": {"extension": "9999", "say": "One moment."}}]
        }, RECEPTION)
        self.assertEqual(decision.action, "speak")
        self.assertEqual(decision.extension, "")
        self.assertIn("take a message", decision.say)

    def test_a_transfer_is_refused_when_the_tenant_has_transfers_off(self):
        off = Assistant(transfer_enabled=False, targets=(TransferTarget("1001", "Sam"),))
        decision = decision_from_response({
            "content": [{"type": "tool_use", "name": "transfer_call", "input": {"extension": "1001", "say": "One moment."}}]
        }, off)
        self.assertEqual(decision.action, "speak")

    def test_taking_a_message_keeps_both_the_note_and_the_reply(self):
        decision = decision_from_response({
            "content": [{"type": "tool_use", "name": "take_message", "input": {"message": "Call Sam back about the invoice.", "say": "I'll pass that on."}}]
        }, RECEPTION)
        self.assertEqual(decision.action, "message")
        self.assertEqual(decision.note, "Call Sam back about the invoice.")
        self.assertEqual(decision.say, "I'll pass that on.")

    def test_text_alongside_a_tool_call_is_still_spoken(self):
        decision = decision_from_response({
            "content": [
                {"type": "text", "text": "Of course."},
                {"type": "tool_use", "name": "end_call", "input": {"say": "Goodbye."}},
            ]
        }, RECEPTION)
        self.assertEqual(decision.action, "hangup")
        self.assertEqual(decision.say, "Of course. Goodbye.")

    def test_an_empty_response_still_says_something(self):
        # Silence on a phone call reads as a dropped line.
        decision = decision_from_response({"content": []}, RECEPTION)
        self.assertEqual(decision.action, "speak")
        self.assertTrue(decision.say)


class Transcripts(unittest.TestCase):
    def test_the_transcript_reads_as_a_conversation(self):
        conversation = Conversation(assistant=RECEPTION)
        conversation.add("assistant", "Thanks for calling Vocivo.")
        conversation.add("caller", "Is Sam there?")
        conversation.add("caller", "   ")
        self.assertEqual(
            conversation.transcript(),
            "Reception: Thanks for calling Vocivo.\nCaller: Is Sam there?",
        )


class Recordings(unittest.TestCase):
    def _write(self, path: Path, seconds: float) -> None:
        with wave.open(str(path), "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(8000)
            handle.writeframes(b"\x00\x00" * int(8000 * seconds))

    def test_a_caller_who_said_nothing_is_not_sent_to_the_recogniser(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "turn.wav"
            self._write(path, 0.1)
            self.assertFalse(recording_has_audio(path))

    def test_a_real_turn_is(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "turn.wav"
            self._write(path, 1.5)
            self.assertTrue(recording_has_audio(path))

    def test_a_missing_file_is_not_an_error(self):
        self.assertFalse(recording_has_audio(Path("/nonexistent/turn.wav")))


if __name__ == "__main__":
    unittest.main()
