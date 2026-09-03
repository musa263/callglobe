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
