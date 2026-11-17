"""First-clause text chunking for lower time-to-first-audio.

Pipecat's default aggregator waits for a full sentence before TTS starts, so
the first audio of every reply waits on the LLM to finish its first sentence
(0.4–1.0s measured). This aggregator releases the *first* chunk of each reply
early — at the first clause break (comma, colon, dash) once it holds enough
text, or at a word boundary once it gets long — and then falls back to normal
sentence aggregation for the rest of the reply.

The first chunk must not be too short: TTS synthesizes the next chunk while
the first one plays, and a two-word clip ("Oh, ") would finish before the next
chunk is ready, leaving an audible gap. ``min_chars`` ≈ 1.3s of speech.
"""

from collections.abc import AsyncIterator

from pipecat.utils.text.base_text_aggregator import Aggregation, AggregationType
from pipecat.utils.text.simple_text_aggregator import SimpleTextAggregator

# Sentence enders (. ! ? ; …) are handled by the base class.
CLAUSE_PUNCTUATION = frozenset({",", ":", "—", "–", "，", "、", "："})


class FirstClauseAggregator(SimpleTextAggregator):
    def __init__(self, *, min_chars: int = 20, max_chars: int = 50, **kwargs):
        super().__init__(**kwargs)
        self._min_chars = min_chars
        self._max_chars = max_chars
        self._first_done = False

    async def aggregate(self, text: str) -> AsyncIterator[Aggregation]:
        for char in text:
            self._text += char
            if not self._first_done and (early := self._check_first_clause(char)):
                self._first_done = True
                yield early
                continue
            result = await self._check_sentence_with_lookahead(char)
            if result:
                self._first_done = True
                yield result

    def _check_first_clause(self, char: str) -> Aggregation | None:
        # Only split on whitespace, so "1,000" and "3:30" stay whole.
        if char.strip():
            return None
        head = self._text.rstrip()
        if len(head) < self._min_chars:
            return None
        at_clause = head[-1] in CLAUSE_PUNCTUATION
        # Waiting on lookahead means a possible sentence end ("Dr. ") — let
        # the base class decide that one rather than splitting at the word.
        too_long = len(head) >= self._max_chars and not self._needs_lookahead
        if not (at_clause or too_long):
            return None
        self._text = self._text[len(head) :].lstrip(" ")
        self._needs_lookahead = False
        return Aggregation(text=head.strip(" "), type=AggregationType.SENTENCE)

    async def flush(self) -> Aggregation | None:
        self._first_done = False  # end of reply: next reply starts fresh
        return await super().flush()

    async def handle_interruption(self):
        self._first_done = False
        await super().handle_interruption()

    async def reset(self):
        self._first_done = False
        await super().reset()
