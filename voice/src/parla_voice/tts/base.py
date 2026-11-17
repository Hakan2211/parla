"""The engine-neutral streaming TTS contract.

Implementations synthesize ONE sentence per call and yield raw PCM16 mono
chunks as soon as they exist. Swapping Kokoro for fish-audio s2-pro (or
anything else) must never require changes outside this package.
"""

from abc import ABC, abstractmethod
from typing import AsyncIterator


class StreamingTTS(ABC):
    #: Output sample rate of the PCM this engine yields.
    sample_rate: int

    @abstractmethod
    async def load(self) -> None:
        """Load models / open connections. Called once before first use."""

    @abstractmethod
    def synthesize(self, text: str, voice: str) -> AsyncIterator[bytes]:
        """Yield PCM16 mono chunks for one sentence."""

    async def close(self) -> None:  # noqa: B027 — optional hook
        pass
