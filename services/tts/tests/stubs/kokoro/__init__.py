"""
A stand-in for the real Kokoro pipeline so the service can be tested where
the model (and torch) are not installed. Yields two short segments per text,
the way Kokoro splits a long prompt, so concatenation is exercised.
"""
import time

import numpy as np


class KPipeline:
    created: list[str] = []

    def __init__(self, lang_code: str = "a"):
        if lang_code == "z":
            raise RuntimeError("no such language")
        KPipeline.created.append(lang_code)
        self.lang_code = lang_code

    def __call__(self, text: str, voice: str = "af_heart", speed: float = 1.0):
        time.sleep(0.02)
        for part in text.split(". ")[:2] or [text]:
            yield part, None, np.zeros(2400, dtype=np.float32)
