"""Shared model singletons, loaded once at server startup in a worker thread."""

import asyncio
import os

from loguru import logger

from parla_voice.stt.parakeet_worker import ParakeetClient
from parla_voice.tts.base import StreamingTTS
from parla_voice.tts.fish_tts import DEFAULT_BASE_URL, fish_available
from parla_voice.tts.kokoro_tts import KokoroTTS


class Engines:
    def __init__(self) -> None:
        self.parakeet: ParakeetClient | None = None
        self.kokoro: KokoroTTS | None = None
        self._ready = asyncio.Event()

    @property
    def status(self) -> dict[str, bool]:
        return {"stt": self.parakeet is not None, "tts": self.kokoro is not None}

    async def wait_ready(self, timeout: float = 90.0) -> None:
        """Block until both engines are loaded.

        A session can arrive while models are still loading (e.g. the app
        adopted a server that answers /health before load() finishes) —
        waiting here turns that race into a short delay instead of a crash.
        """
        await asyncio.wait_for(self._ready.wait(), timeout)

    def tts_for(self, engine: str) -> StreamingTTS:
        if engine == "kokoro":
            assert self.kokoro is not None, "TTS not loaded yet"
            return self.kokoro
        raise ValueError(f"unknown TTS engine: {engine}")

    async def resolve_tts(self, engine: str) -> tuple[str, StreamingTTS]:
        """Resolve the requested engine, falling back to kokoro when the
        fish server isn't running. Returns (actual_engine, instance)."""
        if engine == "fish":
            fish = await fish_available(
                os.environ.get("PARLA_FISH_URL", DEFAULT_BASE_URL)
            )
            if fish is not None:
                return "fish", fish
            logger.warning("fish requested but unavailable — falling back to kokoro")
        return "kokoro", self.tts_for("kokoro")

    async def load(self) -> None:
        loop = asyncio.get_running_loop()

        def _load_stt() -> ParakeetClient:
            client = ParakeetClient()
            client.wait_ready()
            return client

        stt_future = loop.run_in_executor(None, _load_stt)

        kokoro = KokoroTTS()
        await kokoro.load()
        # First synthesis on a fresh CUDA context pays kernel/graph warm-up
        # (measured ~2s TTFB on the first real reply). Pay it at startup.
        async for _ in kokoro.synthesize("Hello there.", "af_heart"):
            pass
        self.kokoro = kokoro
        logger.info("TTS ready (warmed up)")

        self.parakeet = await stt_future
        logger.info("STT ready")
        self._ready.set()

    def close(self) -> None:
        if self.parakeet is not None:
            self.parakeet.close()
