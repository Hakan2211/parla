"""Engine smoke tests: Kokoro TTS latency + Parakeet STT round-trip."""

import asyncio
import time

import numpy as np
import pytest

from parla_voice.stt.parakeet_worker import DEFAULT_MODEL_DIR, ParakeetClient
from parla_voice.tts.kokoro_tts import KokoroTTS

pytestmark = pytest.mark.skipif(
    not DEFAULT_MODEL_DIR.exists(), reason="parakeet model not downloaded"
)

SENTENCE = "Hello there, how has your day been going so far?"


@pytest.fixture(scope="module")
def kokoro():
    tts = KokoroTTS()
    asyncio.run(tts.load())
    return tts


@pytest.fixture(scope="module")
def parakeet():
    client = ParakeetClient()
    client.wait_ready()
    yield client
    client.close()


def _synthesize(kokoro: KokoroTTS, text: str) -> tuple[bytes, float]:
    async def run() -> tuple[bytes, float]:
        chunks = []
        started = time.perf_counter()
        first_chunk_at = None
        async for chunk in kokoro.synthesize(text, "af_heart"):
            if first_chunk_at is None:
                first_chunk_at = time.perf_counter() - started
            chunks.append(chunk)
        assert first_chunk_at is not None, "no audio produced"
        return b"".join(chunks), first_chunk_at

    return asyncio.run(run())


def test_kokoro_first_chunk_latency(kokoro):
    _synthesize(kokoro, "Warm up.")  # first call pays CUDA/model warmup
    audio, first_chunk_s = _synthesize(kokoro, SENTENCE)
    duration_s = len(audio) / 2 / kokoro.sample_rate
    print(f"\nkokoro: first chunk {first_chunk_s*1000:.0f}ms, {duration_s:.1f}s audio")
    assert duration_s > 1.0
    assert first_chunk_s < 1.0, "first audio chunk too slow for realtime"


def test_stt_round_trip(kokoro, parakeet):
    audio_24k, _ = _synthesize(kokoro, SENTENCE)
    # resample 24k -> 16k for the recognizer input format
    samples = np.frombuffer(audio_24k, dtype=np.int16)
    idx = np.linspace(0, len(samples) - 1, int(len(samples) * 16000 / 24000))
    samples_16k = samples[idx.astype(np.int32)].astype(np.int16).tobytes()

    started = time.perf_counter()
    text = parakeet.transcribe(samples_16k).lower()
    stt_ms = (time.perf_counter() - started) * 1000

    print(f"\nparakeet: {stt_ms:.0f}ms -> {text!r}")
    for word in ("hello", "day", "going"):
        assert word in text
    assert stt_ms < 1000
