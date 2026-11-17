// Custom server messages from the voice worker (mirrors voice/events.py
// and the session.warning/session.end emitters in voice/pipeline.py).

import type { TurnMetrics, UsageDelta } from './types'

export type ServerMessage =
  | { type: 'user.final'; text: string }
  | { type: 'assistant.final'; turn_id: string; text: string; interrupted: boolean }
  | {
      type: 'metrics.turn'
      turn_id: string
      eot_ms: number | null
      stt_ms: number | null
      llm_ttft_ms: number | null
      tts_ttfb_ms: number | null
      voice_to_voice_ms: number | null
    }
  | ({ type: 'usage.delta' } & UsageDelta)
  | { type: 'session.warning'; remaining_s: number }
  | { type: 'session.notice'; text: string }
  | { type: 'session.end'; reason: 'user' | 'limit' | 'error'; detail?: string }

export function toTurnMetrics(m: Extract<ServerMessage, { type: 'metrics.turn' }>): TurnMetrics {
  return {
    eotMs: m.eot_ms ?? 0,
    sttMs: m.stt_ms ?? 0,
    llmTtftMs: m.llm_ttft_ms ?? 0,
    ttsTtfbMs: m.tts_ttfb_ms ?? 0,
    voiceToVoiceMs: m.voice_to_voice_ms ?? 0
  }
}
