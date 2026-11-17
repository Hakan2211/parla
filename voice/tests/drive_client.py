"""Manual driver: connects to a running parla-voice and pumps speech at it.

Usage:  uv run python tests/drive_client.py [port]
Requires the mock LLM (tests/mock_llm.py) running on :8992.
"""

import asyncio
import json
import sys
import uuid

import httpx
import numpy as np
import websockets
from pipecat.frames.protobufs import frames_pb2

from parla_voice.tts.kokoro_tts import KokoroTTS

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
UTTERANCE = "Yesterday I went hiking in the mountains with my brother."


def audio_frame(pcm: bytes) -> bytes:
    f = frames_pb2.Frame()
    f.audio.audio = pcm
    f.audio.sample_rate = 16000
    f.audio.num_channels = 1
    f.audio.id = 1
    f.audio.name = "client-audio"
    return f.SerializeToString()


async def main() -> None:
    tts = KokoroTTS()
    await tts.load()
    chunks = [c async for c in tts.synthesize(UTTERANCE, "am_adam")]
    samples = np.frombuffer(b"".join(chunks), dtype=np.int16)
    idx = np.linspace(0, len(samples) - 1, int(len(samples) * 16000 / 24000))
    speech = samples[idx.astype(np.int32)].astype(np.int16).tobytes()
    print(f"speech: {len(speech)/2/16000:.1f}s")

    async with httpx.AsyncClient() as http:
        created = (
            await http.post(
                f"http://127.0.0.1:{PORT}/sessions",
                json={
                    "chat_id": "drive-test",
                    "system_prompt": "You are a friendly voice companion.",
                    "voice": {"engine": "kokoro", "voice_id": "af_heart"},
                    "llm": {
                        "provider": "lmstudio",
                        "model": "mock-model",
                        "base_url": "http://127.0.0.1:8992/v1",
                    },
                },
            )
        ).json()
    print("session:", created)

    async with websockets.connect(created["ws_url"], max_size=None) as ws:
        ready = frames_pb2.Frame()
        ready.message.data = json.dumps(
            {"id": uuid.uuid4().hex[:8], "label": "rtvi-ai", "type": "client-ready", "data": {}}
        )
        await ws.send(ready.SerializeToString())

        async def pump():
            silence = b"\x00" * 640
            for _ in range(25):
                await ws.send(audio_frame(silence))
                await asyncio.sleep(0.02)
            for i in range(0, len(speech), 640):
                await ws.send(audio_frame(speech[i : i + 640]))
                await asyncio.sleep(0.02)
            print("speech sent, sending silence...")
            for _ in range(500):
                await ws.send(audio_frame(silence))
                await asyncio.sleep(0.02)

        pump_task = asyncio.create_task(pump())
        bot_audio = 0
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=20)
                if isinstance(raw, str):
                    print("TEXT:", raw[:200])
                    continue
                f = frames_pb2.Frame.FromString(raw)
                which = f.WhichOneof("frame")
                if which == "audio":
                    bot_audio += len(f.audio.audio)
                    if bot_audio % 48000 < 1280:
                        print(f"bot audio: {bot_audio/2/24000:.1f}s")
                elif which == "message":
                    print("MSG:", f.message.data[:300])
        except (TimeoutError, asyncio.TimeoutError):
            print("recv timeout — done")
        finally:
            pump_task.cancel()


asyncio.run(main())
