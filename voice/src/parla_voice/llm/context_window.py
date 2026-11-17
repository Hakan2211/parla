"""Bounded LLM context for long voice sessions.

The OpenAI-compatible providers (OpenRouter, LM Studio) and the Anthropic
API provider resend the whole Pipecat context every turn, so over a
60-minute session input tokens, cost and first-token latency all grow
linearly. This keeps the context at:

    system prompt + running summary + the last KEEP_MESSAGES messages

using Pipecat's LLMContextSummarizer. Compaction happens in chunks: once
MAX_MESSAGES accumulate (or the estimated size passes MAX_CONTEXT_TOKENS),
everything older than the last KEEP_MESSAGES is folded into the summary.
Between compactions the context only grows by appending, so the Anthropic
prompt-cache prefix stays valid. A sliding window would break it every turn.

Pipecat's default summary path (LLMService.run_inference) reports no token
usage, so summaries would never reach the cost ledger. The Anthropic version
also skips our effort/beta request hook. SummaryGenerator routes summaries
through factory.complete() instead, which returns usage for every provider.

The Claude Agent SDK provider is excluded: the CLI keeps its own history and
only ever receives the newest user turn, so the Pipecat context isn't sent.
"""

import asyncio
from typing import Awaitable, Callable

from loguru import logger
from pipecat.frames.frames import LLMContextSummaryRequestFrame
from pipecat.metrics.metrics import LLMTokenUsage
from pipecat.processors.aggregators.llm_response_universal import (
    LLMAssistantAggregatorParams,
)
from pipecat.utils.context.llm_context_summarization import (
    LLMAutoContextSummarizationConfig,
    LLMContextSummarizationUtil,
    LLMContextSummaryConfig,
)

from parla_voice.config import LLMConfig

# Messages, not exchanges: one exchange = user + assistant.
KEEP_MESSAGES = 24  # ~12 exchanges kept verbatim after each compaction
MAX_MESSAGES = 36  # compact once ~6 more exchanges have accumulated
# chars/4 estimate, system prompt included. LM Studio loads with a 16k window.
MAX_CONTEXT_TOKENS = 10_000
SUMMARY_MAX_TOKENS = 600
# Don't wait forever for the bot to finish speaking before summarizing.
IDLE_WAIT_S = 30.0

SUMMARY_PROMPT = """You maintain the running memory of a spoken conversation between a user and their voice companion (the assistant). The transcript below is the older part of the conversation; it may begin with an earlier summary — fold that in.

Write a compact summary the assistant can rely on to continue naturally:
- facts the user shared about themselves, people in their life, plans, feelings
- topics discussed and where each one landed; questions still open
- anything the assistant promised, suggested, or asked to follow up on
- the user's mood and how they like to be spoken to, if it showed

Plain prose or short bullets, third person ("The user…"), under 250 words. No greetings or small talk. Output only the summary."""

SUMMARY_TEMPLATE = (
    "[Summary of the earlier part of this conversation — background, not a new message]\n"
    "{summary}"
)

UsageCallback = Callable[[LLMTokenUsage], Awaitable[None]]


class SummaryGenerator:
    """Dedicated summarizer "LLM" for LLMContextSummaryConfig.llm.

    Pipecat only calls ``_generate_summary`` on it (duck-typed). It runs off
    the pipeline, waits until the bot has finished the current reply (on a
    local GPU a concurrent request slows the live reply), then reports the
    summary's token usage through ``on_usage``.
    """

    def __init__(
        self,
        cfg: LLMConfig,
        *,
        on_usage: UsageCallback | None = None,
        idle: asyncio.Event | None = None,
    ):
        self._cfg = cfg
        self._on_usage = on_usage
        self._idle = idle

    async def _generate_summary(self, frame: LLMContextSummaryRequestFrame) -> tuple[str, int]:
        from parla_voice.llm.factory import complete

        if self._idle is not None:
            try:
                await asyncio.wait_for(self._idle.wait(), IDLE_WAIT_S)
            except TimeoutError:
                pass

        # Selected after the wait: messages are only ever appended, so the
        # indices stay valid; the newest ones just stay in the kept tail.
        result = LLMContextSummarizationUtil.get_messages_to_summarize(
            frame.context, frame.min_messages_to_keep
        )
        if not result.messages:
            raise RuntimeError("No messages to summarize")
        transcript = LLMContextSummarizationUtil.format_messages_for_summary(result.messages)

        text, tokens, _model = await complete(
            self._cfg, frame.summarization_prompt, f"Conversation so far:\n{transcript}"
        )
        if tokens and self._on_usage:
            try:
                await self._on_usage(tokens)
            except Exception:
                logger.exception("failed to report summary usage")
        text = text.strip()
        if not text:
            raise RuntimeError("LLM returned an empty summary")
        logger.info(
            "context summary: {} messages -> {} chars", len(result.messages), len(text)
        )
        return text, result.last_summarized_index


def summarization_params(
    cfg: LLMConfig,
    *,
    on_usage: UsageCallback | None = None,
    idle: asyncio.Event | None = None,
) -> LLMAssistantAggregatorParams | None:
    """Assistant-aggregator params bounding the context, or None if not applicable."""
    if cfg.provider == "claude":
        return None
    return LLMAssistantAggregatorParams(
        enable_auto_context_summarization=True,
        auto_context_summarization_config=LLMAutoContextSummarizationConfig(
            max_context_tokens=MAX_CONTEXT_TOKENS,
            max_unsummarized_messages=MAX_MESSAGES,
            summary_config=LLMContextSummaryConfig(
                target_context_tokens=SUMMARY_MAX_TOKENS,
                min_messages_after_summary=KEEP_MESSAGES,
                summarization_prompt=SUMMARY_PROMPT,
                summary_message_template=SUMMARY_TEMPLATE,
                llm=SummaryGenerator(cfg, on_usage=on_usage, idle=idle),  # type: ignore[arg-type]
                summarization_timeout=90.0,
            ),
        ),
    )
