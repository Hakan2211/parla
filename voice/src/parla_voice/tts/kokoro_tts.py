"""Kokoro-82M in-process TTS (torch, CUDA when available)."""

import asyncio
from typing import AsyncIterator

import numpy as np
import torch
from loguru import logger

from parla_voice.tts.base import StreamingTTS


class KokoroTTS(StreamingTTS):
    sample_rate = 24000

    def __init__(self, lang_code: str = "a"):  # 'a' = American English
        self._lang_code = lang_code
        self._pipeline = None

    async def load(self) -> None:
        if self._pipeline is not None:
            return

        def _load():
            from kokoro import KPipeline

            device = "cuda" if torch.cuda.is_available() else "cpu"
            pipeline = KPipeline(lang_code=self._lang_code, device=device)
            logger.info("kokoro loaded on {}", device)
            return pipeline

        self._pipeline = await asyncio.get_running_loop().run_in_executor(None, _load)

    async def synthesize(self, text: str, voice: str) -> AsyncIterator[bytes]:
        assert self._pipeline is not None, "call load() first"
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[bytes | None] = asyncio.Queue()

        def _generate():
            try:
                for result in self._pipeline(text, voice=voice):
                    audio = result.audio
                    if audio is None:
                        continue
                    pcm = (
                        (audio.detach().cpu().numpy() * 32767.0)
                        .clip(-32768, 32767)
                        .astype(np.int16)
                        .tobytes()
                    )
                    loop.call_soon_threadsafe(queue.put_nowait, pcm)
            except Exception:
                logger.exception("kokoro synthesis failed")
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        loop.run_in_executor(None, _generate)
        while True:
            chunk = await queue.get()
            if chunk is None:
                break
            yield chunk
