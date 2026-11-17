# Parla — Architecture

## Overview

```
┌───────────────┐         WebRTC (Opus audio, both directions)
│  Web client   │◄───────────────────────────────┐
│  (browser)    │                                │
└───────────────┘                                ▼
┌───────────────┐                    ┌─────────────────────────┐
│ Hardware      │  WS/WebRTC         │  VOICE WORKER (GPU box)  │
│ device (later)│◄──────────────────►│  Pipecat pipeline:       │
└───────────────┘                    │   Silero VAD + smart turn│
                                     │   STT: Parakeet TDT 0.6B │
┌───────────────┐   HTTPS            │   LLM: OpenRouter API ───┼──► Gemini Flash
│  Web app      │◄─────────────────► │   TTS: Kokoro-82M        │    (cloud, cheap)
│  (control     │   sessions, auth,  │   (Chatterbox-Turbo for  │
│   plane)      │   personas, memory │    premium personas)     │
└──────┬────────┘                    └─────────────────────────┘
       ▼
   Postgres (users, sessions, transcripts, memory, personas)
```

Two deployable units:

1. **Control plane** (web app + DB) — accounts, personas, session history, memory, billing. Same stack family as memdia (TanStack Start + better-auth + Prisma) since it's proven and familiar; Postgres instead of SQLite (multi-node from day one). Runs on a cheap CPU VPS (€10–20/mo).
2. **Voice worker** (GPU box) — a Python [Pipecat](https://github.com/pipecat-ai/pipecat) process per conversation, plus local model servers. Stateless: everything durable is written to the control plane. Add boxes to scale.

## Why Pipecat (not hand-rolled like memdia)

Memdia hand-rolled VAD, turn-taking, barge-in, keepalives, and audio scheduling across ~5 React hooks and an SSE protocol — it works, but it was the hardest, buggiest part of the codebase. Pipecat is an open-source (BSD) voice-agent framework that ships exactly those pieces: VAD, end-of-turn detection (including the `smart-turn` model), interruption/barge-in, per-service plug-ins, and both WebRTC and WebSocket transports. We write the *behavior* (personas, memory, session rules), not the plumbing.

- **MVP transport:** Pipecat's SmallWebRTC transport (peer-to-peer WebRTC straight to the worker; one process per session). Simple, zero extra infra.
- **Scale transport:** self-hosted [LiveKit](https://livekit.io) SFU + LiveKit Agents workers, when we need multi-node routing, observability, and the hardware device fleet. The pipeline code barely changes — Pipecat treats transport as a plug-in.

## Model choices (English-first)

| Stage | Model | License | Why |
|---|---|---|---|
| VAD | Silero VAD (in Pipecat) | MIT | Standard; served server-side so clients stay thin |
| Turn detection | Pipecat smart-turn | open | Semantic end-of-turn beats fixed silence timeouts — this is where memdia loses ~1s per turn |
| STT | **NVIDIA Parakeet TDT 0.6B v2** | CC-BY-4.0 | Top of the open English ASR leaderboards, extremely fast on GPU, punctuation+timestamps. Fallback: faster-whisper large-v3-turbo (adds multilingual) |
| LLM | **Gemini Flash via OpenRouter** (unchanged) | API | Already ~free relative to everything else; best quality-per-cost. Self-hosting an LLM is a Phase-later option, not MVP |
| TTS default | **Kokoro-82M** | Apache 2.0 | ~100–200× realtime on a GPU (RTF ≈ 0.03 on a 4090), runs even on CPU, 50+ built-in voices → each persona gets a distinct voice for free |
| TTS premium | **Chatterbox-Turbo** (350M, MIT) or Orpheus | MIT / Apache | Sub-200ms first-audio, emotion control, voice cloning — for expressive "premium personas." Qwen3-TTS (0.6B, ~97ms streaming) is the multilingual card for Phase 4 |

All models pulled from Hugging Face, baked into Docker images (no runtime downloads).

## Latency budget (target: voice-to-voice p50 < 1000ms)

| Stage | Target | Notes |
|---|---|---|
| End-of-turn detection | 200–400ms | smart-turn + VAD; the biggest win vs memdia's 1000–1500ms utterance tail |
| STT finalize | 50–150ms | Parakeet is effectively instant at these audio lengths |
| LLM first token | 250–450ms | OpenRouter/Gemini Flash, streamed |
| First sentence → TTS first audio | 50–150ms | Kokoro on-box, streamed per sentence chunk |
| Network + jitter buffer | 100–200ms | WebRTC/Opus, EU users → Hetzner Falkenstein |
| **Total** | **~650–1350ms** | p50 comfortably under 1s; measure every stage from day one |

Barge-in: Pipecat cancels the pipeline on user speech; the LLM stream and TTS queue are dropped server-side (one mechanism, not memdia's three-way client/server dance).

## Hardware & deployment

- **Dev:** local **RTX 3090 Ti** (24 GB — more VRAM than the production card; if it runs here comfortably it runs there). `docker compose up`: `voice-worker`, `stt`, `tts`, `webapp`, `postgres`, `caddy`.
- **Prod v1:** **Hetzner GEX44** — RTX 4000 SFF Ada, 20 GB VRAM, 64 GB RAM, ~**€184/mo** (+€79 setup). Parakeet (~2–3 GB VRAM) + Kokoro (~1 GB) + Chatterbox (~2–4 GB) all fit with lots of headroom; the GPU is mostly idle per-conversation, so **~10–15 concurrent conversations** is a conservative estimate for one box.
- **Scale path:** (1) second GEX44 behind LiveKit; (2) GEX130 (RTX 6000 Ada 48GB) if a self-hosted LLM ever joins; (3) burst capacity on Runpod/Vast for spikes. Voice workers are stateless — scaling is horizontal and boring, which is the point.

## Security & correctness rules (memdia lessons, non-negotiable)

1. No provider API keys ever reach a client. Clients get short-lived, session-scoped tokens for the voice worker only.
2. Session duration/quota enforced **in the voice worker** (it owns the clock); the client timer is cosmetic.
3. One pipeline. Session types and personas are *configuration* (system prompt, voice id, max duration, extraction profile) — never parallel code paths.
4. Every session logs per-stage latency + token/character counts → a simple metrics dashboard from week one.

## Client protocol (deliberately trivial)

Client → worker: Opus audio frames + `{start, stop, mute}` control messages.
Worker → client: Opus audio frames + JSON events (`transcript.partial`, `transcript.final`, `assistant.text`, `assistant.speaking`, `session.warning`, `session.end`).

That's the whole contract. The browser client is small; the ESP32 device implements the same thing (see [04-hardware-device.md](04-hardware-device.md)).
