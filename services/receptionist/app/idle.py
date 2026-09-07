"""A call-local inactivity deadline that also interrupts stalled AI work."""
from __future__ import annotations

import asyncio


class CallerIdleTimeout(TimeoutError):
    pass


class CallerIdleDeadline:
    def __init__(self, seconds: float):
        self.seconds = seconds
        self._timer = None
        self._expired = False
        self._task = None

    def __enter__(self):
        self._task = asyncio.current_task()
        self.touch()
        return self

    def touch(self) -> None:
        if self._timer is not None:
            self._timer.cancel()
        # Zero is used by existing sequential call fixtures. Deployed settings
        # are clamped to positive values.
        if self.seconds > 0:
            self._timer = asyncio.get_running_loop().call_later(self.seconds, self._expire)

    def _expire(self) -> None:
        self._expired = True
        self._task.cancel()

    def __exit__(self, kind, value, traceback):
        if self._timer is not None:
            self._timer.cancel()
        if kind is asyncio.CancelledError and self._expired:
            if hasattr(self._task, 'uncancel'):
                self._task.uncancel()
            raise CallerIdleTimeout('Caller inactivity deadline reached') from None
        return False
