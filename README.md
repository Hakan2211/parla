# Parla — Talk to AI, for hours, not minutes

*Working name: "Parla" (Italian: "speak!"). Rename freely.*

## The idea

A voice-AI companion platform where the economics are inverted. Memdia (the previous project) pays retail API prices — ~$0.55–0.65 for 13 minutes of daily conversation per user (~$0.045/min), dominated by ElevenLabs TTS. That forces short sessions and hard caps.

Parla self-hosts the expensive parts (speech-to-text, text-to-speech) on rented GPU servers running open-source models. The marginal cost of an extra conversation minute drops to ~zero. That unlocks the product:

- **Long conversations** — 30–60 min/day, or multiple sessions, without bleeding money
- **Personas** — different AI characters, each with their own voice, personality, and memory of you
- **A memory that compounds** — facts, plans, and people extracted from conversations feed scheduling/planning features
- **A hardware device** — a small speaker on your desk that talks to the same servers

## Why it works now

| | Memdia (API retail) | Parla (self-hosted) |
|---|---|---|
| STT | Deepgram nova-3 (~$0.008/min) | NVIDIA Parakeet TDT 0.6B v2 — free, top English accuracy |
| TTS | ElevenLabs Turbo via fal.ai (~$0.03–0.05/min of speech) | Kokoro-82M — free, 100–200× realtime on GPU |
| LLM | Gemini Flash via OpenRouter (pennies) | **Same** — stays on API, it's already almost free |
| Infra | $0 fixed | ~€184/mo (Hetzner GEX44 GPU) |
| Marginal cost/min | ~$0.045 | ~$0.00 (until GPU saturates) |

Break-even is roughly **75 total conversation-hours per month** across all users. One GEX44-class GPU handles ~10–15 concurrent conversations, i.e. thousands of user-hours/month of capacity. Details in [docs/02-cost-analysis.md](docs/02-cost-analysis.md).

## Desktop app (this repo)

The first runnable Parla is a Windows desktop app: Electron UI (chat sidebar,
WebGL voice sphere, personas, memory) + a local Python voice worker
(Pipecat: Silero VAD → smart-turn v3 → Parakeet STT → LLM → Kokoro TTS).

```powershell
# one-time
cd voice; uv sync; cd ..
powershell -File scripts/download-models.ps1   # Parakeet STT (~640MB)
cd app; npm install; npx electron-rebuild -f -w better-sqlite3; cd ..

# develop (starts voice server + Electron, hot reload)
powershell -File scripts/dev.ps1

# or: a Desktop icon that just starts it (build-if-stale, no console window)
powershell -File scripts/install-shortcut.ps1
```

The Desktop shortcut runs `scripts/parla.ps1` (via `parla-launch.vbs` so no
console flashes): it rebuilds only when `app/src` changed, then launches
Electron, which finds-or-spawns the voice server itself. Clicking it twice
is a no-op. Launcher log: `%LOCALAPPDATA%\Parla\launcher.log`.

- **LLM provider** is chosen in Settings: Claude (works with your Claude Code
  login, default), OpenRouter (fastest, needs API key), or LM Studio (fully
  local, start its server + load a model first).
- **Voice engine**: Kokoro-82M in-process (~100ms to first audio on the
  3090 Ti). The fish-audio **s2-pro** adapter is implemented and verified
  (Settings → "Fish s2-pro"; auto-falls-back to Kokoro when its server is
  down), but the plain fish-speech torch server —
  `cd D:\fish-speech; uv run --extra cu126 tools/api_server.py --listen
  127.0.0.1:8080 --llama-checkpoint-path checkpoints/s2-pro
  --decoder-checkpoint-path checkpoints/s2-pro/codec.pth --half` — runs the
  4B model at ~0.13× realtime on native Windows (measured ~110s to first
  audio). **Real-time s2-pro needs fish-audio's SGLang engine under WSL2**;
  until then Kokoro is the conversational engine.
- Voice tests: `cd voice; uv run pytest` (engine round-trip + full pipeline
  e2e over the real websocket protocol with a mock LLM).

## Documents

1. **[Architecture](docs/01-architecture.md)** — the realtime voice stack: Pipecat + Parakeet (STT) + Kokoro (TTS) + OpenRouter (LLM), WebRTC transport, deployment on local RTX 3090 Ti → Hetzner GPU
2. **[Cost analysis](docs/02-cost-analysis.md)** — itemized current costs, self-hosted economics, break-even math, scaling path
3. **[Roadmap](docs/03-roadmap.md)** — Phase 0 prototype → MVP with personas → long-term memory → scheduling/planning → multilingual
4. **[Hardware device](docs/04-hardware-device.md)** — the ESP32-based speaking companion device
5. **[Design prompts](docs/05-design-prompts.md)** — style system + per-screen prompts for generating UI mockups
6. **[Voice pipeline plan](docs/06-voice-pipeline-plan.md)** — measured findings (2026-11-17) and the prioritized latency/quality plan

## Principles (learned from memdia)

1. **Server is the authority.** No API keys in the browser, no client-side billing timers. Memdia shipped both; Parla never will.
2. **One implementation per concern.** Memdia grew two parallel pipelines (WS + SSE) and two parallel session systems. Parla has one voice pipeline with a `persona`/`sessionType` config, not code forks.
3. **Latency is a budget, not a hope.** Every stage has a millisecond target (see architecture doc) and is measured in production.
4. **Thin clients.** All intelligence (VAD, turn-taking, barge-in) lives server-side, so the browser client and the future hardware device speak the same trivial protocol: audio in, audio out.
