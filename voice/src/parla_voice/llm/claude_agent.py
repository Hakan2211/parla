"""Claude subscription as an LLM provider, via the Claude Agent SDK.

Uses the Claude Code CLI login (no API key). A persistent ClaudeSDKClient
keeps one CLI subprocess alive for the whole session, so per-turn latency
is the model's, not process startup. The SDK maintains conversation state
across query() calls — we only ever send the newest user turn.

Higher first-token latency than OpenRouter; surfaced in the UI as the
"quality mode" trade-off.

The CLI is a full coding harness: by default it loads its built-in tools,
every user-configured MCP server, CLAUDE.md files and settings into each
request. Measured 2026-11-17: that was ~30k cache-write tokens per voice
turn (~$0.18/turn API-equivalent on Sonnet, 1.5-2.4s first token) and the
harness prompt overrode the persona. HARNESS_OFF strips all of it:
~180 input tokens/turn, ~1.1s first token, persona respected.

Interruptions. The CLI's history holds the full text of every reply it
generated, including replies the user cut off and never heard. Pipecat's
context records what was actually spoken, so when a reply was interrupted
the next user turn carries a short note of what the user heard. If the
interruption lands while the CLI is still generating, Pipecat cancels our
read mid-stream. The leftover stream (and its ResultMessage, with the
turn's usage) would then be read by the *next* turn. _drain interrupts the
CLI and consumes it in the background, and the next query waits for that.
"""

import asyncio
from contextlib import aclosing
from typing import AsyncGenerator

from loguru import logger
from pipecat.metrics.metrics import LLMTokenUsage
from pipecat.frames.frames import (
    Frame,
    InterruptionFrame,
    LLMContextFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    StartFrame,
)
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.llm_service import LLMService


class CostedTokenUsage(LLMTokenUsage):
    """Token usage plus the provider-reported dollar cost of this call."""

    cost_usd: float | None = None


# Options that turn the Claude Code harness into a plain chat model.
HARNESS_OFF = dict(
    tools=[],  # no built-in tools (allowed_tools=[] alone still ships them)
    allowed_tools=[],
    mcp_servers={},
    strict_mcp_config=True,  # ignore the user's global MCP config
    setting_sources=[],  # no CLAUDE.md / settings / plugins
    max_turns=1,
    # Otherwise the CLI fires a hidden Haiku call (~520 tokens) on the first
    # query of every session — measured 2026-11-17.
    env={"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"},
)


def usage_from_result(
    message, prior_total_cost: float = 0.0
) -> tuple[CostedTokenUsage | None, str | None]:
    """Per-query token usage + resolved model id from a ResultMessage.

    ``usage`` is per query, but ``total_cost_usd`` is cumulative over the
    client's lifetime — the per-query cost is the delta from the prior total.
    The CLI's own cost is used rather than a local price table: it knows the
    exact model and cache-TTL pricing (it bills 1h cache writes, e.g.).
    """
    usage = getattr(message, "usage", None) or {}
    if not usage:
        return None, None
    uncached = int(usage.get("input_tokens") or 0)
    cache_read = int(usage.get("cache_read_input_tokens") or 0)
    cache_write = int(usage.get("cache_creation_input_tokens") or 0)
    output = int(usage.get("output_tokens") or 0)
    prompt = uncached + cache_read + cache_write  # OpenAI semantics: all input
    # model_usage is cumulative and can list helper models the CLI used; the
    # conversational model is the one that has consumed the most input.
    model_usage = getattr(message, "model_usage", None) or {}
    model = max(
        model_usage, key=lambda k: model_usage[k].get("inputTokens", 0), default=None
    )
    total = getattr(message, "total_cost_usd", None)
    cost = max(total - prior_total_cost, 0.0) if total is not None else None
    return (
        CostedTokenUsage(
            cost_usd=cost,
            prompt_tokens=prompt,
            completion_tokens=output,
            total_tokens=prompt + output,
            cache_read_input_tokens=cache_read,
            cache_creation_input_tokens=cache_write,
        ),
        model,
    )


DRAIN_TIMEOUT_S = 15.0
# Heard at least this share of the reply -> close enough, no note.
HEARD_ENOUGH = 0.9


def message_text(message: dict) -> str:
    content = message.get("content", "")
    if isinstance(content, list):
        return " ".join(
            str(p.get("text", "")) for p in content if isinstance(p, dict)
        )
    return str(content or "")


def heard_before_last_user(messages: list) -> str:
    """Spoken text of the assistant reply that preceded the newest user turn.

    Pipecat's assistant aggregator stores what TTS actually played, cut at
    the interruption. Empty if the reply was cut before any of it played.
    """
    # The user aggregator writes exactly one message per user turn, so the
    # newest turn is the last message; whatever precedes it is the reply.
    if len(messages) >= 2 and messages[-2].get("role") == "assistant":
        return message_text(messages[-2]).strip()
    return ""


def interruption_note(generated: str, heard: str) -> str | None:
    """Note for the model about how much of its last reply the user heard."""
    generated = " ".join(generated.split())
    heard = " ".join(heard.split())
    if not generated or len(heard) >= HEARD_ENOUGH * len(generated):
        return None
    if not heard:
        return (
            "(Context: the user interrupted you before hearing any of your "
            "previous reply. Treat it as unsaid.)"
        )
    return (
        "(Context: the user interrupted your previous reply. They heard only: "
        f"\"{heard}\" Treat the rest as unsaid.)"
    )


class ClaudeAgentLLMService(LLMService):
    def __init__(self, *, model: str = "sonnet", system_prompt: str | None = None, **kwargs):
        super().__init__(**kwargs)
        self._model = model
        self._client = None
        self._client_lock = asyncio.Lock()
        self._system_prompt: str | None = system_prompt
        self.resolved_model: str | None = None  # e.g. "claude-sonnet-5"
        self._total_cost = 0.0  # CLI-reported cumulative cost of this client
        self._drain_task: asyncio.Task | None = None
        self._last_reply = ""  # everything generated for the previous turn
        self._reply_interrupted = False

    def can_generate_metrics(self) -> bool:
        # Without this, Pipecat silently drops our TTFB and token-usage metrics.
        return True

    async def _warm_up(self) -> None:
        """Spawn + connect the CLI while the greeting plays, not on turn one.

        Measured: the lazy connect added ~1.3s to the first reply.
        """
        try:
            await self._ensure_client()
        except Exception:
            logger.exception("claude warm-up failed (will retry on first turn)")

    async def _ensure_client(self):
        async with self._client_lock:
            return await self._ensure_client_locked()

    async def _ensure_client_locked(self):
        if self._client is None:
            from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient

            options = ClaudeAgentOptions(
                model=self._model,
                system_prompt=self._system_prompt or "You are a helpful voice companion.",
                **HARNESS_OFF,
                # Voice needs first-token latency, not deliberation: no
                # extended thinking, minimal effort, token-level streaming.
                thinking={"type": "disabled"},
                effort="low",
                include_partial_messages=True,
            )
            self._total_cost = 0.0  # a new CLI process restarts the running total
            self._client = ClaudeSDKClient(options=options)
            await self._client.connect()
            logger.info("claude agent client connected (model={})", self._model)
        return self._client

    async def _stream_response(self, user_text: str) -> AsyncGenerator[str, None]:
        from claude_agent_sdk import AssistantMessage, ResultMessage, TextBlock
        from claude_agent_sdk.types import StreamEvent

        await self._wait_for_drain()  # first: a failed drain resets the client
        client = await self._ensure_client()
        await client.query(user_text)
        streamed = False
        finished = False
        try:
            async for message in client.receive_response():
                if isinstance(message, StreamEvent):
                    event = message.event
                    if event.get("type") == "content_block_delta":
                        delta = event.get("delta", {})
                        if delta.get("type") == "text_delta" and delta.get("text"):
                            streamed = True
                            yield delta["text"]
                elif isinstance(message, ResultMessage):
                    await self._record_result(message)
                elif isinstance(message, AssistantMessage) and not streamed:
                    # Fallback if no partial events arrived (e.g. SDK downgrade).
                    for block in message.content:
                        if isinstance(block, TextBlock) and block.text:
                            yield block.text
            finished = True
        finally:
            if not finished:  # cancelled by an interruption mid-generation
                self._drain_task = asyncio.create_task(self._drain(client))

    async def _record_result(self, message) -> None:
        tokens, model = usage_from_result(message, self._total_cost)
        if message.total_cost_usd is not None:
            self._total_cost = message.total_cost_usd
        if model:
            self.resolved_model = model
        if tokens:
            await self.start_llm_usage_metrics(tokens)

    async def _drain(self, client) -> None:
        """Stop an abandoned generation and consume it up to its ResultMessage."""
        from claude_agent_sdk import ResultMessage

        try:
            await client.interrupt()
        except Exception as e:
            logger.warning("claude interrupt failed: {}", e)
        try:
            async with asyncio.timeout(DRAIN_TIMEOUT_S):
                async for message in client.receive_response():
                    if isinstance(message, ResultMessage):
                        await self._record_result(message)
            logger.info("claude: drained interrupted response")
        except Exception:
            # The stream is in an unknown state; the next turn reconnects.
            logger.exception("claude: drain failed, resetting client")
            if self._client is client:
                await self._close_client()

    async def _wait_for_drain(self) -> None:
        task = self._drain_task
        if task is not None:
            # asyncio.wait: a second interruption cancels only this wait, not
            # the drain, and the drain's own failure doesn't propagate here.
            await asyncio.wait({task})
            if self._drain_task is task:
                self._drain_task = None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, StartFrame):
            await self.push_frame(frame, direction)
            if self._system_prompt:  # known up front -> connect now
                asyncio.create_task(self._warm_up())
        elif isinstance(frame, LLMContextFrame):
            context = frame.context
            messages = context.get_messages()
            # Capture system prompt for client construction; find newest user turn.
            for m in messages:
                if m.get("role") == "system":
                    self._system_prompt = str(m.get("content", ""))
                    break
            user_text = ""
            for m in reversed(messages):
                if m.get("role") == "user":
                    user_text = message_text(m)
                    break
            if not user_text.strip():
                return

            if self._reply_interrupted:
                note = interruption_note(
                    self._last_reply, heard_before_last_user(messages)
                )
                if note:
                    logger.info("claude: {}", note)
                    user_text = f"{note}\n\n{user_text}"
            self._reply_interrupted = False
            self._last_reply = ""

            await self.push_frame(LLMFullResponseStartFrame())
            await self.start_ttfb_metrics()
            first = True
            try:
                # aclosing: if the interruption cancels us mid-push, the
                # generator's cleanup (which schedules the drain) runs now,
                # not whenever it gets garbage collected.
                async with aclosing(self._stream_response(user_text)) as stream:
                    async for text in stream:
                        if first:
                            await self.stop_ttfb_metrics()
                            first = False
                        self._last_reply += text
                        await self.push_frame(LLMTextFrame(text))
            except Exception:
                logger.exception("claude agent query failed")
            finally:
                await self.push_frame(LLMFullResponseEndFrame())
        elif isinstance(frame, InterruptionFrame):
            if self._last_reply:
                self._reply_interrupted = True
            await self.push_frame(frame, direction)
        else:
            await self.push_frame(frame, direction)

    async def stop(self, frame):
        await super().stop(frame)
        await self._close_client()

    async def cancel(self, frame):
        await super().cancel(frame)
        await self._close_client()

    async def _close_client(self):
        task, self._drain_task = self._drain_task, None
        if task is not None and task is not asyncio.current_task():
            task.cancel()
        if self._client is not None:
            client, self._client = self._client, None
            try:
                await client.disconnect()
            except Exception:
                logger.warning("claude client disconnect failed")


async def claude_complete(
    model: str, system: str, user: str
) -> tuple[str, LLMTokenUsage | None, str | None]:
    """One-shot completion for extraction jobs -> (text, usage, model id)."""
    from claude_agent_sdk import (
        AssistantMessage,
        ClaudeAgentOptions,
        ResultMessage,
        TextBlock,
        query,
    )

    parts: list[str] = []
    tokens: LLMTokenUsage | None = None
    resolved: str | None = None
    async for message in query(
        prompt=user,
        options=ClaudeAgentOptions(model=model, system_prompt=system, **HARNESS_OFF),
    ):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock) and block.text:
                    parts.append(block.text)
        elif isinstance(message, ResultMessage):
            tokens, resolved = usage_from_result(message)
    return "".join(parts), tokens, resolved
