from __future__ import annotations

import asyncio
import sys
import json
import io
import unittest
import wave
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.brain import Assistant, Brain, Conversation, TransferTarget, decision_from_response, system_prompt, tool_definitions
from app.esl import EslConnection, Message, parse_header_block
from app.config import Settings
from app.speech import Ears, SpeechRecognitionError, Voice, recording_has_audio, split_sentences
from unittest.mock import AsyncMock, Mock

RECEPTION = Assistant(
    name="Reception",
    greeting="Thanks for calling Vocivo.",
    instructions="We are open nine to five.",
    transfer_enabled=True,
    fallback_extension="1001",
    targets=(TransferTarget("1001", "Sam"), TransferTarget("1002", "Accounts")),
)


def audio_fixture() -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(8000)
        wav.writeframes(b"\x01\x00" * 800)
    return output.getvalue()


class RecognitionRecovery(unittest.IsolatedAsyncioTestCase):
    async def test_model_load_failure_is_not_returned_as_silence(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "caller.wav"
            path.write_bytes(b"recorded audio fixture")
            ears = Ears(Settings())
            ears._load = AsyncMock(side_effect=RuntimeError("load failed"))
            with self.assertRaises(SpeechRecognitionError):
                await ears.transcribe(path)

    async def test_inference_failure_is_not_returned_as_silence(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "caller.wav"
            path.write_bytes(b"recorded audio fixture")
            ears = Ears(Settings())
            model = Mock()
            model.transcribe.side_effect = RuntimeError("inference failed")
            ears._load = AsyncMock(return_value=model)
            with self.assertRaises(SpeechRecognitionError):
                await ears.transcribe(path)


class ModelRecovery(unittest.IsolatedAsyncioTestCase):
    async def test_transient_provider_errors_do_not_transfer_or_end_a_live_conversation(self):
        import httpx
        for status in (408, 429, 503):
            brain = Brain(Settings(llm_api_key="test"))
            await brain._client.aclose()
            brain._client = httpx.AsyncClient(transport=httpx.MockTransport(
                lambda request: httpx.Response(status, json={"error": "unavailable"})
            ))
            try:
                conversation = Conversation(RECEPTION)
                conversation.add("caller", "I need some information.")
                decision = await brain.respond(conversation)
                self.assertEqual(decision.action, "speak")
            finally:
                await brain.close()

    async def test_auth_failure_cannot_transfer_to_an_unlisted_fallback(self):
        import httpx
        brain = Brain(Settings(llm_api_key="test"))
        await brain._client.aclose()
        brain._client = httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request: httpx.Response(401, json={"error": "unauthorized"})
        ))
        try:
            assistant = Assistant(transfer_enabled=True, fallback_extension="9999", targets=RECEPTION.targets)
            decision = await brain.respond(Conversation(assistant))
            self.assertEqual(decision.action, "speak")
        finally:
            await brain.close()


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

    def test_after_hours_it_is_told_the_office_is_closed(self):
        closed = Assistant.from_api({"name": "Reception", "officeOpen": False, "transferEnabled": True, "targets": []})
        self.assertFalse(closed.office_open)
        self.assertIn("closed right now", system_prompt(closed))
        # The default, and anything but an explicit false, is open.
        self.assertTrue(Assistant.from_api({"name": "Reception"}).office_open)
        self.assertNotIn("closed right now", system_prompt(RECEPTION))

    def test_a_non_english_receptionist_is_told_which_language_to_speak(self):
        self.assertIn("Speak French", system_prompt(Assistant(language="fr")))
        self.assertNotIn("Speak English", system_prompt(Assistant(language="en")))


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
    def _write(self, path: Path, seconds: float, *, amplitude: int = 3000) -> None:
        import math
        import struct

        with wave.open(str(path), "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(8000)
            frames = int(8000 * seconds)
            handle.writeframes(b"".join(struct.pack("<h", int(amplitude * math.sin(2 * math.pi * 440 * index / 8000))) for index in range(frames)))

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

    def test_two_seconds_of_line_noise_is_not_a_turn(self):
        # The recorder stops after its silence window whether or not the caller
        # ever spoke: a caller still drawing breath produced a two-second file
        # that used to be transcribed as nothing and answered with an apology.
        with TemporaryDirectory() as directory:
            path = Path(directory) / "turn.wav"
            self._write(path, 2.0, amplitude=40)
            self.assertFalse(recording_has_audio(path))
            self._write(path, 2.0, amplitude=0)
            self.assertFalse(recording_has_audio(path))

    def test_a_missing_file_is_not_an_error(self):
        self.assertFalse(recording_has_audio(Path("/nonexistent/turn.wav")))


if __name__ == "__main__":
    unittest.main()


class VoiceSynthesis(unittest.IsolatedAsyncioTestCase):
    """The receptionist must ask the voice engine for audio, and refuse anything else."""

    async def test_old_json_cache_is_replaced_and_simultaneous_renders_are_atomic(self):
        import httpx
        async def handle(request):
            await asyncio.sleep(0.01)
            return httpx.Response(200, content=audio_fixture(), headers={"content-type": "audio/wav"})
        with TemporaryDirectory() as directory:
            voice = self._voice(directory, httpx.MockTransport(handle))
            corrupt = voice._path_for("Please hold.", "am_adam")
            corrupt.write_text('{"url": "not-a-wave"}')
            try:
                paths = await asyncio.gather(voice.say("Please hold.", "am_adam"), voice.say("Please hold.", "am_adam"))
                self.assertEqual(paths[0], paths[1])
                self.assertEqual(paths[0].read_bytes(), audio_fixture())
                self.assertEqual(list(paths[0].parent.glob("*.partial")), [])
            finally:
                await voice.close()

    def _voice(self, directory: str, transport):
        import httpx

        settings = Settings(tts_url="http://voice.test", tts_secret="s", audio_dir=directory)
        voice = Voice(settings)
        voice._client = httpx.AsyncClient(transport=transport)
        return voice

    async def test_asks_the_speech_endpoint_and_keeps_the_wav(self):
        import httpx

        seen: list[httpx.Request] = []

        def handle(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(200, content=audio_fixture(), headers={"content-type": "audio/wav"})

        with TemporaryDirectory() as directory:
            voice = self._voice(directory, httpx.MockTransport(handle))
            path = await voice.say("Thanks for calling.", "am_adam")
            self.assertEqual(seen[0].url.path, "/v1/audio/speech")
            self.assertEqual(seen[0].headers["authorization"], "Bearer s")
            self.assertIn(b'"voice": "am_adam"', seen[0].content.replace(b'":"', b'": "'))
            self.assertTrue(path.read_bytes().startswith(b"RIFF"))
            # The second time round nothing is synthesised.
            await voice.say("Thanks for calling.", "am_adam")
            self.assertEqual(len(seen), 1)

    async def test_prerender_queues_the_phrases_at_the_engine_and_never_raises(self):
        import httpx

        seen: list[httpx.Request] = []

        def handle(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            if len(seen) == 1:
                return httpx.Response(202, json={"queued": 2, "cached": 0})
            raise httpx.ConnectError("engine down")

        with TemporaryDirectory() as directory:
            voice = self._voice(directory, httpx.MockTransport(handle))
            await voice.prerender(["One moment.", "Sure, one second.", "  ", "Sorry, I couldn't hear you. Are you still there?"], "am_adam")
            self.assertEqual(seen[0].url.path, "/v1/audio/prerender")
            body = json.loads(seen[0].content)
            # In the pieces they are spoken in, so the call finds them in the cache.
            self.assertEqual([item["input"] for item in body["items"]], ["One moment.", "Sure, one second.", "Sorry, I couldn't hear you.", "Are you still there?"])
            self.assertTrue(all(item["voice"] == "am_adam" for item in body["items"]))
            # An engine that is down costs nothing but a debug line.
            await voice.prerender(["Hello."], "af_heart")

    async def test_json_from_the_render_endpoint_is_not_mistaken_for_audio(self):
        import httpx

        # This is what /v1/audio/render answers, and what the first deploy
        # wrote into a .wav file: every word the receptionist said was silence.
        def handle(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"id": "abc", "audio_url": "https://x/y.wav"})

        with TemporaryDirectory() as directory:
            voice = self._voice(directory, httpx.MockTransport(handle))
            with self.assertRaises(RuntimeError):
                await voice.say("Hello", "af_heart")
            self.assertEqual(list((Path(directory) / "prompts").glob("*.wav")), [])


class SentenceSplitting(unittest.TestCase):
    """Answers are spoken a sentence at a time so the first plays while the rest render."""

    def test_sentences_are_separated_and_tiny_ones_joined(self):
        self.assertEqual(
            split_sentences("We close at five. Thanks for calling! Anything else?"),
            ["We close at five.", "Thanks for calling!", "Anything else?"],
        )
        # A fragment shorter than a couple of words rides with its neighbour.
        self.assertEqual(split_sentences("Yes. We are open until nine tonight."), ["Yes. We are open until nine tonight."])
        self.assertEqual(split_sentences("   "), [])
        self.assertEqual(split_sentences("No punctuation at all"), ["No punctuation at all"])

    def test_whitespace_is_normalised_and_long_answers_are_capped(self):
        self.assertEqual(split_sentences("Hello\n\n  there.   Bye now."), ["Hello there. Bye now."])
        many = " ".join(f"Sentence number {index} is here." for index in range(20))
        parts = split_sentences(many)
        self.assertEqual(len(parts), 8)
        self.assertTrue(parts[-1].endswith("Sentence number 19 is here."))
