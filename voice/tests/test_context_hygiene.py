"""LLM context hygiene: rolling summary + Claude interruption handling.

No network: factory.complete and the Claude CLI client are faked.
"""

import asyncio

import pytest
from claude_agent_sdk import ResultMessage
from claude_agent_sdk.types import StreamEvent
from pipecat.frames.frames import LLMContextSummaryRequestFrame
from pipecat.metrics.metrics import LLMTokenUsage
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_context_summarizer import LLMContextSummarizer
from pipecat.utils.asyncio.task_manager import TaskManager

from parla_voice.config import LLMConfig
from parla_voice.llm import context_window, factory
from parla_voice.llm.claude_agent import (
    ClaudeAgentLLMService,
    heard_before_last_user,
    interruption_note,
)
from parla_voice.llm.context_window import KEEP_MESSAGES, MAX_MESSAGES, summarization_params

LOCAL = LLMConfig(provider="lmstudio", model="gemma")


def _conversation(exchanges: int) -> list[dict]:
    msgs: list[dict] = [{"role": "system", "content": "You are Parla."}]
    for i in range(exchanges):
        msgs.append({"role": "user", "content": f"user says {i}"})
        msgs.append({"role": "assistant", "content": f"bot says {i}"})
    return msgs


# --- rolling summary -------------------------------------------------------


def test_claude_cli_provider_is_not_summarized():
    assert summarization_params(LLMConfig(provider="claude", model="sonnet")) is None
    for provider in ("lmstudio", "openrouter", "anthropic"):
        params = summarization_params(LLMConfig(provider=provider, model="m"))
        assert params.enable_auto_context_summarization


@pytest.fixture
def fake_complete(monkeypatch):
    calls = []

    async def complete(cfg, system, user, **_):
        calls.append((system, user))
        usage = LLMTokenUsage(prompt_tokens=900, completion_tokens=120, total_tokens=1020)
        return "  The user talked about numbers 0 to 11.  ", usage, cfg.model

    monkeypatch.setattr(factory, "complete", complete)
    return calls


@pytest.mark.asyncio
async def test_summary_generator_reports_usage_and_waits_for_idle(fake_complete):
    usage = []

    async def on_usage(tokens):
        usage.append(tokens)

    idle = asyncio.Event()
    gen = context_window.SummaryGenerator(LOCAL, on_usage=on_usage, idle=idle)
    context = LLMContext(messages=_conversation(20))  # 41 messages
    frame = LLMContextSummaryRequestFrame(
        request_id="r1",
        context=context,
        min_messages_to_keep=KEEP_MESSAGES,
        target_context_tokens=600,
        summarization_prompt="SUMMARIZE",
        summarization_timeout=10,
    )

    task = asyncio.create_task(gen._generate_summary(frame))
    await asyncio.sleep(0.05)
    assert not task.done() and not fake_complete  # bot still speaking
    idle.set()
    summary, last_index = await task

    assert summary == "The user talked about numbers 0 to 11."
    assert last_index == 41 - KEEP_MESSAGES - 1  # everything before the kept tail
    system, transcript = fake_complete[0]
    assert system == "SUMMARIZE"
    assert "user says 0" in transcript and "You are Parla" not in transcript
    assert "user says 19" not in transcript  # kept verbatim, not summarized
    assert usage[0].completion_tokens == 120


@pytest.mark.asyncio
async def test_summarizer_compacts_to_system_summary_and_tail(fake_complete):
    params = summarization_params(LOCAL)
    cfg = params.auto_context_summarization_config
    context = LLMContext(messages=_conversation(MAX_MESSAGES // 2))
    summarizer = LLMContextSummarizer(context=context, config=cfg, auto_trigger=True)
    await summarizer.setup(TaskManager(loop=asyncio.get_running_loop()))

    assert summarizer._should_summarize()
    await summarizer._request_summarization()
    for _ in range(100):
        if not summarizer._summarization_in_progress:
            break
        await asyncio.sleep(0.01)

    msgs = context.get_messages()
    assert len(msgs) == 2 + KEEP_MESSAGES
    assert msgs[0]["role"] == "system"
    assert "numbers 0 to 11" in msgs[1]["content"]
    assert msgs[-1]["content"] == f"bot says {MAX_MESSAGES // 2 - 1}"
    # Right after compaction the next turn must not re-trigger it.
    context.add_message({"role": "user", "content": "next"})
    assert not summarizer._should_summarize()


# --- Claude interruption note ---------------------------------------------


def test_heard_text_comes_from_reply_before_newest_user_turn():
    msgs = _conversation(2) + [{"role": "user", "content": "wait, stop"}]
    assert heard_before_last_user(msgs) == "bot says 1"
    # Cut before any audio played: no assistant message for that turn.
    msgs = _conversation(2) + [
        {"role": "user", "content": "first"},
        {"role": "user", "content": "second"},
    ]
    assert heard_before_last_user(msgs) == ""


def test_interruption_note():
    reply = "Sure. Paris is lovely in spring. You should visit the Louvre and the Orsay."
    assert interruption_note(reply, reply) is None
    assert interruption_note("", "") is None
    assert "before hearing any" in interruption_note(reply, "")
    note = interruption_note(reply, "Sure. Paris is lovely in spring.")
    assert '"Sure. Paris is lovely in spring."' in note and "unsaid" in note


# --- Claude: abandoned generation is drained, not leaked into the next turn --


def _delta(text: str) -> StreamEvent:
    return StreamEvent(
        uuid="u",
        session_id="s",
        event={"type": "content_block_delta", "delta": {"type": "text_delta", "text": text}},
    )


def _result(total_cost: float) -> ResultMessage:
    return ResultMessage(
        subtype="success",
        duration_ms=1,
        duration_api_ms=1,
        is_error=False,
        num_turns=1,
        session_id="s",
        total_cost_usd=total_cost,
        usage={"input_tokens": 10, "output_tokens": 5},
        model_usage={"claude-sonnet-5": {"inputTokens": 10}},
    )


class FakeCLI:
    """Buffers each query's full response, like the real CLI's message stream."""

    def __init__(self):
        self._stream: asyncio.Queue = asyncio.Queue()
        self.interrupted = 0
        self.queries: list[str] = []
        self._replies = iter(
            [
                (["Old ", "reply ", "the user cut off."], 0.01),
                (["Fresh ", "answer."], 0.02),
            ]
        )

    async def query(self, text: str):
        self.queries.append(text)
        chunks, cost = next(self._replies)
        for c in chunks:
            self._stream.put_nowait(_delta(c))
        self._stream.put_nowait(_result(cost))

    async def interrupt(self):
        self.interrupted += 1

    async def receive_response(self):
        while True:
            message = await self._stream.get()
            yield message
            if isinstance(message, ResultMessage):
                return


@pytest.mark.asyncio
async def test_interrupted_stream_is_drained_and_billed(monkeypatch):
    svc = ClaudeAgentLLMService(model="sonnet")
    svc._client = FakeCLI()
    billed = []

    async def record_usage(tokens):
        billed.append(tokens.cost_usd)

    monkeypatch.setattr(svc, "start_llm_usage_metrics", record_usage)

    # Turn 1: the interruption cancels us after the first chunk.
    stream = svc._stream_response("tell me about Paris")
    assert await anext(stream) == "Old "
    await stream.aclose()
    assert svc._drain_task is not None

    # Turn 2 sees only its own reply, never the tail of turn 1.
    text = "".join([t async for t in svc._stream_response("actually, Rome")])
    assert text == "Fresh answer."
    assert svc._client.interrupted == 1
    assert billed == [pytest.approx(0.01), pytest.approx(0.01)]  # both turns billed
    assert svc._drain_task is None
