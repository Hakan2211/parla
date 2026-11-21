# 07 — Studio bridge

Studio (`D:\Studio`) is the research → brief → script → article app. Voice belongs here in Parla, not in Studio, so the two connect: talk an idea through in Parla, and the useful parts land in Studio as proposals.

Studio side: `D:\Studio\docs\PLAN.md`, slice S10.

## Rule

Nothing from Studio enters the live conversation loop. The Claude agent keeps `tools=[]` / `mcp_servers={}` for latency. Studio is touched only:
- **before** a session (fetch project context → system prompt), and
- **after** a session (async extraction → proposals to Studio).

This is the same rule as Phase 2 memory extraction.

## Pieces

1. **Producer persona.** A built-in persona whose job is to interview the user about a piece of content: angle, audience, strongest example, what's unclear, what to research. It is direct, asks one question at a time, and pushes for specifics.
2. **Launch with a project.** `--studio-project <id>` (and a "Studio project" picker in the session start screen). At session start Parla calls Studio's MCP tool `project_context` (`http://127.0.0.1:47825/mcp`) and adds the result to the system prompt next to the existing context brief (`app/src/main/brief.ts`). If Studio isn't running, the session starts without it and shows a small notice.
3. **Studio extraction.** After a session with a Studio project, or after any session with the Producer persona, run a second extraction prompt (alongside `voice/src/parla_voice/extraction.py`). It pulls out:
   - new ideas (title + one-line pitch)
   - brief sections: angle, audience, thesis, key points
   - open research questions
   - strong quotes in the user's own words, with timestamps
4. **Send as proposals.** Call Studio MCP `propose_from_session` with the extracted items, the chat id and the transcript excerpt for each. Studio shows them in its Inbox for accept / edit / reject, so nothing is written to the project directly.
5. **Settings.** A Studio connection (URL + token, like Studio's Orbit connection), on/off, and a "test" button.

## Done when

- Starting a session from Studio's "Talk it through" opens Parla with the Producer persona and the project's brief in context.
- After the session ends, Studio's Inbox shows the proposed ideas, brief sections, questions and quotes within a minute, each linking back to the Parla chat.
- With Studio closed, Parla works exactly as before.
