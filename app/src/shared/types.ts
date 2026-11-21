// Shared domain types — used by main (DB/IPC), preload, and renderer.

export type LLMProvider = 'openrouter' | 'lmstudio' | 'claude' | 'anthropic'
export type TTSEngine = 'kokoro' | 'fish'
export type STTEngine = 'sherpa' | 'faster_whisper'

export interface LLMConfig {
  provider: LLMProvider
  model: string
  apiKey?: string
  baseUrl?: string
}

export interface Persona {
  id: string
  name: string
  systemPrompt: string
  voiceId: string
  color: string
  isBuiltin: boolean
  createdAt: number
  updatedAt: number
}

export interface Chat {
  id: string
  personaId: string | null
  title: string | null
  summary: string | null
  provider: string | null
  model: string | null
  startedAt: number
  endedAt: number | null
  extractionStatus: 'pending' | 'done' | 'failed' | 'skipped'
  /** Sum of priced usage for this chat (conversation + extraction), USD. */
  costUsd: number
  /** The Studio project the conversation was about, if any. */
  studioProjectId: string | null
  /** Sending proposals to Studio's Inbox. 'none': not a Studio conversation. */
  studioStatus: StudioStatus
  /** Proposals Studio took (skipped repeats not counted). */
  studioSent: number
  /** Why the last send failed or was skipped. */
  studioDetail: string | null
}

export type StudioStatus = 'none' | 'pending' | 'done' | 'failed' | 'skipped'

/** A Studio project as the session picker shows it. */
export interface StudioProject {
  id: string
  title: string
  status: string
  format: string
}

/** What a launch asked for (`--studio-project <id>`, `--open-chat <id>`). */
export interface LaunchIntent {
  studioProject?: string
  openChat?: string
}

export interface TurnMetrics {
  eotMs: number
  sttMs: number
  llmTtftMs: number
  ttsTtfbMs: number
  voiceToVoiceMs: number
}

export interface Message {
  id: string
  chatId: string
  role: 'user' | 'assistant'
  content: string
  interrupted: boolean
  metrics: TurnMetrics | null
  createdAt: number
}

export type MemoryKind = 'fact' | 'person' | 'thread' | 'commitment'

export interface MemoryEntry {
  id: string
  kind: MemoryKind
  content: string
  importance: number
  status: 'active' | 'archived'
  sourceChatId: string | null
  createdAt: number
  updatedAt: number
}

export interface VoiceServerStatus {
  state: 'starting' | 'ready' | 'error' | 'stopped'
  port: number | null
  detail?: string
  models?: { stt: boolean; tts: boolean }
}

export interface SessionStartResult {
  chatId: string
  sessionId: string
  wsUrl: string
  /** Shown at the top of the session, e.g. "Studio isn't running …". */
  notice?: string
}

/** Incremental usage reported by the voice worker (mirrors voice/events.py). */
export interface UsageDelta {
  model?: string | null
  input_tokens?: number
  cache_read_tokens?: number
  cache_write_tokens?: number
  output_tokens?: number
  /** Provider-reported cost (Claude CLI). Otherwise priced in main. */
  cost_usd?: number
  tts_chars?: number
  tts_seconds?: number
  stt_seconds?: number
}

/** How a cost figure was obtained — shown to the user, never hidden. */
export type CostSource = 'provider' | 'pricing' | 'local' | 'unknown'

export interface UsageTotals {
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  ttsChars: number
  ttsSeconds: number
  sttSeconds: number
  costUsd: number
  /** What the same STT+TTS would have cost on cloud APIs (Deepgram + ElevenLabs). */
  cloudVoiceEquivUsd: number
  /** True if any LLM usage could not be priced (unknown model). */
  hasUnpriced: boolean
  /** True if any cost is subscription-covered (Claude via Claude Code login). */
  subscriptionCovered: boolean
}

export interface UsageSummary {
  today: UsageTotals
  last7d: UsageTotals
  last30d: UsageTotals
  allTime: UsageTotals
  byModel: { provider: string; model: string; costUsd: number; tokens: number; sessions: number }[]
  /** Last 30 local days, oldest first, zero-filled. `day` is YYYY-MM-DD. */
  daily: { day: string; costUsd: number }[]
}

export interface OpenRouterKeyInfo {
  label: string | null
  usageUsd: number | null
  limitUsd: number | null
  limitRemainingUsd: number | null
  isFreeTier: boolean | null
}

/** LM Studio state for the local (private) provider. */
export interface LocalModel {
  key: string
  params: string | null
  sizeGb: number
  loaded: boolean
}

export interface LocalStatus {
  available: boolean // lms CLI found
  serverUp: boolean
  loading: string | null // model key currently loading
  models: LocalModel[]
  error?: string
}
