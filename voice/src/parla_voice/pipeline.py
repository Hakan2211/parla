"""One conversation = one Pipecat pipeline bound to one websocket."""

import asyncio

from fastapi import WebSocket
from loguru import logger
from pipecat.audio.turn.smart_turn.base_smart_turn import SmartTurnParams
from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    Frame,
    InterimTranscriptionFrame,
    MetricsFrame,
    TranscriptionFrame,
    TTSSpeakFrame,
)
from pipecat.metrics.metrics import LLMTokenUsage, LLMUsageMetricsData
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.aggregators.llm_text_processor import LLMTextProcessor
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.frameworks.rtvi import RTVIObserver, RTVIProcessor
from pipecat.serializers.protobuf import ProtobufFrameSerializer
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)
from pipecat.workers.runner import WorkerRunner
from pipecat.turns.user_start import (
    TranscriptionUserTurnStartStrategy,
    VADUserTurnStartStrategy,
)
from pipecat.turns.user_stop import TurnAnalyzerUserTurnStopStrategy
from pipecat.turns.user_turn_processor import UserTurnProcessor
from pipecat.turns.user_turn_strategies import (
    ExternalUserTurnStrategies,
    UserTurnStrategies,
)

from parla_voice.config import SessionConfig
from parla_voice.events import TurnMetricsObserver
from parla_voice.llm.context_window import summarization_params
from parla_voice.llm.factory import build_llm_service
from parla_voice.stt.parakeet_worker import ParakeetClient
from parla_voice.stt.sherpa_stt import SherpaParakeetSTTService
from parla_voice.tts.base import StreamingTTS
from parla_voice.tts.chunking import FirstClauseAggregator
from parla_voice.tts.service import ParlaTTSService


class BargeInGate(FrameProcessor):
    """Interrupt the bot only after the user has said enough words.

    The turn-start strategies run with interruptions disabled, so a mere VAD
    blip (a trading scanner blurting a ticker, a cough, a background voice)
    no longer cuts the bot off mid-sentence. This gate watches transcriptions
    while the bot is speaking and broadcasts a real interruption once the
    user has said at least ``min_words`` words — a deliberate barge-in.
    """

    def __init__(self, *, min_words: int = 3, **kwargs):
        super().__init__(**kwargs)
        self._min_words = min_words
        self._bot_speaking = False
        self._final_words = 0
        self._fired = False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, BotStartedSpeakingFrame):
            self._bot_speaking = True
            self._final_words = 0
            self._fired = False
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self._bot_speaking = False
        elif (
            self._bot_speaking
            and not self._fired
            and isinstance(frame, (TranscriptionFrame, InterimTranscriptionFrame))
        ):
            words = len(frame.text.split())
            # Finals accumulate; interims are cumulative within their segment,
            # so count them against the running total without adding them.
            total = self._final_words + words
            if isinstance(frame, TranscriptionFrame):
                self._final_words = total
            if total >= self._min_words:
                self._fired = True
                logger.info("barge-in: {} user words while bot speaking", total)
                await self.broadcast_interruption()

        await self.push_frame(frame, direction)


class PatientSmartTurnV3(LocalSmartTurnAnalyzerV3):
    """Smart-turn v3 with a higher completion bar.

    Stock v3 ends the turn at probability > 0.5, which chops hesitant
    mid-sentence pauses ("Now let's talk something… <pause> …different").
    Requiring clear confidence keeps the turn open through hesitations;
    genuinely finished-but-ambiguous turns still end via the silence
    fallback (SmartTurnParams.stop_secs).
    """

    COMPLETION_THRESHOLD = 0.7

    def _predict_endpoint(self, audio_array):
        result = super()._predict_endpoint(audio_array)
        result["prediction"] = 1 if result["probability"] > self.COMPLETION_THRESHOLD else 0
        logger.info(
            "smart-turn p(complete)={:.3f} -> {}",
            result["probability"],
            "complete" if result["prediction"] else "incomplete",
        )
        return result


async def run_session(
    websocket: WebSocket,
    config: SessionConfig,
    tts_engine: StreamingTTS,
    stt_client: ParakeetClient,
    notices: list[str] | None = None,
) -> None:
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_in_sample_rate=16000,
            audio_out_sample_rate=tts_engine.sample_rate,
            add_wav_header=False,
            serializer=ProtobufFrameSerializer(),
        ),
    )

    rtvi = RTVIProcessor()
    vad = VADProcessor(
        vad_analyzer=SileroVADAnalyzer(
            params=VADParams(stop_secs=0.2)  # smart-turn owns the turn tail
        )
    )
    # Turn taking, tuned for a noisy desk (trading scanner, background voices):
    #   start: stock VAD/transcription start timing, but with interruptions
    #     DISABLED — a VAD blip no longer cuts the bot off. Deliberate
    #     barge-ins (>= 3 words while the bot speaks) are handled by
    #     BargeInGate, which broadcasts the interruption itself.
    #   stop: smart-turn v3 with a raised completion bar (see
    #     PatientSmartTurnV3) so hesitant pauses don't end the turn; the
    #     silence fallback drops from 3s to 2s to compensate.
    turn = UserTurnProcessor(
        user_turn_strategies=UserTurnStrategies(
            start=[
                VADUserTurnStartStrategy(enable_interruptions=False),
                TranscriptionUserTurnStartStrategy(enable_interruptions=False),
            ],
            stop=[
                TurnAnalyzerUserTurnStopStrategy(
                    turn_analyzer=PatientSmartTurnV3(
                        params=SmartTurnParams(stop_secs=2.0)
                    )
                )
            ],
        )
    )
    barge_in = BargeInGate(min_words=3)
    stt = SherpaParakeetSTTService(client=stt_client)
    llm = build_llm_service(config.llm, system_prompt=config.system_prompt)
    # The first chunk of each reply goes to TTS at its first clause break
    # instead of waiting for a full sentence (see tts/chunking.py).
    chunker = LLMTextProcessor(text_aggregator=FirstClauseAggregator())
    tts = ParlaTTSService(engine=tts_engine, voice_id=config.voice.voice_id)

    context = LLMContext(
        messages=[{"role": "system", "content": config.system_prompt}]
    )

    # Bounded context (system + running summary + last ~12 exchanges), see
    # llm/context_window.py. Summaries run while the bot is idle and their
    # tokens go through the same usage.delta path as conversation turns.
    bot_idle = asyncio.Event()
    bot_idle.set()

    async def report_summary_usage(tokens: LLMTokenUsage) -> None:
        await llm.push_frame(
            MetricsFrame(
                data=[
                    LLMUsageMetricsData(
                        processor=llm.name, model=config.llm.model, value=tokens
                    )
                ]
            )
        )

    aggregators = LLMContextAggregatorPair(
        context,
        # The user aggregator must follow `turn` above. Left at its defaults it
        # runs its own VAD-start strategy (interruptions ON, so any VAD blip
        # cut the bot off before BargeInGate could judge it) and its own stock
        # smart-turn (p > 0.5, not PatientSmartTurnV3) to decide turn ends.
        user_params=LLMUserAggregatorParams(
            user_turn_strategies=ExternalUserTurnStrategies()
        ),
        assistant_params=summarization_params(
            config.llm, on_usage=report_summary_usage, idle=bot_idle
        ),
    )

    @aggregators.assistant().event_handler("on_assistant_turn_started")
    async def on_assistant_turn_started(_aggregator):
        bot_idle.clear()

    @aggregators.assistant().event_handler("on_assistant_turn_stopped")
    async def on_assistant_turn_stopped(_aggregator, _message):
        bot_idle.set()

    @aggregators.assistant().event_handler("on_summary_applied")
    async def on_summary_applied(_aggregator, _summarizer, event):
        logger.info(
            "context compacted: {} -> {} messages ({} summarized)",
            event.original_message_count,
            event.new_message_count,
            event.summarized_message_count,
        )

    # One chat bubble per user *turn*: the aggregator merges all VAD-segmented
    # transcriptions of a turn and fires this exactly when the user message is
    # written to the LLM context — the same text the LLM will answer.
    @aggregators.user().event_handler("on_user_turn_message_added")
    async def on_user_turn_message_added(_aggregator, message):
        text = (message.content or "").strip()
        if text:
            await rtvi.send_server_message({"type": "user.final", "text": text})

    pipeline = Pipeline(
        [
            transport.input(),
            rtvi,
            vad,
            stt,  # transcribes each VAD-segmented utterance
            barge_in,  # word-count-gated interruptions while the bot speaks
            turn,  # semantic end-of-turn (waits for final transcription)
            aggregators.user(),
            llm,
            chunker,
            tts,
            transport.output(),
            aggregators.assistant(),
        ]
    )

    task = PipelineWorker(
        pipeline,
        params=PipelineParams(
            allow_interruptions=True,
            enable_metrics=True,
            enable_usage_metrics=True,  # token/char counts -> usage.delta
        ),
        observers=[
            RTVIObserver(rtvi),
            TurnMetricsObserver(
                rtvi,
                # Claude resolves aliases ("sonnet") to a real id per turn.
                model_name=lambda: getattr(llm, "resolved_model", None)
                or config.llm.model,
            ),
        ],
    )

    @rtvi.event_handler("on_client_ready")
    async def on_client_ready(rtvi_processor):
        await rtvi_processor.set_bot_ready()
        for notice in notices or []:
            await rtvi_processor.send_server_message(
                {"type": "session.notice", "text": notice}
            )
        if config.greeting:
            await task.queue_frames([TTSSpeakFrame(config.greeting)])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(_transport, _client):
        await task.cancel()

    # Session time limit is enforced here — the worker owns the clock.
    async def enforce_limit():
        warn_after = max(config.limits.max_minutes * 60 - 60, 10)
        await asyncio.sleep(warn_after)
        await rtvi.send_server_message({"type": "session.warning", "remaining_s": 60})
        await asyncio.sleep(60)
        await rtvi.send_server_message({"type": "session.end", "reason": "limit"})
        await task.stop_when_done()

    limit_task = asyncio.create_task(enforce_limit())
    try:
        runner = WorkerRunner(handle_sigint=False)
        await runner.add_workers(task)
        await runner.run()
    finally:
        limit_task.cancel()
        logger.info("pipeline for chat {} finished", config.chat_id)
