"""Interim STT while the bot speaks, and barge-in on interim words."""

import threading
import time

import pytest
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    InputAudioRawFrame,
    InterimTranscriptionFrame,
    InterruptionFrame,
    TranscriptionFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.tests.utils import SleepFrame, run_test

from parla_voice.pipeline import BargeInGate
from parla_voice.stt.sherpa_stt import SherpaParakeetSTTService

CHUNK = b"\x01\x00" * 1600  # 100ms of PCM16 @ 16kHz


class FakeParakeet:
    """Returns one word per 0.25s of audio, like a real decoder would."""

    def __init__(self, decode_s: float = 0.02):
        self.calls: list[int] = []
        self._decode_s = decode_s
        self._lock = threading.Lock()

    def transcribe(self, audio: bytes) -> str:
        with self._lock:
            self.calls.append(len(audio))
            time.sleep(self._decode_s)
            return " ".join(["word"] * int(len(audio) / 32000 / 0.25))


def _speech(seconds: float, *, sleep: bool = True) -> list:
    frames = []
    for _ in range(int(seconds * 10)):
        frames.append(InputAudioRawFrame(audio=CHUNK, sample_rate=16000, num_channels=1))
        if sleep:
            frames.append(SleepFrame(sleep=0.1))
    return frames


def _stt(client: FakeParakeet) -> SherpaParakeetSTTService:
    return SherpaParakeetSTTService(client=client, interim_interval=0.2)


@pytest.mark.asyncio
async def test_interims_while_bot_speaks():
    client = FakeParakeet()
    down, _ = await run_test(
        _stt(client),
        frames_to_send=[
            BotStartedSpeakingFrame(),
            VADUserStartedSpeakingFrame(),
            *_speech(1.5),
            VADUserStoppedSpeakingFrame(),
            SleepFrame(sleep=0.1),
        ],
    )
    interims = [f for f in down if isinstance(f, InterimTranscriptionFrame)]
    finals = [f for f in down if isinstance(f, TranscriptionFrame)]
    assert len(interims) >= 3
    assert len(finals) == 1
    # interims grow with the segment, the final covers all of it
    assert len(interims[-1].text.split()) <= len(finals[0].text.split())


@pytest.mark.asyncio
async def test_no_interims_when_bot_silent():
    client = FakeParakeet()
    down, _ = await run_test(
        _stt(client),
        frames_to_send=[
            VADUserStartedSpeakingFrame(),
            *_speech(1.2),
            VADUserStoppedSpeakingFrame(),
            SleepFrame(sleep=0.1),
        ],
    )
    assert not [f for f in down if isinstance(f, InterimTranscriptionFrame)]
    assert len(client.calls) == 1  # just the final


@pytest.mark.asyncio
async def test_interims_stop_when_bot_stops():
    client = FakeParakeet()
    await run_test(
        _stt(client),
        frames_to_send=[
            BotStartedSpeakingFrame(),
            VADUserStartedSpeakingFrame(),
            *_speech(0.8),
            BotStoppedSpeakingFrame(),
            *_speech(1.0),
            VADUserStoppedSpeakingFrame(),
            SleepFrame(sleep=0.1),
        ],
    )
    calls_after_bot_stop = [n for n in client.calls if n > 1.4 * 32000]
    assert calls_after_bot_stop == [client.calls[-1]]  # only the final


@pytest.mark.asyncio
async def test_gate_fires_on_interim_words():
    gate = BargeInGate(min_words=3)
    down, up = await run_test(
        gate,
        frames_to_send=[
            BotStartedSpeakingFrame(),
            InterimTranscriptionFrame(text="wait", user_id="user", timestamp=""),
            InterimTranscriptionFrame(text="wait hold on", user_id="user", timestamp=""),
            SleepFrame(sleep=0.05),
        ],
    )
    assert any(isinstance(f, InterruptionFrame) for f in down + up)


@pytest.mark.asyncio
async def test_gate_ignores_short_interims():
    gate = BargeInGate(min_words=3)
    down, up = await run_test(
        gate,
        frames_to_send=[
            BotStartedSpeakingFrame(),
            InterimTranscriptionFrame(text="mm", user_id="user", timestamp=""),
            InterimTranscriptionFrame(text="mm hm", user_id="user", timestamp=""),
            SleepFrame(sleep=0.05),
        ],
    )
    assert not any(isinstance(f, InterruptionFrame) for f in down + up)
