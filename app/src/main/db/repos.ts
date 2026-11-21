// Typed repositories over the SQLite tables. All row mapping lives here.

import { randomUUID } from 'crypto'
import type {
  Chat,
  MemoryEntry,
  MemoryKind,
  Message,
  Persona,
  TurnMetrics,
  UsageTotals
} from '@shared/types'
import { getDb } from './index'

// --- chats ---

interface ChatRow {
  id: string
  persona_id: string | null
  title: string | null
  summary: string | null
  provider: string | null
  model: string | null
  started_at: number
  ended_at: number | null
  extraction_status: Chat['extractionStatus']
  cost_usd: number | null
}

// Chats always come with their summed cost attached.
const CHAT_SELECT = `SELECT c.*,
  (SELECT COALESCE(SUM(u.cost_usd), 0) FROM usage_events u WHERE u.chat_id = c.id) AS cost_usd
  FROM chats c`

function toChat(r: ChatRow): Chat {
  return {
    id: r.id,
    personaId: r.persona_id,
    title: r.title,
    summary: r.summary,
    provider: r.provider,
    model: r.model,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    extractionStatus: r.extraction_status,
    costUsd: r.cost_usd ?? 0
  }
}

export const chatsRepo = {
  create(input: { id: string; personaId: string | null; provider: string; model: string }): Chat {
    getDb()
      .prepare(
        `INSERT INTO chats (id, persona_id, provider, model, started_at, extraction_status)
         VALUES (?, ?, ?, ?, ?, 'pending')`
      )
      .run(input.id, input.personaId, input.provider, input.model, Date.now())
    return this.get(input.id)!
  },

  get(id: string): Chat | null {
    const row = getDb().prepare(`${CHAT_SELECT} WHERE c.id = ?`).get(id) as
      | ChatRow
      | undefined
    return row ? toChat(row) : null
  },

  list(): Chat[] {
    return (getDb().prepare(`${CHAT_SELECT} ORDER BY c.started_at DESC`).all() as ChatRow[]).map(
      toChat
    )
  },

  end(id: string): void {
    getDb().prepare('UPDATE chats SET ended_at = ? WHERE id = ?').run(Date.now(), id)
  },

  setExtraction(
    id: string,
    status: Chat['extractionStatus'],
    title?: string,
    summary?: string
  ): void {
    getDb()
      .prepare(
        `UPDATE chats SET extraction_status = ?,
           title = COALESCE(?, title), summary = COALESCE(?, summary)
         WHERE id = ?`
      )
      .run(status, title ?? null, summary ?? null, id)
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM chats WHERE id = ?').run(id)
  },

  listPendingExtraction(): Chat[] {
    return (
      getDb()
        .prepare(
          `${CHAT_SELECT}
           WHERE c.ended_at IS NOT NULL AND c.extraction_status IN ('pending','failed')
           ORDER BY c.started_at DESC LIMIT 10`
        )
        .all() as ChatRow[]
    ).map(toChat)
  }
}

// --- messages ---

interface MessageRow {
  id: string
  chat_id: string
  role: 'user' | 'assistant'
  content: string
  interrupted: number
  metrics: string | null
  created_at: number
}

function toMessage(r: MessageRow): Message {
  return {
    id: r.id,
    chatId: r.chat_id,
    role: r.role,
    content: r.content,
    interrupted: r.interrupted === 1,
    metrics: r.metrics ? (JSON.parse(r.metrics) as TurnMetrics) : null,
    createdAt: r.created_at
  }
}

export const messagesRepo = {
  add(input: {
    chatId: string
    role: 'user' | 'assistant'
    content: string
    interrupted?: boolean
    metrics?: TurnMetrics | null
  }): Message {
    const id = randomUUID()
    getDb()
      .prepare(
        `INSERT INTO messages (id, chat_id, role, content, interrupted, metrics, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.chatId,
        input.role,
        input.content,
        input.interrupted ? 1 : 0,
        input.metrics ? JSON.stringify(input.metrics) : null,
        Date.now()
      )
    return toMessage(
      getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow
    )
  },

  listForChat(chatId: string): Message[] {
    return (
      getDb()
        .prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at')
        .all(chatId) as MessageRow[]
    ).map(toMessage)
  },

  countForChat(chatId: string, role?: 'user' | 'assistant'): number {
    if (role) {
      return (
        getDb()
          .prepare('SELECT COUNT(*) c FROM messages WHERE chat_id = ? AND role = ?')
          .get(chatId, role) as { c: number }
      ).c
    }
    return (
      getDb().prepare('SELECT COUNT(*) c FROM messages WHERE chat_id = ?').get(chatId) as {
        c: number
      }
    ).c
  }
}

// --- personas ---

interface PersonaRow {
  id: string
  name: string
  system_prompt: string
  voice_id: string
  color: string
  is_builtin: number
  created_at: number
  updated_at: number
}

function toPersona(r: PersonaRow): Persona {
  return {
    id: r.id,
    name: r.name,
    systemPrompt: r.system_prompt,
    voiceId: r.voice_id,
    color: r.color,
    isBuiltin: r.is_builtin === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export const personasRepo = {
  list(): Persona[] {
    return (
      getDb().prepare('SELECT * FROM personas ORDER BY created_at').all() as PersonaRow[]
    ).map(toPersona)
  },

  get(id: string): Persona | null {
    const row = getDb().prepare('SELECT * FROM personas WHERE id = ?').get(id) as
      | PersonaRow
      | undefined
    return row ? toPersona(row) : null
  },

  create(input: {
    name: string
    systemPrompt: string
    voiceId: string
    color: string
    isBuiltin?: boolean
    id?: string
  }): Persona {
    const id = input.id ?? randomUUID()
    const now = Date.now()
    getDb()
      .prepare(
        `INSERT INTO personas (id, name, system_prompt, voice_id, color, is_builtin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.name, input.systemPrompt, input.voiceId, input.color, input.isBuiltin ? 1 : 0, now, now)
    return this.get(id)!
  },

  update(
    id: string,
    patch: Partial<Pick<Persona, 'name' | 'systemPrompt' | 'voiceId' | 'color'>>
  ): Persona | null {
    const existing = this.get(id)
    if (!existing) return null
    getDb()
      .prepare(
        `UPDATE personas SET name = ?, system_prompt = ?, voice_id = ?, color = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        patch.name ?? existing.name,
        patch.systemPrompt ?? existing.systemPrompt,
        patch.voiceId ?? existing.voiceId,
        patch.color ?? existing.color,
        Date.now(),
        id
      )
    return this.get(id)
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM personas WHERE id = ? AND is_builtin = 0').run(id)
  }
}

// --- memory ---

interface MemoryRow {
  id: string
  kind: MemoryKind
  content: string
  importance: number
  status: 'active' | 'archived'
  source_chat_id: string | null
  created_at: number
  updated_at: number
}

function toMemory(r: MemoryRow): MemoryEntry {
  return {
    id: r.id,
    kind: r.kind,
    content: r.content,
    importance: r.importance,
    status: r.status,
    sourceChatId: r.source_chat_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export const memoryRepo = {
  listActive(): MemoryEntry[] {
    return (
      getDb()
        .prepare(
          `SELECT * FROM memory_entries WHERE status = 'active'
           ORDER BY importance DESC, updated_at DESC`
        )
        .all() as MemoryRow[]
    ).map(toMemory)
  },

  listAll(): MemoryEntry[] {
    return (
      getDb()
        .prepare('SELECT * FROM memory_entries ORDER BY updated_at DESC')
        .all() as MemoryRow[]
    ).map(toMemory)
  },

  add(input: {
    kind: MemoryKind
    content: string
    importance: number
    sourceChatId?: string | null
  }): MemoryEntry {
    const id = randomUUID()
    const now = Date.now()
    getDb()
      .prepare(
        `INSERT INTO memory_entries (id, kind, content, importance, status, source_chat_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
      )
      .run(id, input.kind, input.content, input.importance, input.sourceChatId ?? null, now, now)
    return toMemory(
      getDb().prepare('SELECT * FROM memory_entries WHERE id = ?').get(id) as MemoryRow
    )
  },

  update(
    id: string,
    patch: Partial<Pick<MemoryEntry, 'content' | 'importance' | 'status' | 'kind'>>
  ): void {
    const row = getDb().prepare('SELECT * FROM memory_entries WHERE id = ?').get(id) as
      | MemoryRow
      | undefined
    if (!row) return
    getDb()
      .prepare(
        `UPDATE memory_entries SET kind = ?, content = ?, importance = ?, status = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        patch.kind ?? row.kind,
        patch.content ?? row.content,
        patch.importance ?? row.importance,
        patch.status ?? row.status,
        Date.now(),
        id
      )
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM memory_entries WHERE id = ?').run(id)
  }
}

// --- settings ---

export const settingsRepo = {
  get<T>(key: string, fallback: T): T {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    if (!row) return fallback
    try {
      return JSON.parse(row.value) as T
    } catch {
      return fallback
    }
  },

  set(key: string, value: unknown): void {
    getDb()
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, JSON.stringify(value))
  },

  all(): Record<string, unknown> {
    const rows = getDb().prepare('SELECT key, value FROM settings').all() as {
      key: string
      value: string
    }[]
    const out: Record<string, unknown> = {}
    for (const r of rows) {
      try {
        out[r.key] = JSON.parse(r.value)
      } catch {
        // skip malformed
      }
    }
    return out
  }
}

// --- usage ---

export interface UsageEventInput {
  chatId: string | null
  kind: 'conversation' | 'extraction'
  provider: string
  model: string | null
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  ttsChars: number
  ttsSeconds: number
  sttSeconds: number
  costUsd: number
  costSource: string
}

interface TotalsRow {
  input_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  output_tokens: number
  tts_chars: number
  tts_seconds: number
  stt_seconds: number
  cost_usd: number
  unpriced: number
  subscription: number
}

const TOTALS_SQL = `SELECT
  COALESCE(SUM(input_tokens),0) input_tokens,
  COALESCE(SUM(cache_read_tokens),0) cache_read_tokens,
  COALESCE(SUM(cache_write_tokens),0) cache_write_tokens,
  COALESCE(SUM(output_tokens),0) output_tokens,
  COALESCE(SUM(tts_chars),0) tts_chars,
  COALESCE(SUM(tts_seconds),0) tts_seconds,
  COALESCE(SUM(stt_seconds),0) stt_seconds,
  COALESCE(SUM(cost_usd),0) cost_usd,
  COALESCE(MAX(cost_source = 'unknown'),0) unpriced,
  COALESCE(MAX(provider = 'claude'),0) subscription
  FROM usage_events`

export function totalsFromRow(
  r: TotalsRow,
  cloudEquiv: (stt: number, chars: number) => number
): UsageTotals {
  return {
    inputTokens: r.input_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheWriteTokens: r.cache_write_tokens,
    outputTokens: r.output_tokens,
    ttsChars: r.tts_chars,
    ttsSeconds: r.tts_seconds,
    sttSeconds: r.stt_seconds,
    costUsd: r.cost_usd,
    cloudVoiceEquivUsd: cloudEquiv(r.stt_seconds, r.tts_chars),
    hasUnpriced: r.unpriced === 1,
    subscriptionCovered: r.subscription === 1
  }
}

export const usageRepo = {
  add(e: UsageEventInput): void {
    getDb()
      .prepare(
        `INSERT INTO usage_events (chat_id, kind, provider, model, input_tokens, cache_read_tokens,
           cache_write_tokens, output_tokens, tts_chars, tts_seconds, stt_seconds, cost_usd,
           cost_source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        e.chatId,
        e.kind,
        e.provider,
        e.model,
        e.inputTokens,
        e.cacheReadTokens,
        e.cacheWriteTokens,
        e.outputTokens,
        e.ttsChars,
        e.ttsSeconds,
        e.sttSeconds,
        e.costUsd,
        e.costSource,
        Date.now()
      )
  },

  totalsForChat(chatId: string): TotalsRow {
    return getDb().prepare(`${TOTALS_SQL} WHERE chat_id = ?`).get(chatId) as TotalsRow
  },

  totalsSince(since: number): TotalsRow {
    return getDb().prepare(`${TOTALS_SQL} WHERE created_at >= ?`).get(since) as TotalsRow
  },

  /** Cost per local calendar day since `since` (days with no usage omitted). */
  daily(since: number): { day: string; costUsd: number }[] {
    return getDb()
      .prepare(
        `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') day,
           SUM(cost_usd) costUsd
         FROM usage_events WHERE created_at >= ? GROUP BY day ORDER BY day`
      )
      .all(since) as { day: string; costUsd: number }[]
  },

  byModel(): { provider: string; model: string; costUsd: number; tokens: number; sessions: number }[] {
    return getDb()
      .prepare(
        `SELECT provider, COALESCE(model, '?') model, SUM(cost_usd) costUsd,
           SUM(input_tokens + cache_read_tokens + cache_write_tokens + output_tokens) tokens,
           COUNT(DISTINCT chat_id) sessions
         FROM usage_events
         WHERE input_tokens + cache_read_tokens + cache_write_tokens + output_tokens > 0
         GROUP BY provider, model ORDER BY costUsd DESC`
      )
      .all() as { provider: string; model: string; costUsd: number; tokens: number; sessions: number }[]
  }
}
