"""Local LLM (LM Studio's OpenAI-compatible server) tuned for voice.

Measured 2026-11-17 on the 3090 Ti with gemma-4-26b-a4b-it (Q4, full
offload, 8k context), realistic persona + memory brief + history:

  default (thinking on)        2.3-4.4s to first spoken token; one turn spent
                               its whole 400-token budget thinking, no answer
  reasoning_effort="none"      ~165ms to first token (warm), ~120 tok/s
  first turn, cold prefix      ~1.2s (prompt prefill) -> fixed by warm-up

So two adjustments over a plain OpenAILLMService:
  - send reasoning_effort="none" (the only switch LM Studio honored; the
    chat-template enable_thinking flag and a nested reasoning object were
    both ignored)
  - prefill the system prompt at session start (max_tokens=1) so the
    server's prefix cache is warm before the user's first turn
"""

import asyncio

from loguru import logger
from pipecat.frames.frames import Frame, StartFrame
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.openai.llm import OpenAILLMService


class LocalLLMService(OpenAILLMService):
    def __init__(
        self,
        *,
        base_url: str,
        model: str,
        system_prompt: str | None = None,
        disable_thinking: bool = True,
        **kwargs,
    ):
        extra = {"reasoning_effort": "none"} if disable_thinking else {}
        super().__init__(
            api_key="lm-studio",
            base_url=base_url,
            settings=OpenAILLMService.Settings(model=model, extra=extra),
            **kwargs,
        )
        self._model_id = model
        self._warm_prompt = system_prompt
        self._warm_extra = extra
        self.resolved_model = model

    async def _warm_up(self) -> None:
        try:
            await self._client.chat.completions.create(
                model=self._model_id,
                messages=[{"role": "system", "content": self._warm_prompt}],
                max_tokens=1,
                **self._warm_extra,
            )
            logger.info("local llm prefix warmed ({})", self._model_id)
        except Exception as e:  # warm-up is an optimization, never fatal
            logger.warning("local llm warm-up failed: {}", e)

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, StartFrame) and self._warm_prompt:
            asyncio.create_task(self._warm_up())
