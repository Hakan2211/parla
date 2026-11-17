"""Parakeet TDT 0.6B v2 as a VAD-segmented Pipecat STT service.

Inference happens in the ParakeetClient's child process (see
parakeet_worker.py for why); this service just hands segments over.

Segmented STT only produces a transcript when VAD closes the segment, so a
user talking over the bot had to pause before BargeInGate saw any words.
While the bot is speaking, this service therefore also decodes the segment
in progress every ``interim_interval`` seconds and pushes the result as an
InterimTranscriptionFrame. Interims only run while the bot speaks, so they
never delay a normal turn's final transcript.
"""

import asyncio
from typing import AsyncGenerator

from loguru import logger
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    Frame,
    InterimTranscriptionFrame,
    InterruptionFrame,
    TranscriptionFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.stt_service import SegmentedSTTService
from pipecat.utils.time import time_now_iso8601

from parla_voice.stt.parakeet_worker import ParakeetClient

BYTES_PER_SECOND = 16000 * 2  # PCM16 mono 16kHz


class SherpaParakeetSTTService(SegmentedSTTService):
    """Per-session Pipecat service around the shared Parakeet worker."""

    def __init__(
        self,
        *,
        client: ParakeetClient,
        interim_interval: float = 0.3,
        interim_min_audio: float = 0.5,
        interim_max_audio: float = 8.0,
        **kwargs,
    ):
        super().__init__(sample_rate=16000, **kwargs)
        self._client = client
        self._interim_interval = interim_interval
        self._interim_min_bytes = int(interim_min_audio * BYTES_PER_SECOND)
        self._interim_max_bytes = int(interim_max_audio * BYTES_PER_SECOND)
        self._bot_speaking = False
        self._interim_task: asyncio.Task | None = None

    @property
    def wants_wav_segments(self) -> bool:
        return False  # give us raw PCM16, not a WAV container

    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame | None, None]:
        text = await self._transcribe(audio)
        if text:
            yield TranscriptionFrame(
                text=text, user_id="user", timestamp=time_now_iso8601()
            )

    async def _transcribe(self, audio: bytes) -> str:
        return await asyncio.get_running_loop().run_in_executor(
            None, self._client.transcribe, audio
        )

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        # Stop interims *before* the base class transcribes the closed
        # segment, so the final never queues behind a fresh interim decode.
        if isinstance(frame, VADUserStoppedSpeakingFrame):
            await self._stop_interims()

        await super().process_frame(frame, direction)

        if isinstance(frame, BotStartedSpeakingFrame):
            self._bot_speaking = True
            self._maybe_start_interims()
        elif isinstance(frame, (BotStoppedSpeakingFrame, InterruptionFrame)):
            self._bot_speaking = False
            await self._stop_interims()
        elif isinstance(frame, VADUserStartedSpeakingFrame):
            self._maybe_start_interims()

    def _maybe_start_interims(self) -> None:
        if self._bot_speaking and self._user_speaking and self._interim_task is None:
            self._interim_task = self.create_task(self._interim_loop(), "interim-stt")

    async def _stop_interims(self) -> None:
        if self._interim_task is not None:
            task, self._interim_task = self._interim_task, None
            await self.cancel_task(task)

    async def _interim_loop(self) -> None:
        decoded_len = 0
        while True:
            await asyncio.sleep(self._interim_interval)
            size = len(self._audio_buffer)
            if size < self._interim_min_bytes or size == decoded_len:
                continue
            if size > self._interim_max_bytes:
                return  # a monologue this long has long since barged in, or never will
            decoded_len = size
            text = await self._transcribe(bytes(self._audio_buffer))
            if text:
                logger.debug("interim transcript: {}", text)
                await self.push_frame(
                    InterimTranscriptionFrame(
                        text=text, user_id="user", timestamp=time_now_iso8601()
                    )
                )

    async def cleanup(self):
        await self._stop_interims()
        await super().cleanup()
