# Parla — Voice pipeline: findings & plan (2026-11-17)

All numbers are measured on the RTX 3090 Ti unless marked *estimate*.

## Fixed today

| Problem | Before | After |
|---|---|---|
| Claude via the Agent SDK loaded the whole Claude Code harness (built-in tools, all your MCP servers, CLAUDE.md, settings) into **every voice turn** | ~30,500 tokens/turn, all cache *writes*; **$0.18/turn** API-equivalent (Sonnet) | ~200 tokens/turn, **$0.001/turn** |
| …and the harness prompt overrode the persona | "Hi! 👋 Ready to help with whatever you need." | Follows the persona prompt |
| CLI fired a hidden Haiku call on the first query of each session | +~520 tokens/session | removed (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`) |
| Claude CLI spawned lazily on the first user turn | first reply LLM TTFT 2.4s | pre-connected at session start: 1.0–1.3s |
| Kokoro's first synthesis on a cold CUDA context | first reply TTS TTFB 2.0s | warmed up at server start: 0.4s |
| **First-turn voice-to-voice** | **4.7s** | **1.9–2.3s** |
| Custom LLM/TTS services never reported metrics (`can_generate_metrics` defaulted to False) | no token, character, or TTFB metrics | reported |

Usage and cost tracking now runs end to end. The voice worker emits `usage.delta`
(tokens, TTS characters and seconds, STT seconds), main prices it (provider-reported
first, then the OpenRouter live price list, then a Claude price table; local is $0)
into the `usage_events` ledger. The UI shows a live pill during sessions, a stats
strip per conversation, cost per chat in the sidebar, and a Settings → Usage panel
with an OpenRouter key-balance check.

## What dominates latency now

Voice-to-voice ≈ end-of-turn (~0.25s) + **LLM first token (1.0–1.3s, Claude CLI)**
+ first-sentence TTS (0.4–1.0s, partly waiting for the first full sentence).
The LLM is now the bottleneck. Roughly in order of payoff:

### 1. LLM: add two faster providers (biggest win)

- **Anthropic API direct (API key).** Skips the CLI subprocess entirely, gets real
  prompt caching of the persona + memory brief, and returns exact usage on every
  response. Claude Haiku 5.5 is $0.10/$0.50 per M tokens, about $0.0001 per voice
  turn. *Estimate:* TTFT well under the CLI's ~1.1s. This is also the cleanest
  "log usage via API key" story.
- **Local "private mode" LLM — DONE (2026-11-17).** Settings → "Local (private)".
  Parla starts LM Studio's server, loads the model through LM Studio's REST
  API with a 16k context (pre-loaded in the background at app start), and
  unloads it on quit if it loaded it. Measured with gemma-4-26b-a4b-it:

  | | Claude (subscription, CLI) | Local Gemma 4 26B-A4B |
  |---|---|---|
  | LLM first token | 1.0–1.3s | ~0.3s in pipeline (~165ms raw, warm) |
  | **Voice-to-voice** | 1.9–2.3s | **0.75–0.80s** |
  | Cost per turn | ~$0.001 API-equiv. | $0 |
  | VRAM (whole stack) | ~1.4GB | ~20.8GB of 24.5GB |

  Thinking must be off (`reasoning_effort: "none"`, the only switch LM Studio
  honored): with Gemma's default thinking on, first token took 2.3–4.4s and
  one turn spent its whole budget thinking without answering. Memory
  extraction runs locally too (~2.8s) with a JSON schema, because LM Studio
  rejects `json_object`.

### 2. LLM context hygiene — DONE (2026-11-17)

- **Rolling summary** (OpenRouter, LM Studio, Anthropic API): context is
  system prompt + running summary + the last 24 messages (~12 exchanges),
  via Pipecat's `LLMContextSummarizer` (`llm/context_window.py`). It compacts
  in chunks, at 36 messages or ~10k estimated tokens, not as a sliding
  window, so the Anthropic cache prefix stays valid between compactions.
  Summaries go through `factory.complete()`, not Pipecat's `run_inference`
  (which reports no usage and skips our Anthropic effort hook), so their
  tokens land in the usage ledger. They wait until the bot stops speaking,
  so a local summary never competes with a live reply for the GPU.
- **Claude (CLI) path**: when a reply was interrupted, the next user turn
  carries "(Context: … they heard only: "…" Treat the rest as unsaid.)",
  with the heard text taken from Pipecat's context (what TTS actually played).
- **Bug fixed on the way**: an interruption during generation cancelled our
  read of the CLI stream mid-response, so the *next* turn read the old
  reply's tail and stopped at its ResultMessage. Now the CLI is interrupted
  and drained in the background (~0.1s, verified live). Note: the CLI reports
  0 tokens / $0 for an interrupted turn.
- Not yet verified live: a compaction against LM Studio (unit-tested with a
  faked completion; the pipeline e2e test runs through the new wiring).

### 3. TTS

- **First-clause chunking — DONE (2026-11-17).** `tts/chunking.py`
  (`FirstClauseAggregator`, wired in through Pipecat's `LLMTextProcessor`
  between the LLM and TTS). The first chunk of each reply goes to TTS at the
  first clause break (`, : — –`) once it holds ≥20 characters, or at a word
  boundary once it reaches 50. The rest of the reply is aggregated by sentence
  as before. The 20-character floor keeps the first clip long enough that the
  next chunk is synthesized before it finishes playing. Measured with Kokoro
  and replies streamed at LLM-like rates:

  | Reply opening | LLM rate | Sentence mode | First-clause | Saved |
  |---|---|---|---|---|
  | "Oh, that sounds like a wonderful way to spend the day, …" | 240 ch/s | 810ms | 512ms | 300ms |
  | "Honestly, I think the hardest part of learning a new …" | 240 ch/s | 978ms | 524ms | 450ms |
  | "Hiking in the mountains with your brother sounds like …" | 240 ch/s | 946ms | 637ms | 310ms |
  | same three | 480 ch/s | 409–792ms | 291–312ms | 100–490ms |
  | "Yes. …" (short first sentence) | either | 121–145ms | 75–131ms | ~0 |

  There were no playback gaps between chunks in any run. Still to check by ear:
  splits at the 50-character fallback ("…learning a new | language…") may
  dip in pitch at the cut. If they do, raise `max_chars`.
- **Qwen3-TTS — PARKED (measured 2026-11-17).** The open-source `qwen_tts`
  0.1.1 package has **no streaming generation** (its own docstring says so), and
  CustomVoice 1.7B (bf16, sdpa, no flash-attn) runs at **RTF 1.8–2.3** on the
  3090 Ti: 5.6–8.6s for a 55-character clause, 13–19s for a 106-character
  sentence. That's about 2x slower than realtime, so it can't be used for
  conversation. It also pins transformers 4.57 / torch 2.6, which clashes with
  the voice env (transformers 5.14 / torch 2.13), so it would need its own
  worker process like Parakeet. It uses 4.4GB of VRAM. The existing env is at
  `D:\AIModels\localai\envs\qwen-tts`, and voice-design samples are in
  `D:\AIModels\localai\tts_bakeoff`. Revisit only with a streaming,
  optimized runtime (CUDA graphs / vLLM-style serving, likely under WSL2).
  It could still be useful offline for persona greetings or voice previews.
  Kokoro stays the only real-time engine. Fish s2-pro also stays parked
  (non-commercial license, not real-time on Windows).

### 4. STT and turn-taking — DONE except model choice (2026-11-17)

- **Bug found and fixed: barge-in protection was never active.** The user
  context aggregator ran its own default turn strategies alongside our
  `UserTurnProcessor`: VAD start *with interruptions on* (every VAD blip cut
  the bot off before `BargeInGate` could judge it) and stock smart-turn v3
  at p > 0.5 (not `PatientSmartTurnV3`) for turn ends. It now gets
  `ExternalUserTurnStrategies()` and follows `turn`. The renderer also
  flushed bot playback on every `user-started-speaking`; it now flushes only
  on `bot-interrupted`.
- **Interim transcripts while the bot speaks.** `SherpaParakeetSTTService`
  decodes the in-progress segment every 300ms (from 0.5s of audio, up to an
  8s cap) only while the bot is speaking, and pushes
  `InterimTranscriptionFrame`s that `BargeInGate` counts. Interims stop at
  VAD stop, so the final never waits behind a new interim. Measured live
  (Kokoro speech over a talking bot, 3.65s utterance): **the bot yields after
  1.9s ("Yesterday I went") instead of 4.4s** (finals only, after the user
  paused). `tests/test_pipeline_e2e.py::test_barge_in_uses_interim_transcripts`.
- Parakeet int8 CPU decode cost (4 threads): 0.5s audio 42ms, 1s 64ms,
  2s 106ms, 3s 141ms, 5s 233ms, 8s 348ms (about 45ms per second of audio).
- **`stt_ms` fixed**: now VAD stop → transcription (218ms for a 3.6s
  utterance in the e2e test). `llm_ttft_ms` now starts at whichever comes
  last, the transcription or the turn-end decision.
- Still open (a decision, not a bug):
  - Parakeet TDT 0.6B **v3** (25 European languages, same sherpa-onnx path)
    only matters if you want to talk in other languages; Kokoro and the
    personas are English-first.
  - CUDA for Parakeet would save about 100ms on a typical turn, but needs the
    sherpa-onnx CUDA wheel plus an fp16/fp32 model (int8 runs poorly on the
    CUDA provider) and about 1–2GB of VRAM. With local Gemma loaded the stack
    already uses ~20.8 of 24.5GB.

### 5. Housekeeping

- Pipecat 1.6 deprecations: `PipelineTask` → `PipelineWorker`,
  `PipelineRunner` → `WorkerRunner`. These will break at Pipecat 2.0.
- The project isn't under git. Initialize a repository before the next large change.
