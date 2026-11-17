"""fish-audio s2-pro via a locally running fish-speech API server.

The user starts the server from their fish-speech checkout, e.g.:

  cd D:\\fish-speech
  uv run tools/api_server.py --listen 127.0.0.1:8080 \\
      --llama-checkpoint-path checkpoints/s2-pro \\
      --decoder-checkpoint-path checkpoints/s2-pro/codec.pth

Protocol (verified against tools/server/views.py in that checkout):
POST /v1/tts with an ormsgpack-encoded ServeTTSRequest, streaming=true,
format=wav → chunked response: one WAV header, then raw PCM16 segments.

Note: s2-pro's license is non-commercial — fine for this personal build.
"""

import asyncio
import struct

import httpx
import ormsgpack
from loguru import logger

from parla_voice.tts.base import StreamingTTS

DEFAULT_BASE_URL = "http://127.0.0.1:8080"
KOKORO_VOICE_PREFIXES = ("af_", "am_", "bf_", "bm_", "ef_", "em_", "ff_", "hf_", "hm_")


def _parse_wav_header(header: bytes) -> tuple[int, int]:
    """Return (sample_rate, num_channels) from a RIFF/WAVE header blob."""
    if len(header) < 36 or header[:4] != b"RIFF" or header[8:12] != b"WAVE":
        raise ValueError("not a WAV header")
    num_channels = struct.unpack_from("<H", header, 22)[0]
    sample_rate = struct.unpack_from("<I", header, 24)[0]
    return sample_rate, num_channels


class FishSpeechTTS(StreamingTTS):
    sample_rate = 44100  # refined by probe() from the server's actual WAV header

    def __init__(self, base_url: str = DEFAULT_BASE_URL):
        self._base_url = base_url.rstrip("/")
        self._client: httpx.AsyncClient | None = None

    async def load(self) -> None:
        if self._client is None:
            self._client = httpx.AsyncClient(base_url=self._base_url, timeout=30)

    async def probe(self) -> bool:
        """True if the fish server answers /v1/health (cheap — no synthesis).

        sample_rate stays at the s2-pro codec's 44100 default; the WAV header
        of the first real synthesis corrects it if a different codec is loaded.
        """
        await self.load()
        assert self._client is not None
        try:
            response = await self._client.get("/v1/health", timeout=3)
            return response.status_code < 500
        except Exception as e:
            logger.info("fish server not available at {}: {}", self._base_url, e)
            return False

    async def _synth_chunks(self, text: str, reference_id: str | None):
        assert self._client is not None
        request = {
            "text": text,
            "chunk_length": 200,
            "format": "wav",
            "references": [],
            "reference_id": reference_id,
            "normalize": True,
            "streaming": True,
            "max_new_tokens": 1024,
            "top_p": 0.8,
            "repetition_penalty": 1.1,
            "temperature": 0.8,
        }
        async with self._client.stream(
            "POST",
            "/v1/tts",
            content=ormsgpack.packb(request),
            headers={"Content-Type": "application/msgpack"},
            timeout=httpx.Timeout(10, read=120),
        ) as response:
            response.raise_for_status()
            first = True
            async for chunk in response.aiter_bytes():
                if not chunk:
                    continue
                if first and chunk[:4] == b"RIFF":
                    first = False
                    try:
                        rate, _ = _parse_wav_header(chunk)
                        type(self).sample_rate = rate
                    except ValueError:
                        pass
                    # Anything after the 44-byte header in this chunk is audio.
                    remainder = chunk[44:]
                    if remainder:
                        yield remainder
                    continue
                first = False
                yield chunk

    async def synthesize(self, text: str, voice: str):
        # Kokoro-style voice ids mean "no fish reference voice configured".
        reference_id = None if voice.startswith(KOKORO_VOICE_PREFIXES) else voice or None
        async for chunk in self._synth_chunks(text, reference_id):
            yield chunk

    async def close(self) -> None:
        if self._client is not None:
            client, self._client = self._client, None
            await client.aclose()


async def fish_available(base_url: str = DEFAULT_BASE_URL) -> FishSpeechTTS | None:
    """Probe helper: a ready-to-use engine, or None if the server is down."""
    engine = FishSpeechTTS(base_url)
    if await engine.probe():
        logger.info("fish s2-pro server ready at {} ({}Hz)", base_url, engine.sample_rate)
        return engine
    await engine.close()
    return None
