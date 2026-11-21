"""Post-session extraction for Studio (docs/07-studio-bridge.md).

A second JSON-mode LLM call over a finished transcript, next to the memory
extraction: new content ideas, brief sections (angle, audience, thesis, key
points), open research questions and strong quotes in the user's own words.
The app sends the result to Studio's Inbox as proposals; nothing here talks
to Studio, and nothing runs during the live conversation.

The model points at the user message each item came from (`msg`); the place
in the conversation (`at`, mm:ss) and the transcript around it (`excerpt`)
are computed here, so they are always real. A quote that is not in that
message word for word is dropped.
"""

import json
import re
from typing import Literal

from loguru import logger
from pydantic import BaseModel, Field, ValidationError

from parla_voice.config import LLMConfig
from parla_voice.extraction import Usage
from parla_voice.llm.factory import complete

Kind = Literal["idea", "brief", "question", "quote"]
Section = Literal["angle", "audience", "thesis", "key_point"]

MAX_ITEMS = 40
EXCERPT_CHARS = 600


class StudioMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    at_s: float = 0.0  # seconds from the start of the conversation


class StudioProject(BaseModel):
    title: str = ""
    angle: str = ""
    audience: str = ""
    thesis: str = ""
    key_points: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


class StudioExtractRequest(BaseModel):
    transcript: list[StudioMessage]
    project: StudioProject | None = None
    llm: LLMConfig


class RawItem(BaseModel):
    kind: Kind
    section: Section | None = None
    title: str | None = None
    body: str
    msg: int


class StudioOutput(BaseModel):
    """What the model must produce (also the JSON schema for local models)."""

    items: list[RawItem] = Field(default_factory=list)


class StudioItem(BaseModel):
    """One proposal, shaped like Studio's `propose_from_session` item."""

    kind: Kind
    section: Section | None = None
    title: str | None = None
    body: str
    at: str
    excerpt: str


class StudioExtractResult(BaseModel):
    items: list[StudioItem] = Field(default_factory=list)
    dropped: int = 0
    usage: Usage = Field(default_factory=Usage)


SYSTEM_PROMPT = """You help a content creator turn a spoken conversation into material for their content workspace (Studio).
The conversation was with a producer-style interviewer about videos and articles the user is making.
Read the transcript and produce STRICT JSON:

{"items": [{"kind": "idea|brief|question|quote", "section": "angle|audience|thesis|key_point or null", "title": "only for idea", "body": "...", "msg": <number of the USER message it came from>}]}

Kinds:
- idea: a new piece of content the user wants to make that is NOT the current project. title: 3-8 words. body: a one-line pitch.
- brief: part of the current project's plan. section is required:
  - angle: the take or way in that makes this piece different (one or two sentences)
  - audience: who it is for, as specific as the user said
  - thesis: the single claim the piece argues (one sentence)
  - key_point: one point the piece makes on the way, with the example the user gave if any
- question: something the user doesn't know yet and would need to research or check. Phrase it as a question.
- quote: a strong line the user said that could go in the script or article. body is copied WORD FOR WORD from that user message (you may cut it short, never reword it).

Rules:
- Only what the USER said. Never take items from the interviewer's turns, never invent.
- msg is the [number] of the user message the item came from.
- Write brief, idea and question bodies in plain sentences, in the user's language, in their terms.
- Skip what the current project already has (given below) unless the user changed it; then propose the new version.
- No project given: propose ideas, and brief/question/quote items only if the conversation was clearly about one piece.
- Fewer, stronger items beat many weak ones. Small talk gives nothing: return {"items": []}.
- Respond with the JSON object only, no prose, no code fences."""


def _clock(seconds: float) -> str:
    s = max(int(seconds), 0)
    h, rem = divmod(s, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def _words(text: str) -> str:
    """Lowercase words only: for checking a quote against what was said."""
    return " ".join(re.findall(r"\w+", text.lower()))


def _cut(text: str, n: int) -> str:
    text = text.strip()
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def _project_text(p: StudioProject | None) -> str:
    if p is None:
        return "Current project: none."
    lines = [f"Current project: {p.title or '(untitled)'}"]
    for label, value in (("Angle", p.angle), ("Audience", p.audience), ("Thesis", p.thesis)):
        if value.strip():
            lines.append(f"{label}: {value.strip()}")
    if p.key_points:
        lines.append("Key points:\n" + "\n".join(f"- {k}" for k in p.key_points))
    if p.open_questions:
        lines.append("Open questions:\n" + "\n".join(f"- {q}" for q in p.open_questions))
    return "\n".join(lines)


def _transcript_text(messages: list[StudioMessage]) -> str:
    out = []
    for i, m in enumerate(messages):
        who = "USER" if m.role == "user" else "interviewer"
        out.append(f"[{i}] {who} ({_clock(m.at_s)}): {m.content}")
    return "\n".join(out)


def _excerpt(messages: list[StudioMessage], i: int) -> str:
    """The question that led to message i, and the message itself."""
    parts = []
    if i > 0 and messages[i - 1].role == "assistant":
        parts.append(f"Interviewer: {_cut(messages[i - 1].content, EXCERPT_CHARS // 3)}")
    parts.append(f"You: {messages[i].content.strip()}")
    return _cut("\n".join(parts), EXCERPT_CHARS)


def shape(raw: list[RawItem], messages: list[StudioMessage]) -> tuple[list[StudioItem], int]:
    """Checks the model's items against the transcript; returns (kept, dropped)."""
    kept: list[StudioItem] = []
    seen: set[tuple[str, str | None, str]] = set()
    dropped = 0
    for r in raw:
        body = r.body.strip()
        ok = 0 <= r.msg < len(messages) and messages[r.msg].role == "user" and bool(body)
        if ok and r.kind == "brief" and r.section is None:
            ok = False
        if ok and r.kind == "idea" and not (r.title or "").strip():
            ok = False
        if ok and r.kind == "quote":
            ok = _words(body) != "" and _words(body) in _words(messages[r.msg].content)
        key = (r.kind, r.section if r.kind == "brief" else None, _words(body))
        if not ok or key in seen or len(kept) >= MAX_ITEMS:
            dropped += 1
            continue
        seen.add(key)
        kept.append(
            StudioItem(
                kind=r.kind,
                section=r.section if r.kind == "brief" else None,
                title=_cut(r.title, 120) if r.kind == "idea" and r.title else None,
                body=_cut(body, 1200),
                at=_clock(messages[r.msg].at_s),
                excerpt=_excerpt(messages, r.msg),
            )
        )
    return kept, dropped


def _parse(raw: str) -> StudioOutput:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1].removeprefix("json").strip()
    data = json.loads(cleaned)
    if isinstance(data, list):
        data = {"items": data}
    # One malformed item shouldn't cost the rest: validate item by item.
    items = []
    for it in data.get("items", []) if isinstance(data, dict) else []:
        try:
            items.append(RawItem.model_validate(it))
        except ValidationError as e:
            logger.debug("studio extraction: skipped item {}: {}", it, e)
    return StudioOutput(items=items)


async def extract_for_studio(req: StudioExtractRequest) -> StudioExtractResult:
    if not any(m.role == "user" for m in req.transcript):
        return StudioExtractResult()
    user_prompt = f"{_project_text(req.project)}\n\nTranscript:\n{_transcript_text(req.transcript)}"

    last_error: Exception | None = None
    usage = Usage()
    for attempt in range(2):
        raw, tokens, model = await complete(
            req.llm,
            SYSTEM_PROMPT,
            user_prompt,
            json_mode=True,
            json_schema=StudioOutput.model_json_schema(),
        )
        usage.add(tokens, model)
        try:
            out = _parse(raw)
        except (json.JSONDecodeError, IndexError, AttributeError) as e:
            last_error = e
            logger.warning("studio extraction parse failed (attempt {}): {}", attempt + 1, e)
            continue
        items, dropped = shape(out.items, req.transcript)
        return StudioExtractResult(items=items, dropped=dropped, usage=usage)
    raise ValueError(f"studio extraction failed after retries: {last_error}")
