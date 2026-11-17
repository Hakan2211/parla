// Turns token/character counts into dollars.
//
// Priority, most to least trustworthy:
//   1. provider-reported cost (Claude CLI reports exact costUSD per query)
//   2. live price list (OpenRouter /api/v1/models, cached for a day)
//   3. the static Claude table below (direct Anthropic API; CLI fallback)
//   4. local models (LM Studio) are $0 — your GPU, your electricity
// Anything we can't price is recorded as 'unknown' with $0 and flagged in
// the UI, never silently guessed.

import type { CostSource, LLMProvider } from '@shared/types'
import { settingsRepo } from './db/repos'

/** USD per 1M tokens. */
interface ModelPrice {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

// Anthropic first-party API list prices, USD per 1M tokens (cached
// 2026-11-03). Keys are prefixes: 'claude-haiku-4-5' also matches
// 'claude-haiku-4-5-20251001'; the longest matching prefix wins, so
// 'claude-opus-5-5' beats 'claude-opus-5'. Cache writes are derived per
// provider below because the TTL (and so the multiplier) differs.
type ListPrice = Omit<ModelPrice, 'cacheWrite'>
const CLAUDE_API_PRICES: Record<string, ListPrice> = {
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 1 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 }
}

// The Claude Code CLI bills some models differently from the API list —
// measured from its own costUSD on 2026-11-17. Only used as a fallback when
// the CLI omits its cost (normally it reports it and we use that).
const CLAUDE_CLI_OVERRIDES: Record<string, ListPrice> = {
  'claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3 }
}

function longestPrefix<T>(table: Record<string, T>, model: string): T | null {
  let best: string | null = null
  for (const key of Object.keys(table)) {
    if (model.startsWith(key) && (!best || key.length > best.length)) best = key
  }
  return best ? table[best] : null
}

/**
 * 'anthropic' (direct API): Pipecat caches with the default 5-minute TTL,
 * so writes cost 1.25x input. 'claude' (CLI): the CLI writes 1-hour cache
 * entries, which cost 2x input.
 */
function claudePrice(provider: 'claude' | 'anthropic', model: string): ModelPrice | null {
  const list =
    (provider === 'claude' ? longestPrefix(CLAUDE_CLI_OVERRIDES, model) : null) ??
    longestPrefix(CLAUDE_API_PRICES, model)
  if (!list) return null
  return { ...list, cacheWrite: list.input * (provider === 'claude' ? 2 : 1.25) }
}

// What the same voice minutes would cost on cloud APIs — the baseline from
// docs/02-cost-analysis.md (Deepgram nova-3 streaming, ElevenLabs via fal).
export const CLOUD_STT_USD_PER_MIN = 0.0077
export const CLOUD_TTS_USD_PER_1K_CHARS = 0.1

export function cloudVoiceEquivUsd(sttSeconds: number, ttsChars: number): number {
  return (sttSeconds / 60) * CLOUD_STT_USD_PER_MIN + (ttsChars / 1000) * CLOUD_TTS_USD_PER_1K_CHARS
}

// --- OpenRouter live prices ---

const OPENROUTER_CACHE_KEY = 'pricing.openrouter.cache'
const OPENROUTER_TTL_MS = 24 * 60 * 60 * 1000

interface OpenRouterCache {
  fetchedAt: number
  prices: Record<string, ModelPrice>
}

let openRouterPrices: Record<string, ModelPrice> | null = null

/** Refresh the OpenRouter price list if stale. Public endpoint, no key sent. */
export async function refreshOpenRouterPrices(): Promise<void> {
  const cached = settingsRepo.get<OpenRouterCache | null>(OPENROUTER_CACHE_KEY, null)
  if (cached && Date.now() - cached.fetchedAt < OPENROUTER_TTL_MS) {
    openRouterPrices = cached.prices
    return
  }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      signal: AbortSignal.timeout(5000)
    })
    if (!res.ok) throw new Error(String(res.status))
    const body = (await res.json()) as {
      data: { id: string; pricing?: Record<string, string | undefined> }[]
    }
    const perM = (v: string | undefined): number => (v ? Number(v) * 1_000_000 : 0)
    const prices: Record<string, ModelPrice> = {}
    for (const m of body.data) {
      if (!m.pricing) continue
      prices[m.id] = {
        input: perM(m.pricing.prompt),
        output: perM(m.pricing.completion),
        cacheRead: perM(m.pricing.input_cache_read ?? m.pricing.prompt),
        cacheWrite: perM(m.pricing.input_cache_write ?? m.pricing.prompt)
      }
    }
    openRouterPrices = prices
    settingsRepo.set(OPENROUTER_CACHE_KEY, { fetchedAt: Date.now(), prices })
  } catch (e) {
    // Offline: keep whatever (possibly stale) cache we had.
    openRouterPrices = cached?.prices ?? openRouterPrices
    console.warn('openrouter price refresh failed', e)
  }
}

export interface PricedUsage {
  costUsd: number
  source: CostSource
}

export function priceLLMUsage(
  provider: LLMProvider | string,
  model: string | null | undefined,
  tokens: { input: number; cacheRead: number; cacheWrite: number; output: number },
  providerCostUsd?: number
): PricedUsage {
  if (providerCostUsd !== undefined && providerCostUsd !== null) {
    return { costUsd: providerCostUsd, source: 'provider' }
  }
  if (provider === 'lmstudio') return { costUsd: 0, source: 'local' }
  const total = tokens.input + tokens.cacheRead + tokens.cacheWrite + tokens.output
  if (total === 0) return { costUsd: 0, source: 'pricing' }

  let price: ModelPrice | null = null
  if (model && (provider === 'claude' || provider === 'anthropic')) {
    price = claudePrice(provider, model)
  }
  if (model && provider === 'openrouter') price = openRouterPrices?.[model] ?? null
  if (!price) return { costUsd: 0, source: 'unknown' }

  const usd =
    (tokens.input * price.input +
      tokens.cacheRead * price.cacheRead +
      tokens.cacheWrite * price.cacheWrite +
      tokens.output * price.output) /
    1_000_000
  return { costUsd: usd, source: 'pricing' }
}
