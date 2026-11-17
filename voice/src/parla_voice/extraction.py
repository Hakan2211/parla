"""Post-session memory extraction.

One JSON-mode LLM call over the finished transcript: title + summary +
new memory entries + updates to existing ones. Runs after session.end,
never blocks the conversation loop (docs sequencing rule #2).
"""

import json
from typing import Literal

from loguru import logger
from pydantic import BaseModel, Field, ValidationError

from parla_voice.config import LLMConfig
from parla_voice.llm.factory import complete

MemoryKind = Literal["fact", "person", "thread", "commitment"]


class TranscriptMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ExistingEntry(BaseModel):
    id: str
    kind: MemoryKind
    content: str


class ExtractRequest(BaseModel):
    transcript: list[TranscriptMessage]
    persona_name: str = "Parla"
    existing_memory: list[ExistingEntry] = Field(default_factory=list)
    llm: LLMConfig


class NewEntry(BaseModel):
    kind: MemoryKind
    content: str
    importance: int = Field(default=3, ge=1, le=5)


class EntryUpdate(BaseModel):
    id: str
    content: str | None = None
    status: Literal["active", "archived"] | None = None


class Usage(BaseModel):
    """Normalized token usage (input_tokens excludes cache reads/writes)."""

    model: str | None = None
    input_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = None  # provider-reported (Claude); else priced by the app

    def add(self, tokens, model: str | None) -> None:
        if tokens is None:
            return
        cache_read = tokens.cache_read_input_tokens or 0
        cache_write = tokens.cache_creation_input_tokens or 0
        self.input_tokens += max(tokens.prompt_tokens - cache_read - cache_write, 0)
        self.cache_read_tokens += cache_read
        self.cache_write_tokens += cache_write
        self.output_tokens += tokens.completion_tokens
        self.model = model or self.model
        cost = getattr(tokens, "cost_usd", None)
        if cost is not None:
            self.cost_usd = (self.cost_usd or 0.0) + cost


class ExtractOutput(BaseModel):
    """What the model must produce (also the JSON schema for local models)."""

    title: str
    summary: str
    new_entries: list[NewEntry] = Field(default_factory=list)
    updates: list[EntryUpdate] = Field(default_factory=list)


class ExtractResult(ExtractOutput):
    usage: Usage = Field(default_factory=Usage)


SYSTEM_PROMPT = """You maintain the long-term memory of a voice companion app.
Given a conversation transcript and the current memory, produce STRICT JSON:

{
  "title": "3-6 word conversation title",
  "summary": "2-4 sentence summary of what was discussed, written in third person about 'the user'",
  "new_entries": [
    {"kind": "fact|person|thread|commitment", "content": "...", "importance": 1-5}
  ],
  "updates": [
    {"id": "<existing entry id>", "content": "revised text or null", "status": "archived or null"}
  ]
}

Memory kinds:
- fact: stable facts about the user (job, preferences, circumstances)
- person: people in the user's life ("Ana — the user's sister, lives in Berlin")
- thread: ongoing topics to follow up on ("apartment hunt in Kreuzberg")
- commitment: things the user said they would do, with timing if mentioned

Rules:
- Extract only what the USER actually said — never invent, never extract from assistant turns.
- Skip small talk. If nothing memorable was said, return empty new_entries.
- Deduplicate against existing memory: if an existing entry covers it, update it instead of adding.
- Archive existing entries that the conversation shows are resolved or obsolete.
- importance: 5 = core identity/life facts, 3 = useful context, 1 = minor detail.
- Respond with the JSON object only, no prose, no code fences."""


def _transcript_text(messages: list[TranscriptMessage]) -> str:
    return "\n".join(f"{m.role}: {m.content}" for m in messages)


async def extract(req: ExtractRequest) -> ExtractResult:
    existing = (
        json.dumps([e.model_dump() for e in req.existing_memory], indent=1)
        if req.existing_memory
        else "[]"
    )
    user_prompt = (
        f"Persona in this conversation: {req.persona_name}\n\n"
        f"Current memory entries:\n{existing}\n\n"
        f"Transcript:\n{_transcript_text(req.transcript)}"
    )

    last_error: Exception | None = None
    usage = Usage()  # failed attempts still cost money — count them all
    for attempt in range(2):
        raw, tokens, model = await complete(
            req.llm,
            SYSTEM_PROMPT,
            user_prompt,
            json_mode=True,
            json_schema=ExtractOutput.model_json_schema(),
        )
        usage.add(tokens, model)
        try:
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("```")[1].removeprefix("json").strip()
            result = ExtractResult.model_validate(json.loads(cleaned))
            result.usage = usage
            return result
        except (json.JSONDecodeError, ValidationError, IndexError) as e:
            last_error = e
            logger.warning("extraction parse failed (attempt {}): {}", attempt + 1, e)
    raise ValueError(f"extraction failed after retries: {last_error}")
