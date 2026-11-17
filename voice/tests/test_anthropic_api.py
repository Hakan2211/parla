"""Request shaping + usage normalization of the direct Anthropic provider.

No network: the parent class's request hook is replaced by a capture.
"""

import pytest
from pipecat.metrics.metrics import LLMTokenUsage
from pipecat.services.anthropic.llm import AnthropicLLMService

from parla_voice.llm.anthropic_api import FALLBACK_BETA, ParlaAnthropicLLMService


async def _captured_params(monkeypatch, model: str) -> dict:
    captured = {}

    async def fake_create(self, api_call, params):
        captured.update(params)

    monkeypatch.setattr(AnthropicLLMService, "_create_message_stream", fake_create)
    svc = ParlaAnthropicLLMService(api_key="sk-test", model=model, effort="low")
    await svc._create_message_stream(
        None,
        {"model": model, "max_tokens": 4096, "betas": ["interleaved-thinking-2025-05-14"]},
    )
    return captured


@pytest.mark.asyncio
async def test_opus_gets_effort_and_fallbacks(monkeypatch):
    p = await _captured_params(monkeypatch, "claude-opus-5-5")
    assert p["extra_body"]["output_config"] == {"effort": "low"}
    assert p["extra_body"]["fallbacks"] == "default"
    assert p["betas"] == [FALLBACK_BETA]  # legacy interleaved-thinking beta dropped
    assert "thinking" not in p  # Opus 5.5 400s on disabled thinking — never sent


@pytest.mark.asyncio
async def test_haiku_skips_fallbacks(monkeypatch):
    p = await _captured_params(monkeypatch, "claude-haiku-5-5")
    assert p["extra_body"] == {"output_config": {"effort": "low"}}
    assert "betas" not in p


@pytest.mark.asyncio
async def test_usage_normalized_to_include_cache(monkeypatch):
    seen = []

    async def fake_usage(self, tokens):
        seen.append(tokens)

    monkeypatch.setattr(AnthropicLLMService, "start_llm_usage_metrics", fake_usage)
    svc = ParlaAnthropicLLMService(api_key="sk-test", model="claude-opus-5-5")
    await svc.start_llm_usage_metrics(
        LLMTokenUsage(
            prompt_tokens=50,  # Anthropic semantics: uncached only
            completion_tokens=20,
            total_tokens=70,
            cache_read_input_tokens=1000,
            cache_creation_input_tokens=200,
        )
    )
    assert seen[0].prompt_tokens == 1250
    assert seen[0].total_tokens == 1270
