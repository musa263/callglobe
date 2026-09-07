from __future__ import annotations

import asyncio
import logging
import signal

from .api import VocivoApi
from .brain import Brain
from .call import CallHandler
from .config import Settings
from .esl import EslConnection
from .speech import Ears, Voice

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
# HTTP client info logs include query strings containing caller numbers.
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("vocivo.receptionist")


async def serve() -> None:
    settings = Settings.from_env()
    missing = settings.missing()
    if missing:
        # Fail at start-up rather than halfway through a stranger's call.
        raise SystemExit(f"the receptionist cannot start without: {', '.join(missing)}")

    voice = Voice(settings)
    ears = Ears(settings)
    brain = Brain(settings)
    api = VocivoApi(settings)
    handler = CallHandler(settings, voice, ears, brain, api)

    log.info("language model %s at %s (workspace %s); voice engine at %s", settings.llm_model, settings.llm_base_url, settings.llm_workspace_id or "not set", settings.tts_url)
    log.info("warming the speech recogniser")
    await ears.warm()

    async def on_connection(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        connection = EslConnection(reader, writer)
        try:
            await handler.handle(connection)
        except Exception as error:  # noqa: BLE001 - one bad call must not stop the service
            log.exception("unhandled error on a call: %s", error)
            await connection.close()

    server = await asyncio.start_server(on_connection, settings.listen_host, settings.listen_port)
    where = ", ".join(str(socket.getsockname()) for socket in server.sockets or [])
    log.info("receptionist listening for FreeSWITCH on %s", where)

    stopping = asyncio.Event()
    loop = asyncio.get_running_loop()
    for name in (signal.SIGINT, signal.SIGTERM):
        # Calls in progress finish; new ones stop arriving.
        loop.add_signal_handler(name, stopping.set)

    async with server:
        await stopping.wait()

    log.info("shutting down")
    await asyncio.gather(voice.close(), brain.close(), api.close(), return_exceptions=True)


def run() -> None:
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    run()
