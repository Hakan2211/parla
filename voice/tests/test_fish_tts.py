"""fish s2-pro adapter test — needs the fish-speech server running on :8080.

Skipped automatically when the server is down, so the suite stays green
without it.
"""

import asyncio
import time

import httpx
import pytest

from parla_voice.tts.fish_tts import DEFAULT_BASE_URL, FishSpeechTTS


def _server_up() -> bool:
    try:
        httpx.get(DEFAULT_BASE_URL + "/v1/health", timeout=2)
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _server_up(), reason="fish server not running")


def test_fish_streaming_synthesis():
    async def run():
        tts = FishSpeechTTS()
        await tts.load()
        try:
            started = time.perf_counter()
            first_at = None
            total = 0
            async for chunk in tts.synthesize(
                "Hello there, how has your day been going so far?", "af_heart"
            ):
                if first_at is None:
                    first_at = time.perf_counter() - started
                total += len(chunk)
            assert first_at is not None, "no audio chunks received"
            duration = total / 2 / tts.sample_rate
            print(
                f"\nfish s2-pro: first chunk {first_at*1000:.0f}ms, "
                f"{duration:.1f}s audio @ {tts.sample_rate}Hz"
            )
            assert duration > 1.0
        finally:
            await tts.close()

    asyncio.run(run())
