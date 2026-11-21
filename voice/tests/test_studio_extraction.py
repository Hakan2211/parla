import json

import pytest

from parla_voice import studio_extraction as se
from parla_voice.config import LLMConfig

T = [
    se.StudioMessage(role="assistant", content="What's the piece about?", at_s=0),
    se.StudioMessage(role="user", content="It's about why cities ban cars, and honestly, nobody asks the shop owners.", at_s=12),
    se.StudioMessage(role="assistant", content="Who is it for?", at_s=40),
    se.StudioMessage(role="user", content="City planners who think it's obvious. I don't know how many shops closed in Oslo.", at_s=754),
]


def raw(**kw):
    return se.RawItem(**kw)


def test_shape_keeps_good_items_and_computes_place():
    items, dropped = se.shape(
        [
            raw(kind="brief", section="audience", body="City planners", msg=3),
            raw(kind="quote", body="nobody asks the shop owners", msg=1),
            raw(kind="question", body="How many shops closed in Oslo?", msg=3),
            raw(kind="idea", title="Shop owners on car bans", body="Ask them", msg=1),
        ],
        T,
    )
    assert dropped == 0
    assert [i.kind for i in items] == ["brief", "quote", "question", "idea"]
    assert items[0].at == "12:34"
    assert items[1].at == "00:12"
    assert items[0].excerpt.startswith("Interviewer: Who is it for?\nYou: City planners")


def test_shape_drops_bad_items():
    items, dropped = se.shape(
        [
            raw(kind="quote", body="nobody ever asks shop owners", msg=1),  # reworded
            raw(kind="brief", body="no section", msg=1),
            raw(kind="question", body="from the interviewer", msg=0),
            raw(kind="question", body="out of range", msg=9),
            raw(kind="idea", body="no title", msg=1),
            raw(kind="question", body="Same?", msg=3),
            raw(kind="question", body="same", msg=3),  # duplicate by words
        ],
        T,
    )
    assert [i.body for i in items] == ["Same?"]
    assert dropped == 6


def test_parse_skips_one_bad_item():
    out = se._parse(json.dumps({"items": [{"kind": "gossip", "body": "x", "msg": 1}, {"kind": "question", "body": "Why?", "msg": 1}]}))
    assert [i.body for i in out.items] == ["Why?"]
    assert se._parse("```json\n[]\n```").items == []


@pytest.mark.asyncio
async def test_extract_retries_then_shapes(monkeypatch):
    answers = iter(["not json", json.dumps({"items": [{"kind": "brief", "section": "thesis", "body": "Car bans hurt shops first", "msg": 1}]})])

    async def fake_complete(cfg, system, user, json_mode=False, json_schema=None):
        assert "Current project: Car bans" in user
        assert "[1] USER (00:12)" in user
        return next(answers), None, "m"

    monkeypatch.setattr(se, "complete", fake_complete)
    req = se.StudioExtractRequest(transcript=T, project=se.StudioProject(title="Car bans"), llm=LLMConfig(provider="claude", model="sonnet"))
    r = await se.extract_for_studio(req)
    assert [(i.kind, i.section) for i in r.items] == [("brief", "thesis")]


@pytest.mark.asyncio
async def test_extract_no_user_turns_skips_llm(monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("should not be called")

    monkeypatch.setattr(se, "complete", boom)
    req = se.StudioExtractRequest(transcript=T[:1], llm=LLMConfig(provider="claude", model="sonnet"))
    assert (await se.extract_for_studio(req)).items == []
