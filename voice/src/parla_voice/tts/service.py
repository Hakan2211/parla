"""Pipecat TTS service that delegates to a StreamingTTS engine.

Pipecat's TTSService base handles sentence aggregation of the streamed LLM
tokens; we get called once per sentence and stream PCM back as it's made.
"""

from typing import AsyncGenerator

from pipecat.frames.frames import (
    ErrorFrame,
    Frame,
    TTSAudioRawFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
)
from pipecat.services.tts_service import TTSService

from parla_voice.tts.base import StreamingTTS


class ParlaTTSService(TTSService):
    def __init__(self, engine: StreamingTTS, voice_id: str, **kwargs):
        super().__init__(sample_rate=engine.sample_rate, **kwargs)
        self._engine = engine
        self._voice_id = voice_id

    def can_generate_metrics(self) -> bool:
        # Without this, Pipecat silently drops TTFB and character-usage metrics.
        return True

    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame | None, None]:
        try:
            await self.start_tts_usage_metrics(text)  # characters -> usage.delta
            await self.start_ttfb_metrics()
            yield TTSStartedFrame()
            first = True
            async for chunk in self._engine.synthesize(text, self._voice_id):
                if first:
                    await self.stop_ttfb_metrics()
                    first = False
                yield TTSAudioRawFrame(
                    audio=chunk, sample_rate=self._engine.sample_rate, num_channels=1
                )
            yield TTSStoppedFrame()
        except Exception as e:
            yield ErrorFrame(f"TTS error: {e}")
