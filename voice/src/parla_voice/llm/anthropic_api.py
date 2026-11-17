"""Claude via the Anthropic API directly (API key), for the realtime pipeline.

Compared with the Agent SDK provider (claude_agent.py) this skips the Claude
Code CLI subprocess entirely, gets real prompt caching of the persona +
memory brief, and returns exact token usage on every response.

Built on Pipecat's AnthropicLLMService (streaming, interruptions, context
conversion), adjusted for current models in the one request hook it exposes:

- `output_config.effort` — current models think adaptively; voice wants the
  shallowest pass. Claude Opus 5.5 can't disable thinking at all (400), so
  effort is the latency control. Thinking text is never spoken.
- server-side `fallbacks: "default"` — if a safety classifier declines a
  turn, the API re-runs it on a fallback model inside the same call instead
  of leaving the user in silence.
- drops Pipecat's legacy `interleaved-thinking-2025-05-14` beta (only for the
  deprecated budget_tokens path).

Thinking blocks are never replayed: Pipecat's context stores spoken text
only. Omitting *all* thinking blocks is valid under preserved thinking's
history check, and the system prompt is fixed for the session, so the
cached prefix stays stable turn to turn.
"""

from loguru import logger
from pipecat.metrics.metrics import LLMTokenUsage
from pipecat.services.anthropic.llm import AnthropicLLMService

FALLBACK_BETA = "server-side-fallback-2026-07-01"
LEGACY_BETAS = {"interleaved-thinking-2025-05-14"}
# Models that accept server-side fallbacks (array form needs a model list;
# "default" routes by refusal category). Others simply skip it.
FALLBACK_MODELS = ("claude-fable-5", "claude-opus-5", "claude-sonnet-5-5")

VOICE_MAX_TOKENS = 4096  # replies are short; this is a runaway guard, not a target


def supports_fallbacks(model: str) -> bool:
    return model.startswith(FALLBACK_MODELS)


class ParlaAnthropicLLMService(AnthropicLLMService):
    def __init__(self, *, api_key: str, model: str, effort: str = "low", **kwargs):
        super().__init__(
            api_key=api_key,
            settings=AnthropicLLMService.Settings(
                model=model,
                max_tokens=VOICE_MAX_TOKENS,
                enable_prompt_caching=True,  # persona + memory brief, every turn
            ),
            **kwargs,
        )
        self._model_id = model
        self._effort = effort
        self.resolved_model = model

    async def _create_message_stream(self, api_call, params):
        betas = [b for b in params.pop("betas", []) if b not in LEGACY_BETAS]
        extra_body = dict(params.pop("extra_body", None) or {})
        extra_body["output_config"] = {"effort": self._effort}
        if supports_fallbacks(self._model_id):
            betas.append(FALLBACK_BETA)
            extra_body["fallbacks"] = "default"
        if betas:
            params["betas"] = betas
        params["extra_body"] = extra_body
        return await super()._create_message_stream(api_call, params)

    async def start_llm_usage_metrics(self, tokens: LLMTokenUsage):
        # Anthropic's input_tokens excludes cache reads/writes; the rest of
        # Parla (events.py) uses OpenAI semantics where prompt_tokens includes
        # them. Normalize here so cost math stays provider-agnostic.
        cache = (tokens.cache_read_input_tokens or 0) + (
            tokens.cache_creation_input_tokens or 0
        )
        normalized = tokens.model_copy(
            update={
                "prompt_tokens": tokens.prompt_tokens + cache,
                "total_tokens": tokens.total_tokens + cache,
            }
        )
        logger.debug("anthropic usage: {}", normalized)
        await super().start_llm_usage_metrics(normalized)


async def anthropic_complete(cfg, system: str, user: str):
    """One-shot completion for memory extraction -> (text, usage, model id).

    Not latency-sensitive, so the model's default effort is kept (extraction
    quality matters more than speed here). Cost is priced by the app from the
    API list price; this returns exact token counts.
    """
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=cfg.api_key)
    try:
        kwargs: dict = {}
        if supports_fallbacks(cfg.model):
            kwargs = {"betas": [FALLBACK_BETA], "extra_body": {"fallbacks": "default"}}
        response = await client.beta.messages.create(
            model=cfg.model,
            max_tokens=16000,
            system=system,
            messages=[{"role": "user", "content": user}],
            **kwargs,
        )
    except anthropic.AuthenticationError as e:
        raise ValueError("Anthropic rejected the API key") from e
    finally:
        await client.close()

    if response.stop_reason == "refusal":
        raise ValueError("Anthropic declined the extraction request (refusal)")
    text = "".join(b.text for b in response.content if b.type == "text")
    u = response.usage
    cache_read = u.cache_read_input_tokens or 0
    cache_write = u.cache_creation_input_tokens or 0
    prompt = u.input_tokens + cache_read + cache_write  # OpenAI semantics
    tokens = LLMTokenUsage(
        prompt_tokens=prompt,
        completion_tokens=u.output_tokens,
        total_tokens=prompt + u.output_tokens,
        cache_read_input_tokens=cache_read,
        cache_creation_input_tokens=cache_write,
    )
    return text, tokens, response.model
