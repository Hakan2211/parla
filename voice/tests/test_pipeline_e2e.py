"""Full-loop integration test: WS client -> VAD -> STT -> LLM -> TTS -> audio.

Emulates the Electron client over the real websocket protocol:
protobuf-framed audio in (Kokoro-generated speech), audio + RTVI JSON
events out. Uses the mock OpenAI server so no key is needed.
"""

import asyncio
import json
import os
import uuid

import numpy as np
import pytest
import uvicorn
import websockets
from pipecat.frames.protobufs import frames_pb2

from parla_voice.stt.parakeet_worker import DEFAULT_MODEL_DIR
from tests.mock_llm import create_mock_llm

pytestmark = pytest.mark.skipif(
    not DEFAULT_MODEL_DIR.exists(), reason="parakeet model not downloaded"
)

VOICE_PORT = 8794
LLM_PORT = 8995
USER_UTTERANCE = "Yesterday I went hiking in the mountains with my brother."


async def _start_server(app, port: int) -> uvicorn.Server:
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error", ws="auto")
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())
    for _ in range(100):
        if server.started:
            return server
        await asyncio.sleep(0.1)
    task.cancel()
    raise RuntimeError(f"server on {port} failed to start")


def _audio_frame(pcm: bytes, sample_rate: int) -> bytes:
    frame = frames_pb2.Frame()
    frame.audio.audio = pcm
    frame.audio.sample_rate = sample_rate
    frame.audio.num_channels = 1
    frame.audio.id = 1
    frame.audio.name = "client-audio"
    return frame.SerializeToString()


def _rtvi_message(msg_type: str, data: dict | None = None) -> bytes:
    frame = frames_pb2.Frame()
    frame.message.data = json.dumps(
        {"id": uuid.uuid4().hex[:8], "label": "rtvi-ai", "type": msg_type, "data": data or {}}
    )
    return frame.SerializeToString()


async def _make_user_speech() -> bytes:
    """Kokoro speech resampled to 16kHz PCM — realistic input for VAD+STT."""
    from parla_voice.tts.kokoro_tts import KokoroTTS

    tts = KokoroTTS()
    await tts.load()
    chunks = [c async for c in tts.synthesize(USER_UTTERANCE, "am_adam")]
    samples = np.frombuffer(b"".join(chunks), dtype=np.int16)
    idx = np.linspace(0, len(samples) - 1, int(len(samples) * 16000 / 24000))
    return samples[idx.astype(np.int32)].astype(np.int16).tobytes()


@pytest.mark.asyncio
async def test_full_voice_loop():
    from parla_voice.server import create_app

    llm_server = await _start_server(create_mock_llm(), LLM_PORT)
    voice_app = create_app()
    voice_app.state.port = VOICE_PORT
    voice_server = await _start_server(voice_app, VOICE_PORT)

    try:
        speech_16k = await _make_user_speech()

        # Wait for engines (kokoro already cached by _make_user_speech).
        import httpx

        async with httpx.AsyncClient() as http:
            for _ in range(240):
                health = (await http.get(f"http://127.0.0.1:{VOICE_PORT}/health")).json()
                if health["models"]["stt"] and health["models"]["tts"]:
                    break
                await asyncio.sleep(0.5)
            else:
                pytest.fail(f"engines never loaded: {health}")

            created = (
                await http.post(
                    f"http://127.0.0.1:{VOICE_PORT}/sessions",
                    json={
                        "chat_id": "e2e-test",
                        "system_prompt": "You are a friendly voice companion.",
                        "greeting": None,
                        "voice": {"engine": "kokoro", "voice_id": "af_heart"},
                        "llm": {
                            "provider": "lmstudio",
                            "model": "mock-model",
                            "base_url": f"http://127.0.0.1:{LLM_PORT}/v1",
                        },
                        "stt": {"engine": "sherpa"},
                        "limits": {"max_minutes": 5},
                    },
                )
            ).json()

        events: list[dict] = []
        bot_audio = bytearray()

        async with websockets.connect(created["ws_url"], max_size=None) as ws:
            await ws.send(_rtvi_message("client-ready"))

            async def pump_audio():
                # 20ms of leading silence, the utterance, then 1.5s silence
                # so VAD + smart-turn finalize the turn.
                silence = b"\x00" * 640
                for _ in range(25):
                    await ws.send(_audio_frame(silence, 16000))
                    await asyncio.sleep(0.02)
                for i in range(0, len(speech_16k), 640):
                    await ws.send(_audio_frame(speech_16k[i : i + 640], 16000))
                    await asyncio.sleep(0.02)
                for _ in range(300):
                    await ws.send(_audio_frame(silence, 16000))
                    await asyncio.sleep(0.02)

            pump = asyncio.create_task(pump_audio())
            try:
                deadline = asyncio.get_running_loop().time() + 30
                while asyncio.get_running_loop().time() < deadline:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=8)
                    except (TimeoutError, asyncio.TimeoutError):
                        break  # conversation went quiet — evaluate what we got
                    if isinstance(raw, str):
                        continue
                    frame = frames_pb2.Frame.FromString(raw)
                    which = frame.WhichOneof("frame")
                    if which == "audio":
                        bot_audio.extend(frame.audio.audio)
                    elif which == "message":
                        payload = json.loads(frame.message.data)
                        data = payload.get("data", {})
                        if isinstance(data, dict) and "type" in data:
                            events.append(data)  # our custom server messages
                        if (
                            isinstance(data, dict)
                            and data.get("type") == "metrics.turn"
                            and len(bot_audio) > 24000
                        ):
                            break
            finally:
                pump.cancel()

        types = [e["type"] for e in events]
        user_finals = [e for e in events if e["type"] == "user.final"]
        assistant_finals = [e for e in events if e["type"] == "assistant.final"]
        metrics = [e for e in events if e["type"] == "metrics.turn"]

        print(f"\nevents: {types}")
        if user_finals:
            print(f"user.final: {user_finals[0]['text']!r}")
        if assistant_finals:
            print(f"assistant.final: {assistant_finals[0]['text']!r}")
        if metrics:
            print(f"metrics: {metrics[0]}")
        print(f"bot audio: {len(bot_audio) / 2 / 24000:.2f}s")

        assert user_finals, f"no user.final in {types}"
        assert "hiking" in user_finals[0]["text"].lower()
        assert assistant_finals, f"no assistant.final in {types}"
        assert "wonderful" in assistant_finals[0]["text"].lower()
        assert metrics, f"no metrics.turn in {types}"
        assert metrics[0]["voice_to_voice_ms"] is not None
        stt_usage = [e for e in events if e["type"] == "usage.delta" and "stt_seconds" in e]
        assert stt_usage and stt_usage[0]["stt_seconds"] > 0.3, f"no stt usage in {types}"
        assert len(bot_audio) > 24000, "expected at least 0.5s of bot audio"
    finally:
        voice_server.should_exit = True
        llm_server.should_exit = True
        await asyncio.sleep(0.3)


BARGE_PORT = 8795
LONG_GREETING = (
    "Hello there, it is lovely to hear from you again. I was just thinking about "
    "the long walk we talked about last week, and the little cafe by the river, "
    "and whether you ever went back to try the lemon cake they were so proud of."
)


async def _barge_in_latency(speech_16k: bytes, port: int) -> float | None:
    """Seconds from the start of user speech (sent over a talking bot) to the
    bot stopping, or None if it never yielded."""
    import httpx

    async with httpx.AsyncClient() as http:
        for _ in range(240):
            health = (await http.get(f"http://127.0.0.1:{port}/health")).json()
            if health["models"]["stt"] and health["models"]["tts"]:
                break
            await asyncio.sleep(0.5)
        created = (
            await http.post(
                f"http://127.0.0.1:{port}/sessions",
                json={
                    "chat_id": "barge-in-test",
                    "system_prompt": "You are a friendly voice companion.",
                    "greeting": LONG_GREETING,
                    "llm": {
                        "provider": "lmstudio",
                        "model": "mock-model",
                        "base_url": f"http://127.0.0.1:{LLM_PORT}/v1",
                    },
                },
            )
        ).json()

    loop = asyncio.get_running_loop()
    bot_speaking = asyncio.Event()
    speech_started_at: float | None = None
    async with websockets.connect(created["ws_url"], max_size=None) as ws:
        await ws.send(_rtvi_message("client-ready"))

        async def pump_audio():
            nonlocal speech_started_at
            silence = b"\x00" * 640
            while not bot_speaking.is_set():
                await ws.send(_audio_frame(silence, 16000))
                await asyncio.sleep(0.02)
            for _ in range(50):  # let the bot talk for a second
                await ws.send(_audio_frame(silence, 16000))
                await asyncio.sleep(0.02)
            speech_started_at = loop.time()
            for i in range(0, len(speech_16k), 640):
                await ws.send(_audio_frame(speech_16k[i : i + 640], 16000))
                await asyncio.sleep(0.02)
            while True:
                await ws.send(_audio_frame(silence, 16000))
                await asyncio.sleep(0.02)

        pump = asyncio.create_task(pump_audio())
        try:
            deadline = loop.time() + 25
            while loop.time() < deadline:
                raw = await asyncio.wait_for(ws.recv(), timeout=10)
                frame = frames_pb2.Frame.FromString(raw)
                if frame.WhichOneof("frame") != "message":
                    continue
                msg = json.loads(frame.message.data)
                kind = msg.get("type")
                if os.environ.get("BARGE_DEBUG"):  # print the event timeline
                    t0 = speech_started_at or loop.time()
                    print(f"  {loop.time() - t0:+.2f}s {kind} {str(msg.get('data'))[:80]}")
                if kind == "bot-started-speaking":
                    bot_speaking.set()
                elif kind == "bot-stopped-speaking" and speech_started_at is not None:
                    return loop.time() - speech_started_at
        finally:
            pump.cancel()
    return None


@pytest.mark.asyncio
async def test_barge_in_uses_interim_transcripts(monkeypatch):
    """Talking over the bot interrupts it mid-utterance, not after a pause."""
    from parla_voice.server import create_app
    from parla_voice.stt import sherpa_stt

    llm_server = await _start_server(create_mock_llm(), LLM_PORT)
    voice_app = create_app()
    voice_app.state.port = BARGE_PORT
    voice_server = await _start_server(voice_app, BARGE_PORT)
    try:
        speech = await _make_user_speech()
        speech_s = len(speech) / 2 / 16000
        with_interims = await _barge_in_latency(speech, BARGE_PORT)

        orig_init = sherpa_stt.SherpaParakeetSTTService.__init__
        monkeypatch.setattr(
            sherpa_stt.SherpaParakeetSTTService,
            "__init__",
            lambda self, **kw: orig_init(self, **{**kw, "interim_interval": 3600}),
        )
        finals_only = await _barge_in_latency(speech, BARGE_PORT)

        print(
            f"\nuser speech {speech_s:.2f}s; bot yielded after "
            f"{with_interims}s with interims, {finals_only}s with finals only"
        )
        assert with_interims is not None
        assert with_interims < speech_s, "bot kept talking until the user paused"
        assert finals_only is None or with_interims < finals_only
    finally:
        voice_server.should_exit = True
        llm_server.should_exit = True
        await asyncio.sleep(0.3)
