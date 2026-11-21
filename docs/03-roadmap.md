# Parla — Roadmap

## Phase 0 — Prototype on the 3090 Ti (1–2 weeks of evenings)

**Goal: prove <1s voice-to-voice on owned hardware before renting anything.**

- Pipecat pipeline: SmallWebRTC transport + Silero VAD + smart-turn + Parakeet TDT 0.6B v2 + OpenRouter (Gemini Flash) + Kokoro-82M
- Single throwaway web page: connect, talk, see per-stage latency numbers on screen
- Docker Compose from day one (same compose file later deploys to Hetzner)
- Exit criteria: p50 voice-to-voice < 1s, barge-in feels instant, 30-min conversation stays stable

## Phase 1 — MVP web app (3–5 weeks)

**Goal: real users talking to personas, generously.**

- Control plane: TanStack Start + better-auth + Prisma/Postgres (reuse memdia patterns — with the security fixes baked in: no client keys, worker-enforced time limits)
- **3–5 launch personas** — each is pure config: name, avatar, system prompt, Kokoro voice, conversation style. Examples: the Coach (direct, goal-focused), the Friend (warm, curious), the Thinker (socratic), the Storyteller
- Session flow: pick persona → talk (generous limits, e.g. 30–60 min/day free-beta) → transcript + summary saved
- Pre-generated per-persona greeting audio (memdia's best trick, kept)
- Metrics dashboard: latency per stage, concurrency, minutes used
- Deploy: rent GEX44, point the same compose file at it
- Simple Stripe billing (one paid tier) once retention looks real

## Phase 2 — Memory that compounds (2–4 weeks)

**Goal: "she remembered" is the retention hook.**

- Post-session extraction (reuse memdia's extraction-prompt approach): facts about the user, people mentioned, open threads, commitments → structured store + embeddings (pgvector)
- At session start, build a context brief (recent summaries + relevant retrieved facts) into the persona's system prompt — memdia already proved this pattern with reflections' `contextBrief`
- Memory is **per-user, shared across personas** by default (personas differ in personality, not in what they know about you); per-persona private memory as a setting
- User-visible memory page: see/edit/delete what Parla knows (trust + GDPR)

## Phase 3 — Scheduling & planning (4–6 weeks)

**Goal: conversations turn into an organized life.**

- Extract todos, events, deadlines from conversations ("I need to call the dentist Tuesday") → planner inbox with confirm/dismiss
- In-app planner: today view, week view; items link back to the conversation that created them
- Google Calendar integration (two-way: create events, read availability)
- Proactive persona: session greetings reference the plan ("You wanted to finish the pitch deck today — how's it going?")
- Optional daily planning ritual: 5-minute morning session that walks the day's plan

## Phase 4 — Multilingual + premium voices

- STT: swap/parallel-run faster-whisper large-v3-turbo (or multilingual Parakeet successors) behind the same interface
- TTS: Qwen3-TTS (~97ms streaming, 10 languages) or Chatterbox multilingual for non-English personas
- Language is a persona/user setting; the pipeline interface doesn't change

## Phase 5 — Hardware device

See [04-hardware-device.md](04-hardware-device.md). Starts only after Phase 1 proves the pipeline with real users.

## Side track — Studio bridge

Talk content ideas through with a Producer persona; extracted ideas, brief sections, research questions and quotes go to Studio as proposals. See [07-studio-bridge.md](07-studio-bridge.md).

## Sequencing rules

1. Nothing ships without per-stage latency metrics attached.
2. Each phase's extraction/memory features run **after** the session (async) — never block the conversation loop.
3. Rent hardware only when owned hardware is saturated or users are real (3090 Ti first, GEX44 second, LiveKit+fleet third).
