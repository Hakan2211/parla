"""Session and engine configuration models.

Everything a session needs arrives fully-assembled in POST /sessions —
the voice worker holds no durable state (see docs/01-architecture.md).
"""

from typing import Literal

from pydantic import BaseModel, Field


class LLMConfig(BaseModel):
    provider: Literal["openrouter", "lmstudio", "claude", "anthropic"]
    model: str
    api_key: str | None = None
    base_url: str | None = None
    effort: Literal["low", "medium", "high"] = "low"  # anthropic only
    disable_thinking: bool = True  # lmstudio: reasoning models think for seconds otherwise


class VoiceConfig(BaseModel):
    engine: Literal["kokoro", "fish"] = "kokoro"
    voice_id: str = "af_heart"


class STTConfig(BaseModel):
    engine: Literal["sherpa", "faster_whisper"] = "sherpa"


class SessionLimits(BaseModel):
    max_minutes: int = 60


class SessionConfig(BaseModel):
    chat_id: str
    system_prompt: str
    greeting: str | None = None
    voice: VoiceConfig = Field(default_factory=VoiceConfig)
    llm: LLMConfig
    stt: STTConfig = Field(default_factory=STTConfig)
    limits: SessionLimits = Field(default_factory=SessionLimits)
