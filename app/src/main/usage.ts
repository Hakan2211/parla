// Usage ledger: price each usage.delta from the voice worker (and each
// extraction call) at insert time, and answer per-chat / period summaries.

import type { OpenRouterKeyInfo, UsageDelta, UsageSummary, UsageTotals } from '@shared/types'
import { chatsRepo, settingsRepo, totalsFromRow, usageRepo } from './db/repos'
import { cloudVoiceEquivUsd, priceLLMUsage } from './pricing'

export function recordUsage(
  chatId: string | null,
  kind: 'conversation' | 'extraction',
  delta: UsageDelta,
  providerOverride?: string
): void {
  const chat = chatId ? chatsRepo.get(chatId) : null
  const provider = providerOverride ?? chat?.provider ?? 'unknown'
  const model = delta.model ?? chat?.model ?? null
  const tokens = {
    input: delta.input_tokens ?? 0,
    cacheRead: delta.cache_read_tokens ?? 0,
    cacheWrite: delta.cache_write_tokens ?? 0,
    output: delta.output_tokens ?? 0
  }
  const priced = priceLLMUsage(provider, model, tokens, delta.cost_usd)
  usageRepo.add({
    chatId,
    kind,
    provider,
    model,
    inputTokens: tokens.input,
    cacheReadTokens: tokens.cacheRead,
    cacheWriteTokens: tokens.cacheWrite,
    outputTokens: tokens.output,
    ttsChars: delta.tts_chars ?? 0,
    ttsSeconds: delta.tts_seconds ?? 0,
    sttSeconds: delta.stt_seconds ?? 0,
    costUsd: priced.costUsd,
    // Audio-only deltas are local STT/TTS: free, and labelled as such.
    costSource:
      tokens.input + tokens.cacheRead + tokens.cacheWrite + tokens.output === 0
        ? 'local'
        : priced.source
  })
}

export function chatUsage(chatId: string): UsageTotals {
  return totalsFromRow(usageRepo.totalsForChat(chatId), cloudVoiceEquivUsd)
}

export function usageSummary(): UsageSummary {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 86_400_000
  const totals = (since: number): UsageTotals =>
    totalsFromRow(usageRepo.totalsSince(since), cloudVoiceEquivUsd)
  return {
    today: totals(startOfToday),
    last7d: totals(Date.now() - 7 * day),
    last30d: totals(Date.now() - 30 * day),
    allTime: totals(0),
    byModel: usageRepo.byModel()
  }
}

/** Live balance/usage of the configured OpenRouter key (key never leaves main). */
export async function openRouterKeyInfo(): Promise<OpenRouterKeyInfo | null> {
  const key = process.env.OPENROUTER_API_KEY || settingsRepo.get('llm.openrouter.apiKey', '')
  if (!key) return null
  const res = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(5000)
  })
  if (!res.ok) throw new Error(`OpenRouter rejected the key (${res.status})`)
  const { data } = (await res.json()) as { data?: Record<string, unknown> }
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
  return {
    label: typeof data?.label === 'string' ? data.label : null,
    usageUsd: num(data?.usage),
    limitUsd: num(data?.limit),
    limitRemainingUsd: num(data?.limit_remaining),
    isFreeTier: typeof data?.is_free_tier === 'boolean' ? data.is_free_tier : null
  }
}
