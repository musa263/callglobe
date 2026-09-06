from __future__ import annotations

import asyncio
import struct
import time
from collections import deque
from pathlib import Path


class SpeechFrames:
    """Bounded 8 kHz, mono PCM16 speech gate with 200 ms of pre-roll.

    Require sustained energy, rather than one loud sample. The threshold is
    configurable because handset echo and background noise vary by deployment.
    """

    frame_bytes = 320  # 160 samples = 20 ms

    def __init__(self, threshold: int, onset_ms: int, silence_ms: int, max_seconds: int):
        self.threshold = threshold
        self.onset_frames = max(1, onset_ms // 20)
        self.silence_frames = max(1, silence_ms // 20)
        self.max_frames = max(1, max_seconds * 50)
        self.pending = bytearray()
        self.preroll: deque[bytes] = deque(maxlen=max(10, self.onset_frames))
        self.audio = bytearray()
        self.started = False
        self.finished = False
        self.loud = 0
        self.quiet = 0
        self.frames = 0

    def feed(self, data: bytes) -> None:
        self.pending.extend(data)
        while len(self.pending) >= self.frame_bytes and not self.finished:
            frame = bytes(self.pending[:self.frame_bytes])
            del self.pending[:self.frame_bytes]
            samples = struct.unpack('<160h', frame)
            active = sum(sample * sample for sample in samples) / 160 >= self.threshold ** 2
            if not self.started:
                self.preroll.append(frame)
                self.loud = self.loud + 1 if active else 0
                if self.loud < self.onset_frames:
                    continue
                self.started = True
                self.audio.extend(b''.join(self.preroll))
            else:
                self.audio.extend(frame)
            self.frames += 1
            self.quiet = 0 if active else self.quiet + 1
            self.finished = self.quiet >= self.silence_frames or self.frames >= self.max_frames


class IncomingSpeech:
    """Tail an unbuffered FreeSWITCH .r8 recording while a reply is in flight."""

    def __init__(self, path: Path, settings, hungup: asyncio.Event):
        self.path = path
        self.started = asyncio.Event()
        self.hungup = hungup
        self.frames = SpeechFrames(settings.barge_in_threshold, settings.barge_in_onset_ms,
                                   settings.barge_in_silence_ms, settings.listen_seconds)

    async def capture(self) -> bytes:
        # A missing/unwritten media file is an operational failure, not silence.
        deadline = time.monotonic() + 3
        while not self.path.exists():
            if self.hungup.is_set():
                return b''
            if time.monotonic() >= deadline:
                raise RuntimeError('FreeSWITCH did not create the inbound audio recording')
            await asyncio.sleep(0.02)
        with self.path.open('rb', buffering=0) as source:
            last_audio = time.monotonic()
            onset_at = None
            while not self.hungup.is_set():
                data = source.read(3200)
                if data:
                    last_audio = time.monotonic()
                    self.frames.feed(data)
                    if self.frames.started:
                        if onset_at is None:
                            onset_at = time.monotonic()
                        self.started.set()
                    if self.frames.finished:
                        return bytes(self.frames.audio)
                else:
                    # DTX or lost media may stop delivering even silence.
                    if onset_at is not None and time.monotonic() - last_audio > 1:
                        return bytes(self.frames.audio)
                    if onset_at is None and time.monotonic() - last_audio > 3:
                        raise RuntimeError('No inbound PCM frames arrived during the response')
                    await asyncio.sleep(0.02)
        return b''
