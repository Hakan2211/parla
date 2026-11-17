"""LLM provider selection — providers are configuration, not code forks.

Two consumption modes:
  build_llm_service()  -> a Pipecat LLMService for the realtime pipeline
  complete()           -> one-shot completion for extraction/summaries
"""

from pipecat.metrics.metrics import LLMTokenUsage
from pipecat.services.llm_service import LLMService
from pipecat.services.openai.llm import OpenAILLMService

from parla_voice.config import LLMConfig

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
LMSTUDIO_DEFAULT_BASE_URL = "http://127.0.0.1:1234/v1"


def build_llm_service(cfg: LLMConfig, system_prompt: str | None = None) -> LLMService:
    if cfg.provider == "openrouter":
        return OpenAILLMService(
            api_key=cfg.api_key,
            base_url=cfg.base_url or OPENROUTER_BASE_URL,
            model=cfg.model,
        )
    if cfg.provider == "lmstudio":
        from parla_voice.llm.local_llm import LocalLLMService

        return LocalLLMService(
            base_url=cfg.base_url or LMSTUDIO_DEFAULT_BASE_URL,
            model=cfg.model,
            system_prompt=system_prompt,
            disable_thinking=cfg.disable_thinking,
        )
    if cfg.provider == "claude":
        from parla_voice.llm.claude_agent import ClaudeAgentLLMService

        return ClaudeAgentLLMService(model=cfg.model, system_prompt=system_prompt)
    if cfg.provider == "anthropic":
        from parla_voice.llm.anthropic_api import ParlaAnthropicLLMService

        if not cfg.api_key:
            raise ValueError("anthropic provider requires an API key")
        return ParlaAnthropicLLMService(
            api_key=cfg.api_key, model=cfg.model, effort=cfg.effort
        )
    raise ValueError(f"unknown LLM provider: {cfg.provider}")


async def complete(
    cfg: LLMConfig,
    system: str,
    user: str,
    json_mode: bool = False,
    json_schema: dict | None = None,
) -> tuple[str, LLMTokenUsage | None, str | None]:
    """One-shot, non-streaming completion (memory extraction, titles).

    Returns (text, token usage if reported, resolved model id if known).
    """
    if cfg.provider == "claude":
        from parla_voice.llm.claude_agent import claude_complete

        return await claude_complete(cfg.model, system, user)
    if cfg.provider == "anthropic":
        from parla_voice.llm.anthropic_api import anthropic_complete

        return await anthropic_complete(cfg, system, user)

    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        api_key=cfg.api_key or "lm-studio",
        base_url=cfg.base_url
        or (
            OPENROUTER_BASE_URL
            if cfg.provider == "openrouter"
            else LMSTUDIO_DEFAULT_BASE_URL
        ),
    )
    kwargs: dict = {}
    if cfg.provider == "lmstudio" and cfg.disable_thinking:
        kwargs["reasoning_effort"] = "none"
    if json_mode and cfg.provider == "lmstudio" and json_schema:
        # LM Studio rejects json_object; a schema also constrains small
        # local models to output that actually validates.
        kwargs["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": "result", "schema": json_schema},
        }
    elif json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    try:
        response = await client.chat.completions.create(
            model=cfg.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            **kwargs,
        )
        tokens = None
        if response.usage:
            details = getattr(response.usage, "prompt_tokens_details", None)
            tokens = LLMTokenUsage(
                prompt_tokens=response.usage.prompt_tokens,
                completion_tokens=response.usage.completion_tokens,
                total_tokens=response.usage.total_tokens,
                cache_read_input_tokens=getattr(details, "cached_tokens", None),
            )
        return response.choices[0].message.content or "", tokens, response.model
    finally:
        await client.close()
