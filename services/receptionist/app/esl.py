from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Iterable
from urllib.parse import unquote

log = logging.getLogger("vocivo.esl")

# FreeSWITCH's Event Socket, outbound mode: FreeSWITCH connects to us, one
# connection per call. Talking the protocol directly rather than through a
# library is about 150 lines and removes a dependency that would otherwise sit
# in the middle of every customer call.


@dataclass
class Message:
    """One framed Event Socket message."""

    headers: dict[str, str] = field(default_factory=dict)
    body: str = ""
    #: For `text/event-plain`, the event's own header block, already decoded.
    event: dict[str, str] = field(default_factory=dict)

    @property
    def content_type(self) -> str:
        return self.headers.get("Content-Type", "")

    @property
    def event_name(self) -> str:
        return self.event.get("Event-Name", "")

    def reply_ok(self) -> bool:
        return self.headers.get("Reply-Text", "").startswith("+OK")


def parse_header_block(text: str) -> dict[str, str]:
    """
    Parses `Name: value` lines.

    Event header values are URL-encoded by FreeSWITCH — a caller name with a
    space arrives as `Sam%20Tailor` — so every value is unquoted here rather
    than at each use, where one missed call would show the raw escape.
    """
    headers: dict[str, str] = {}
    for line in text.split("\n"):
        if not line.strip():
            continue
        name, separator, value = line.partition(":")
        if not separator:
            continue
        headers[name.strip()] = unquote(value.strip())
    return headers


class EslProtocolError(RuntimeError):
    pass


class EslConnection:
    """
    One call's connection.

    Commands are serialised behind a lock and every command waits for its own
    reply, so two overlapping `execute` calls can never consume each other's
    acknowledgement. Events that arrive meanwhile are queued rather than
    dropped: CHANNEL_HANGUP in particular has to survive being received in the
    middle of something else, or the app talks to a call that has gone.
    """

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self._reader = reader
        self._writer = writer
        self._events: asyncio.Queue[Message] = asyncio.Queue()
        self._lock = asyncio.Lock()
        self.channel: dict[str, str] = {}
        self.hungup = asyncio.Event()

    # -- framing ---------------------------------------------------------

    async def _read_message(self) -> Message:
        header_lines: list[str] = []
        while True:
            raw = await self._reader.readline()
            if not raw:
                raise EslProtocolError("the Event Socket closed")
            line = raw.decode("utf-8", "replace").rstrip("\r\n")
            if line == "":
                break
            header_lines.append(line)
        headers = parse_header_block("\n".join(header_lines))
        body = ""
        length = int(headers.get("Content-Length", "0") or 0)
        if length:
            body = (await self._reader.readexactly(length)).decode("utf-8", "replace")
        message = Message(headers=headers, body=body)
        if headers.get("Content-Type", "").startswith("text/event-plain"):
            message.event = parse_header_block(body)
        elif headers.get("Content-Type", "").startswith("command/reply") and body:
            message.event = parse_header_block(body)
        return message

    async def _next(self) -> Message:
        message = await self._read_message()
        if message.event.get("Event-Name") in {"CHANNEL_HANGUP", "CHANNEL_HANGUP_COMPLETE", "CHANNEL_DESTROY"}:
            self.hungup.set()
        return message

    # -- commands --------------------------------------------------------

    async def _send(self, text: str) -> Message:
        async with self._lock:
            self._writer.write(text.encode("utf-8"))
            await self._writer.drain()
            while True:
                message = await self._next()
                if message.content_type.startswith(("command/reply", "api/response")):
                    return message
                await self._events.put(message)

    async def connect(self) -> dict[str, str]:
        """Completes the outbound handshake and returns the channel variables."""
        reply = await self._send("connect\n\n")
        self.channel = {**reply.headers, **reply.event}
        # linger keeps the socket alive long enough to see the hangup event, so
        # a conversation is never cut off mid-sentence without us noticing.
        await self._send("linger\n\n")
        await self._send("myevents\n\n")
        await self._send("event plain CHANNEL_EXECUTE_COMPLETE CHANNEL_HANGUP CHANNEL_HANGUP_COMPLETE DTMF\n\n")
        return self.channel

    @property
    def uuid(self) -> str:
        return self.channel.get("Unique-ID", "") or self.channel.get("Channel-Unique-ID", "")

    async def execute(self, app: str, arg: str = "", *, timeout: float = 120.0) -> Message | None:
        """
        Runs a dialplan application and waits for it to finish.

        `event-lock` makes FreeSWITCH queue applications rather than run them
        concurrently, which is what keeps a greeting from being talked over by
        the recording that follows it.
        """
        command = (
            "sendmsg\n"
            "call-command: execute\n"
            f"execute-app-name: {app}\n"
            "event-lock: true\n"
        )
        if arg:
            command += f"content-type: text/plain\ncontent-length: {len(arg.encode('utf-8'))}\n\n{arg}\n"
        else:
            command += "\n"
        reply = await self._send(command)
        if not reply.reply_ok():
            raise EslProtocolError(f"{app} was refused: {reply.headers.get('Reply-Text', '')!r}")
        return await self._await_completion(app, timeout=timeout)

    async def _await_completion(self, app: str, *, timeout: float) -> Message | None:
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                log.warning("%s did not report completion within %ss", app, timeout)
                return None
            try:
                message = await asyncio.wait_for(self._drain_or_read(), timeout=remaining)
            except asyncio.TimeoutError:
                return None
            if self.hungup.is_set():
                return None
            if message.event_name == "CHANNEL_EXECUTE_COMPLETE" and message.event.get("Application") == app:
                return message

    async def _drain_or_read(self) -> Message:
        if not self._events.empty():
            return self._events.get_nowait()
        return await self._next()

    async def api(self, command: str) -> str:
        reply = await self._send(f"api {command}\n\n")
        return reply.body.strip()

    async def set(self, name: str, value: str) -> None:
        await self.execute("set", f"{name}={value}")

    async def hangup(self, cause: str = "NORMAL_CLEARING") -> None:
        try:
            await self._send(f"sendmsg\ncall-command: execute\nexecute-app-name: hangup\nexecute-app-arg: {cause}\n\n")
        except (EslProtocolError, ConnectionError):
            pass

    async def close(self) -> None:
        try:
            self._writer.close()
            await self._writer.wait_closed()
        except (ConnectionError, RuntimeError):
            pass


def channel_variable(channel: dict[str, str], *names: str) -> str:
    """First non-empty value among several spellings of the same variable."""
    for name in names:
        value = channel.get(name) or channel.get(f"variable_{name}")
        if value:
            return value
    return ""


def digits_from(events: Iterable[Message]) -> str:
    return "".join(event.event.get("DTMF-Digit", "") for event in events)
