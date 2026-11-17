# Parla — Cost Analysis

## 1. What memdia pays today (the baseline)

Measured: **$0.55–0.65 per user per day** for 13 minutes (3-min memory + 10-min reflection) ≈ **$0.045/min ≈ $2.70 per conversation-hour**.

Itemized (per 13-min day, approximate):

| Component | Basis | Est. cost |
|---|---|---|
| ElevenLabs Turbo v2.5 via fal.ai | AI speaks ~5–7 min ≈ 4–5k characters, billed ~$0.10/1k chars, **per sentence** | **~$0.40–0.50** |
| Deepgram nova-3 streaming | ~13 min live WS ≈ $0.0077/min | ~$0.10 |
| Gemini Flash (OpenRouter) | ~10–20 turns, full history resent each turn | ~$0.01–0.03 |
| Session-end (summary + image gen + CDN) | once per session | ~$0.03–0.06 |

**TTS is ~75% of the bill.** That is the target.

## 2. Two ways to cut it

### Option A — cheaper API (no infra, do it in memdia too)
Deepgram **Aura-2** TTS ≈ $0.030/1k chars vs ~$0.10 via fal/ElevenLabs → cuts the TTS line ~3–4×, total day cost to roughly **$0.20–0.25**. One vendor for STT+TTS, native streaming. Worth doing in memdia regardless of Parla.

### Option B — self-host STT+TTS (Parla's approach)
| | Cost |
|---|---|
| Hetzner GEX44 (RTX 4000 SFF Ada 20GB) | **€184/mo** + €79 one-time |
| Control-plane VPS (webapp + Postgres) | ~€15/mo |
| LLM via OpenRouter | ~$0.001–0.003 per conversation-minute |
| STT (Parakeet) + TTS (Kokoro) | **€0 marginal** |
| **Fixed total** | **~€200/mo** |

## 3. Break-even

- Memdia-style API stack: ~$2.70/hour of conversation
- Parla fixed cost: ~€200 ≈ $215/mo

**Break-even ≈ 75–80 conversation-hours per month** (≈ 2.6 hours/day across all users).

Capacity of one GEX44 at ~10–15 concurrent conversations, even at a modest 20% average utilization ≈ **1,500+ conversation-hours/month**. So past break-even, the effective cost per hour collapses:

| Monthly usage | API stack | Parla | Parla cost/hour |
|---|---|---|---|
| 50 h | $135 | ~$215 | $4.30 (API wins) |
| 100 h | $270 | ~$215 | $2.15 |
| 500 h | $1,350 | ~$215 | **$0.43** |
| 1,500 h | $4,050 | ~$215 + LLM ~$100 | **~$0.21** |

## 4. What this means for the product

At $0.20–0.40/hour all-in, you can profitably sell:

- **$9.99/mo**: 30 min/day (≈15 h/mo → cost ≈ $3–6) — impossible on the API stack (would cost ~$40)
- **$19.99/mo**: 90 min/day + premium personas (Chatterbox voices)
- Unlimited-ish tiers become a marketing weapon: competitors paying ElevenLabs retail cannot follow.

The LLM becomes the only per-minute cost that scales with usage — budget ~$0.05–0.15 per conversation-hour with history windowing (last ~12 turns + running summary; **never** resend the full transcript like memdia does).

## 5. Risks / honest caveats

- **Quality gap:** Kokoro is excellent but its preset voices are less "wow" than ElevenLabs' best. Mitigation: Chatterbox-Turbo (beats ElevenLabs in some blind tests) for premium personas; A/B test before launch.
- **Ops burden:** you now run GPU infra. Mitigation: Docker images with baked models, health checks, one-command redeploy; keep a cheap API fallback path (Deepgram) configured for outages.
- **Under-utilization:** below ~75 h/mo the GPU loses money. Mitigation: launch Phase 0/1 on the **local 3090 Ti** (already owned, €0) and only rent the Hetzner box when real users arrive.
- **Concurrency spikes:** 16th concurrent user queues. Mitigation: measure real concurrency; LiveKit + second box is the pressure valve.
