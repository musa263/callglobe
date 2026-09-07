from __future__ import annotations

import io
import os
import sys
import threading
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
try:
    import kokoro  # noqa: F401
except ImportError:
    sys.path.insert(0, str(ROOT / "tests" / "stubs"))

CACHE = TemporaryDirectory()
os.environ.update(TTS_CACHE_DIR=CACHE.name, TTS_SERVICE_SECRET="s", PUBLIC_BASE_URL="https://sip.example/tts")

import soundfile as sf  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.main as engine  # noqa: E402

AUTH = {"Authorization": "Bearer s"}


def wait_for(predicate, seconds: float = 5.0) -> None:
    deadline = time.monotonic() + seconds
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError("condition not met in time")
        time.sleep(0.02)


class VoiceEngine(unittest.TestCase):
    """The service every prompt and every receptionist word comes from."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(engine.app)
        cls.client.__enter__()
        wait_for(engine.ready.is_set)

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        CACHE.cleanup()

    def test_starts_warm_and_says_so(self):
        # The model is loaded and a first sentence rendered at start-up, so
        # the first caller after a deploy does not pay for it.
        health = self.client.get("/health", headers=AUTH).json()
        self.assertTrue(health["ready"])
        self.assertEqual(health["languages"], ["a"])
        self.assertEqual(self.client.get("/health").status_code, 401)

    def test_speech_returns_every_segment_as_one_wav(self):
        response = self.client.post("/v1/audio/speech", headers=AUTH, json={"input": "Hello there. Second sentence.", "voice": "am_adam"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers["content-type"].startswith("audio/wav"))
        data, rate = sf.read(io.BytesIO(response.content))
        self.assertEqual(rate, 24000)
        self.assertEqual(len(data), 4800, "both segments must be in the file, not only the first")

    def test_speech_render_and_prerender_share_one_cache(self):
        text = "Thanks for calling, please hold."
        spoken = self.client.post("/v1/audio/speech", headers=AUTH, json={"input": text, "voice": "af_heart"})
        rendered = self.client.post("/v1/audio/render", headers=AUTH, json={"input": text, "voice": "af_heart"}).json()
        self.assertTrue(rendered["cached"], "what /speech rendered must serve /render without a second synthesis")
        served = self.client.get(f"/v1/audio/{rendered['id']}.wav")
        self.assertEqual(served.content, spoken.content)

        queued = self.client.post("/v1/audio/prerender", headers=AUTH, json={"items": [
            {"input": text, "voice": "af_heart"},
            {"input": "Brand new prompt.", "voice": "af_heart"},
            {"input": "Nobody speaks this.", "voice": "xx_nobody"},
        ]})
        self.assertEqual(queued.status_code, 202)
        self.assertEqual(queued.json(), {"queued": 1, "cached": 1})
        wait_for(lambda: engine.is_cached(engine.SpeechRequest(input="Brand new prompt.", voice="af_heart")))

    def test_unknown_voice_and_unspeakable_language_are_clear_answers(self):
        self.assertEqual(self.client.post("/v1/audio/speech", headers=AUTH, json={"input": "x", "voice": "nobody"}).status_code, 400)
        engine.voices["zf_test"] = {"name": "t", "gender": "female", "language": "Test", "lang_code": "z"}
        try:
            response = self.client.post("/v1/audio/speech", headers=AUTH, json={"input": "x", "voice": "zf_test"})
            self.assertEqual(response.status_code, 503)
        finally:
            engine.voices.pop("zf_test", None)

    def test_the_same_unseen_prompt_requested_at_once_is_synthesised_once(self):
        calls: list[str] = []
        real = engine.synthesize

        def counting(request):
            calls.append(request.input)
            return real(request)

        engine.synthesize = counting
        try:
            threads = [
                threading.Thread(target=lambda: self.client.post("/v1/audio/speech", headers=AUTH, json={"input": "Same text at once.", "voice": "af_heart"}))
                for _ in range(4)
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
        finally:
            engine.synthesize = real
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()


class CacheHousekeeping(unittest.TestCase):
    """
    The sweep used to run only from /v1/audio/render — the carrier's path. On
    Vocivo's own edge every prompt goes through /v1/audio/speech and the
    prerender queue, so nothing ever removed a file and the droplet's disk
    filled with old greetings.
    """

    def test_sweeps_by_age_and_then_by_size(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            original = (engine.cache_dir, engine.cache_ttl_seconds, engine.cache_max_bytes)
            engine.cache_dir, engine.cache_ttl_seconds, engine.cache_max_bytes = root, 100, 250
            try:
                stale = root / "stale.wav"
                stale.write_bytes(b"x" * 50)
                os.utime(stale, (time.time() - 1000, time.time() - 1000))
                for index in range(4):
                    entry = root / f"fresh-{index}.wav"
                    entry.write_bytes(b"x" * 100)
                    os.utime(entry, (time.time() - (10 - index), time.time() - (10 - index)))
                notes = root / "notes.txt"
                notes.write_bytes(b"not audio")

                engine.evict_stale_cache_entries()

                self.assertFalse(stale.exists(), "an entry past its age is removed")
                self.assertTrue(notes.exists(), "only rendered audio is swept")
                self.assertEqual(
                    sorted(entry.name for entry in root.glob("*.wav")),
                    ["fresh-2.wav", "fresh-3.wav"],
                    "the oldest go until the cache is under its ceiling",
                )
            finally:
                engine.cache_dir, engine.cache_ttl_seconds, engine.cache_max_bytes = original


class QueueAndLocks(unittest.TestCase):
    def test_lock_identity_survives_many_other_prompts(self):
        key = '0' * 64
        original = engine._render_lock(key)
        for index in range(1024):
            engine._render_lock(f'{index:064x}')
        self.assertIs(engine._render_lock(key), original)
        self.assertEqual(len(engine.render_locks), 512)

    def test_full_prerender_queue_is_bounded_and_does_not_leave_pending_keys(self):
        import queue
        old_queue, old_pending = engine.prerender_queue, engine.prerender_pending
        try:
            engine.prerender_queue = queue.Queue(maxsize=1)
            engine.prerender_pending = set()
            request = engine.PrerenderRequest(items=[engine.SpeechRequest(input=f'Queue fixture {index}') for index in range(3)])
            result = engine.prerender(request)
            self.assertEqual(result['queued'], 1)
            self.assertEqual(engine.prerender_queue.qsize(), 1)
            self.assertEqual(len(engine.prerender_pending), 1)
        finally:
            engine.prerender_queue, engine.prerender_pending = old_queue, old_pending


class AudioValidation(unittest.TestCase):
    def test_silent_nonfinite_and_empty_audio_are_rejected(self):
        from unittest.mock import patch
        import numpy as np
        for samples in [np.zeros(20), np.array([float('nan')]), np.array([float('inf')]), np.array([])]:
            with self.subTest(samples=samples), patch.object(engine, 'pipeline_for', return_value=lambda *args, **kwargs: [('text', None, samples)]):
                with self.assertRaises(engine.HTTPException):
                    engine.synthesize(engine.SpeechRequest(input='Audio validation'))

    def test_bad_unicode_auth_is_unauthorized_not_an_internal_error(self):
        with self.assertRaises(engine.HTTPException) as error:
            engine.authorize('Bearer invalid-\u00e9')
        self.assertEqual(error.exception.status_code, 401)

    def test_corrupt_cache_is_not_a_hit(self):
        from unittest.mock import patch
        with TemporaryDirectory() as directory, patch.object(engine, 'cache_dir', Path(directory)):
            request = engine.SpeechRequest(input='Corrupt cache')
            engine.cached_path(request).write_bytes(b'x' * 100)
            self.assertFalse(engine.is_cached(request))
            engine.render_to_cache(request)
            self.assertTrue(engine.is_cached(request))

    def test_warmup_runs_inference_even_when_prompt_is_cached(self):
        from unittest.mock import patch
        with patch.object(engine, 'synthesize', return_value=b'wav') as synth, patch.object(engine, 'render_to_cache') as cache:
            engine._warm_up()
            synth.assert_called_once()
            cache.assert_not_called()
