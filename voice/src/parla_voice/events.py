"""Turn-level metrics + authoritative transcript events.

TurnMetricsObserver watches every frame pushed through the pipeline and
emits custom RTVI server messages the client persists:

  assistant.final  — what the assistant actually said (interruption-aware)
  metrics.turn     — per-stage latency for the docs' latency budget
  usage.delta      — incremental usage the app prices and sums per session:
                     LLM tokens (normalized: input_tokens excludes cache
                     reads/writes), TTS characters + seconds of bot audio,
                     seconds of user speech sent to STT

(user.final — the aggregated per-turn user transcript — is emitted from
pipeline.py via the user context aggregator's on_user_turn_message_added.)

Timeline per turn (pipeline clock, ns). The turn waits for its final
transcription, so UserStoppedSpeaking comes *after* the Transcription:
  VADUserStoppedSpeaking ─ stt ─ Transcription
  VADUserStoppedSpeaking ─ eot ─ UserStoppedSpeaking (smart-turn + STT wait)
  max(Transcription, UserStoppedSpeaking) ─ llm_ttft ─ first LLMText
    ─ tts_ttfb ─ first TTSAudioRaw
  voice_to_voice = VADUserStoppedSpeaking (fallback UserStoppedSpeaking)
                   → first TTSAudioRaw
"""

import uuid
from typing import Callable

from loguru import logger
from pipecat.frames.frames import (
    BotStoppedSpeakingFrame,
    InterruptionFrame,
    MetricsFrame,
    VADUserStartedSpeakingFrame,
    LLMFullResponseEndFrame,
    LLMTextFrame,
    TranscriptionFrame,
    TTSAudioRawFrame,
    UserStoppedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.metrics.metrics import LLMUsageMetricsData, TTSUsageMetricsData
from pipecat.observers.base_observer import BaseObserver, FramePushed
from pipecat.processors.frameworks.rtvi import RTVIProcessor
from pipecat.services.tts_service import TTSService


def _ms(t_from: int | None, t_to: int | None) -> int | None:
    if t_from is None or t_to is None:
        return None
    return round((t_to - t_from) / 1_000_000)


class TurnMetricsObserver(BaseObserver):
    def __init__(
        self, rtvi: RTVIProcessor, model_name: Callable[[], str | None] = lambda: None
    ):
        super().__init__()
        self._rtvi = rtvi
        self._model_name = model_name
        # usage accumulated until the next flush point
        self._t_vad_start: int | None = None
        self._tts_chars = 0
        self._tts_bytes = 0
        self._tts_sample_rate = 24000
        self._seen: set[int] = set()
        self._turn_id = uuid.uuid4().hex[:8]
        # per-turn timings
        self._t_vad_stop: int | None = None
        self._t_user_stop: int | None = None
        self._t_transcription: int | None = None
        self._t_first_token: int | None = None
        self._metrics_armed = False
        # assistant response accumulation
        self._response_text = ""
        self._in_response = False

    async def _send(self, payload: dict) -> None:
        try:
            await self._rtvi.send_server_message(payload)
        except Exception:
            logger.exception("failed to send server message")

    async def _finish_response(self, interrupted: bool) -> None:
        if self._in_response and self._response_text.strip():
            await self._send(
                {
                    "type": "assistant.final",
                    "turn_id": self._turn_id,
                    "text": self._response_text.strip(),
                    "interrupted": interrupted,
                }
            )
        self._response_text = ""
        self._in_response = False

    async def on_push_frame(self, data: FramePushed) -> None:
        frame, ts = data.frame, data.timestamp
        # Every push between processors fires an event; act once per frame.
        if frame.id in self._seen:
            return
        self._seen.add(frame.id)
        if len(self._seen) > 4096:
            self._seen.clear()

        if isinstance(frame, VADUserStartedSpeakingFrame):
            self._t_vad_start = ts

        elif isinstance(frame, VADUserStoppedSpeakingFrame):
            self._t_vad_stop = ts
            if self._t_vad_start is not None:
                secs = (ts - self._t_vad_start) / 1e9
                self._t_vad_start = None
                await self._send({"type": "usage.delta", "stt_seconds": round(secs, 2)})

        elif isinstance(frame, MetricsFrame):
            for item in frame.data:
                if isinstance(item, LLMUsageMetricsData):
                    await self._send_llm_usage(item)
                elif isinstance(item, TTSUsageMetricsData):
                    self._tts_chars += item.value

        elif isinstance(frame, BotStoppedSpeakingFrame):
            await self._flush_tts_usage()

        elif isinstance(frame, UserStoppedSpeakingFrame):
            self._t_user_stop = ts

        elif isinstance(frame, InterruptionFrame):
            await self._finish_response(interrupted=True)

        elif isinstance(frame, TranscriptionFrame):
            # A finalized user utterance re-arms the whole turn measurement.
            # The authoritative user.final text is sent per *turn* (aggregated
            # across VAD segments) from pipeline.py, not per transcription.
            self._turn_id = uuid.uuid4().hex[:8]
            self._t_transcription = ts
            self._t_user_stop = None  # this turn's stop comes after its transcript
            self._t_first_token = None
            self._metrics_armed = True

        elif isinstance(frame, LLMTextFrame):
            if self._t_first_token is None:
                self._t_first_token = ts
            self._in_response = True
            self._response_text += frame.text

        elif isinstance(frame, LLMFullResponseEndFrame):
            await self._finish_response(interrupted=False)

        elif isinstance(frame, TTSAudioRawFrame):
            # The output transport re-chunks audio into new frames; count only
            # what the TTS service itself produced, or audio is double-counted.
            if isinstance(data.source, TTSService):
                self._tts_bytes += len(frame.audio)
                self._tts_sample_rate = frame.sample_rate
            if self._metrics_armed:
                self._metrics_armed = False
                await self._emit_metrics(t_first_audio=ts)

    async def _send_llm_usage(self, item: LLMUsageMetricsData) -> None:
        tokens = item.value
        cache_read = tokens.cache_read_input_tokens or 0
        cache_write = tokens.cache_creation_input_tokens or 0
        payload = {
            "type": "usage.delta",
            "model": self._model_name() or getattr(item, "model", None),
            "input_tokens": max(tokens.prompt_tokens - cache_read - cache_write, 0),
            "cache_read_tokens": cache_read,
            "cache_write_tokens": cache_write,
            "output_tokens": tokens.completion_tokens,
        }
        cost = getattr(tokens, "cost_usd", None)  # provider-reported, if any
        if cost is not None:
            payload["cost_usd"] = cost
        await self._send(payload)
        logger.info("llm usage: {}", payload)

    async def _flush_tts_usage(self) -> None:
        if not self._tts_chars and not self._tts_bytes:
            return
        secs = self._tts_bytes / 2 / max(self._tts_sample_rate, 1)  # PCM16 mono
        await self._send(
            {
                "type": "usage.delta",
                "tts_chars": self._tts_chars,
                "tts_seconds": round(secs, 2),
            }
        )
        self._tts_chars = 0
        self._tts_bytes = 0

    async def _emit_metrics(self, t_first_audio: int) -> None:
        start = self._t_vad_stop or self._t_user_stop
        # The LLM is triggered by whichever comes last: the transcript or the
        # turn-end decision.
        llm_start = max(
            (t for t in (self._t_transcription, self._t_user_stop) if t is not None),
            default=None,
        )
        payload = {
            "type": "metrics.turn",
            "turn_id": self._turn_id,
            "eot_ms": _ms(self._t_vad_stop, self._t_user_stop),
            "stt_ms": _ms(self._t_vad_stop, self._t_transcription),
            "llm_ttft_ms": _ms(llm_start, self._t_first_token),
            "tts_ttfb_ms": _ms(self._t_first_token, t_first_audio),
            "voice_to_voice_ms": _ms(start, t_first_audio),
        }
        await self._send(payload)
        logger.info("turn metrics: {}", payload)
