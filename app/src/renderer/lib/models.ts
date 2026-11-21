// Claude model catalog shared by the Settings picker and the Home quick switch.
// The Claude (subscription) provider takes CLI aliases; the Anthropic API
// provider takes full model ids. Prices are API list prices per 1M tokens.

export type ClaudeTier = 'opus' | 'sonnet' | 'haiku'

export interface ClaudeModel {
  tier: ClaudeTier
  label: string
  apiId: string
  blurb: string
  price: string
}

export const CLAUDE_MODELS: ClaudeModel[] = [
  { tier: 'opus', label: 'Opus 5.5', apiId: 'claude-opus-5-5', blurb: 'Deepest, most thoughtful', price: '$4 / $20' },
  { tier: 'sonnet', label: 'Sonnet 5.5', apiId: 'claude-sonnet-5-5', blurb: 'Balanced quality and speed', price: '$2 / $10' },
  { tier: 'haiku', label: 'Haiku 5.5', apiId: 'claude-haiku-5-5', blurb: 'Fastest replies, cheapest', price: '$0.10 / $0.50' }
]

/** Settings key + stored value for a tier under the given provider. */
export function modelSetting(
  provider: string,
  tier: ClaudeTier
): { key: 'llm.claude.model' | 'llm.anthropic.model'; value: string } | null {
  const m = CLAUDE_MODELS.find((x) => x.tier === tier)!
  if (provider === 'claude') return { key: 'llm.claude.model', value: m.tier }
  if (provider === 'anthropic') return { key: 'llm.anthropic.model', value: m.apiId }
  return null
}

/** Which tier a stored model value refers to (alias or full id), if any. */
export function tierOf(value: string | undefined | null): ClaudeTier | null {
  if (!value) return null
  const v = value.toLowerCase()
  return CLAUDE_MODELS.find((m) => v === m.tier || v === m.apiId || v.includes(m.tier))?.tier ?? null
}
