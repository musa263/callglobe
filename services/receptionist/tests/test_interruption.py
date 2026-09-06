from __future__ import annotations

import asyncio
import struct
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.interruption import IncomingSpeech, SpeechFrames
from app.call import CallHandler
from app.config import Settings
from app.brain import Assistant, Conversation
from app.esl import EslConnection


def frame(level):
    return struct.pack('<160h', *([level, -level] * 80))


class FrameDetection(unittest.TestCase):
    def test_short_noise_is_ignored_and_speech_keeps_its_first_frames(self):
        gate = SpeechFrames(650, 120, 600, 12)
        gate.feed(frame(40) * 10 + frame(3000) * 2 + frame(40) * 10)
        self.assertFalse(gate.started)
        speech = frame(2000) * 6
        # Socket/file boundaries need not match a PCM sample or frame.
        gate.feed(speech[:13])
        gate.feed(speech[13:])
        self.assertTrue(gate.started)
        self.assertIn(speech, gate.audio)
        gate.feed(frame(0) * 29)
        self.assertFalse(gate.finished)
        gate.feed(frame(0))
        self.assertTrue(gate.finished)

    def test_continuous_noise_or_speech_has_a_bounded_recording(self):
        gate = SpeechFrames(650, 120, 600, 1)
        gate.feed(frame(2000) * 100)
        self.assertTrue(gate.finished)
        self.assertLessEqual(len(gate.audio), 320 * 60)


class Interruptions(unittest.IsolatedAsyncioTestCase):
    async def test_capture_follows_growing_file_and_preserves_preroll(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'incoming.r8'
            path.write_bytes(frame(20) * 10)
            incoming = IncomingSpeech(path, Settings(), asyncio.Event())
            task = asyncio.create_task(incoming.capture())
            await asyncio.sleep(0.03)
            with path.open('ab', buffering=0) as output:
                output.write(frame(2000) * 6)
                await asyncio.wait_for(incoming.started.wait(), 1)
                output.write(frame(0) * 30)
            audio = await asyncio.wait_for(task, 1)
            self.assertIn(frame(2000) * 6, audio)
            self.assertTrue(audio.startswith(frame(20)))

    async def test_interrupt_cancels_model_and_early_synthesis_and_removes_audio(self):
        with TemporaryDirectory() as directory:
            model_started = asyncio.Event()
            model_cancelled = asyncio.Event()
            voice_cancelled = asyncio.Event()

            class Brain:
                async def respond(self, conversation, first):
                    first('An unfinished answer.')
                    model_started.set()
                    try:
                        await asyncio.Event().wait()
                    finally:
                        model_cancelled.set()

            class Voice:
                async def say(self, text, voice):
                    try:
                        await asyncio.Event().wait()
                    finally:
                        voice_cancelled.set()

            class Connection:
                uuid = 'test-call'
                hungup = asyncio.Event()
                set = AsyncMock()
                api = AsyncMock(return_value='+OK')
                async def execute(self, app, arg, **kwargs):
                    if app == 'record_session':
                        self.path = Path(arg.rsplit(' ', 1)[0])
                        self.path.write_bytes(frame(0) * 10)

            connection = Connection()
            handler = CallHandler(Settings(audio_dir=directory), Voice(), None, Brain(), None)
            task = asyncio.create_task(handler._with_interruption(connection, lambda: handler._think(connection, Conversation(Assistant()), 'voice')))
            await asyncio.wait_for(model_started.wait(), 1)
            with connection.path.open('ab', buffering=0) as output:
                output.write(frame(2000) * 6 + frame(0) * 30)
            decision, audio = await asyncio.wait_for(task, 2)
            self.assertIsNone(decision)
            self.assertTrue(audio)
            self.assertTrue(model_cancelled.is_set())
            self.assertTrue(voice_cancelled.is_set())
            self.assertEqual(connection.api.call_args_list[0].args[0], 'uuid_break test-call all')
            self.assertEqual(list(Path(directory).rglob('*.r8')), [])

    async def test_cancelling_playback_does_not_steal_api_reply_or_next_completion(self):
        # Exercise the actual ESL reader against a scripted writer. Completion
        # for the cancelled playback arrives after uuid_break's response.
        reader = asyncio.StreamReader()
        writes = []
        execution_ids = []

        def event(app, execution_id):
            body = f'Event-Name: CHANNEL_EXECUTE_COMPLETE\nApplication: {app}\nApplication-UUID: {execution_id}\n'.encode()
            return b'Content-Type: text/event-plain\nContent-Length: %d\n\n%s' % (len(body), body)

        class Writer:
            def write(self, data):
                text = data.decode()
                writes.append(text)
                if text.startswith('api '):
                    reader.feed_data(b'Content-Type: api/response\nContent-Length: 3\n\n+OK')
                    reader.feed_data(event('playback', execution_ids[0]))
                else:
                    execution_id = next(line.split(': ', 1)[1] for line in text.splitlines() if line.startswith('event-uuid:'))
                    execution_ids.append(execution_id)
                    reader.feed_data(b'Content-Type: command/reply\nReply-Text: +OK\n\n')
                    if len(execution_ids) > 1:
                        # The current completion is delivered separately below.
                        pass
            async def drain(self): pass
            def close(self): pass
            async def wait_closed(self): pass

        connection = EslConnection(reader, Writer())
        try:
            first = asyncio.create_task(connection.execute('playback', 'first.wav'))
            while not execution_ids:
                await asyncio.sleep(0)
            first.cancel()
            await asyncio.gather(first, return_exceptions=True)
            self.assertEqual(await connection.api('uuid_break test all'), '+OK')
            second = asyncio.create_task(connection.execute('playback', 'second.wav'))
            while len(execution_ids) < 2:
                await asyncio.sleep(0)
            await asyncio.sleep(0.01)
            self.assertFalse(second.done(), 'stale playback completion must not finish the next prompt')
            reader.feed_data(event('playback', execution_ids[1]))
            result = await asyncio.wait_for(second, 1)
            self.assertEqual(result.event['Application-UUID'], execution_ids[1])
        finally:
            await connection.close()

    async def test_interrupted_transfer_uses_captured_caller_turn_without_transferring(self):
        from app.brain import Decision
        with TemporaryDirectory() as directory:
            assistant = Assistant(name='Reception', greeting='Hello there.')
            spoken = []
            applications = []
            transcribed_audio = []

            class Voice:
                prerender = AsyncMock()
                async def say(self, text, voice):
                    spoken.append(text)
                    return Path(directory) / ('transfer.wav' if 'Transferring' in text else 'answer.wav')

            class Connection:
                uuid = 'integration-call'
                hungup = asyncio.Event()
                set = AsyncMock()
                close = AsyncMock()
                api = AsyncMock(return_value='+OK')
                async def connect(self):
                    return {'Answer-State': 'answered'}
                async def execute(self, app, arg='', **kwargs):
                    applications.append(app)
                    if app == 'record_session':
                        self.path = Path(arg.rsplit(' ', 1)[0])
                        self.path.write_bytes(frame(0) * 10)
                    if app == 'playback' and arg.endswith('transfer.wav'):
                        with self.path.open('ab', buffering=0) as output:
                            output.write(frame(2000) * 8 + frame(0) * 30)
                        await asyncio.Event().wait()
                async def hangup(self, *args):
                    self.hungup.set()

            class Ears:
                async def transcribe(self, path, *args):
                    import wave
                    with wave.open(str(path), 'rb') as recording:
                        transcribed_audio.append(recording.readframes(recording.getnframes()))
                    return 'Actually, please do not transfer me.'

            brain = type('Brain', (), {})()
            brain.respond = AsyncMock(side_effect=[
                Decision(action='transfer', extension='1001', say='Transferring you now.'),
                Decision(action='wrap_up', say='Okay, goodbye.'),
            ])
            api = type('Api', (), {})()
            api.assistant_for = AsyncMock(return_value=assistant)
            api.record_conversation = AsyncMock()
            connection = Connection()
            handler = CallHandler(Settings(audio_dir=directory), Voice(), Ears(), brain, api)
            first = True
            async def listen(*args):
                nonlocal first
                if first:
                    first = False
                    return 'Please transfer me.'
                connection.hungup.set()
                return ''
            handler._listen = listen
            await asyncio.wait_for(handler.handle(connection), 2)
            self.assertNotIn('transfer', applications)
            self.assertTrue(transcribed_audio)
            self.assertIn(frame(2000) * 8, transcribed_audio[0])
            self.assertEqual(brain.respond.await_count, 2)
            filed = api.record_conversation.call_args.args[0]
            self.assertIn('Caller: Actually, please do not transfer me.', filed['transcript'])
            self.assertIn('response interrupted by the caller', filed['transcript'])
            self.assertEqual(filed['transferredTo'], '')
            self.assertEqual(list(Path(directory).rglob('*.r8')), [])
            self.assertEqual(list(Path(directory).rglob('interruption-*.wav')), [])

    async def test_hangup_cancels_an_inflight_response(self):
        with TemporaryDirectory() as directory:
            started = asyncio.Event()
            cancelled = asyncio.Event()
            class Connection:
                uuid = 'hangup-call'
                hungup = asyncio.Event()
                set = AsyncMock()
                api = AsyncMock(return_value='+OK')
                async def execute(self, app, arg, **kwargs):
                    Path(arg.rsplit(' ', 1)[0]).write_bytes(frame(0))
            connection = Connection()
            handler = CallHandler(Settings(audio_dir=directory), None, None, None, None)
            async def response():
                started.set()
                try:
                    await asyncio.Event().wait()
                finally:
                    cancelled.set()
            task = asyncio.create_task(handler._with_interruption(connection, response))
            await started.wait()
            connection.hungup.set()
            self.assertEqual(await asyncio.wait_for(task, 1), (None, b''))
            self.assertTrue(cancelled.is_set())
            self.assertEqual(list(Path(directory).rglob('*.r8')), [])
