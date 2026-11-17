"""First-clause chunking: the first TTS chunk of a reply is released early."""

import pytest

from parla_voice.tts.chunking import FirstClauseAggregator


async def _run(agg: FirstClauseAggregator, tokens: list[str]) -> list[str]:
    out = []
    for tok in tokens:
        out += [a.text async for a in agg.aggregate(tok)]
    tail = await agg.flush()
    if tail and tail.text:
        out.append(tail.text)
    return out


def _tokens(text: str, size: int = 3) -> list[str]:
    return [text[i : i + size] for i in range(0, len(text), size)]


@pytest.mark.asyncio
async def test_first_clause_released_at_comma():
    text = "Sure thing, my friend, let me think about that. It was a good hike. Really."
    chunks = await _run(FirstClauseAggregator(), _tokens(text))
    # "Sure thing," is under min_chars; the next comma qualifies.
    assert chunks == [
        "Sure thing, my friend,",
        "let me think about that.",
        "It was a good hike.",
        "Really.",
    ]


@pytest.mark.asyncio
async def test_only_first_chunk_is_early():
    text = "That sounds wonderful, honestly. I love hiking, mountains, and long trails."
    chunks = await _run(FirstClauseAggregator(), _tokens(text))
    assert chunks == [
        "That sounds wonderful,",
        "honestly.",
        "I love hiking, mountains, and long trails.",
    ]


@pytest.mark.asyncio
async def test_long_first_clause_splits_at_word_boundary():
    text = "Hiking in the mountains with your brother sounds like a really lovely way to spend a day."
    chunks = await _run(FirstClauseAggregator(), _tokens(text))
    assert chunks[0] == "Hiking in the mountains with your brother sounds like"  # first word past 50
    assert " ".join(chunks) == text


@pytest.mark.asyncio
async def test_numbers_and_short_sentences_untouched():
    text = "Yes. It cost 1,000 dollars at 3:30 and that was plenty for us."
    chunks = await _run(FirstClauseAggregator(), _tokens(text))
    assert chunks[0] == "Yes."
    assert "1,000" in chunks[1] and "3:30" in chunks[1]


@pytest.mark.asyncio
async def test_resets_per_reply_and_on_interruption():
    agg = FirstClauseAggregator()
    reply = "Well, that is quite something, truly amazing. Tell me more."
    first = await _run(agg, _tokens(reply))
    second = await _run(agg, _tokens(reply))  # flush() ended the first reply
    assert first == second
    assert first[0] == "Well, that is quite something,"

    async for _ in agg.aggregate("Okay so the first part of"):
        pass
    await agg.handle_interruption()
    assert (await _run(agg, _tokens(reply))) == first
