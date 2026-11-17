"""Entrypoint: `parla-voice --port 8790`."""

import argparse
import os
import signal
import sys

import uvicorn
from loguru import logger

from parla_voice.server import create_app


def cli() -> None:
    parser = argparse.ArgumentParser(prog="parla-voice")
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("PARLA_VOICE_PORT", "8790")),
    )
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    logger.remove()
    logger.add(sys.stderr, level=os.environ.get("PARLA_LOG_LEVEL", "INFO"))

    app = create_app()
    app.state.port = args.port

    config = uvicorn.Config(
        app, host=args.host, port=args.port, log_level="warning", ws="auto"
    )
    server = uvicorn.Server(config)
    app.state.stop = lambda: setattr(server, "should_exit", True)

    # Electron sends CTRL_BREAK on Windows for graceful stop.
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, lambda *_: app.state.stop())

    logger.info("parla-voice listening on {}:{}", args.host, args.port)
    server.run()


if __name__ == "__main__":
    cli()
