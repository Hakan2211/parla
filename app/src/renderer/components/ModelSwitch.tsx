// Small Opus / Sonnet / Haiku switch on the idle Home screen. Only shown for
// the two Claude providers; writes the same settings as Settings → AI provider.

import { useEffect, useState } from 'react'
import { CLAUDE_MODELS, modelSetting, tierOf, type ClaudeTier } from '@/lib/models'
import { useParlaStore } from '@/state/store'

export default function ModelSwitch(): React.JSX.Element | null {
  const connection = useParlaStore((s) => s.connection)
  const [provider, setProvider] = useState<string | null>(null)
  const [tier, setTier] = useState<ClaudeTier | null>(null)

  useEffect(() => {
    void window.parla.settings.all().then((all) => {
      const p = String(all['llm.provider'] ?? 'claude')
      setProvider(p)
      const stored =
        p === 'anthropic'
          ? String(all['llm.anthropic.model'] ?? 'claude-opus-5-5')
          : String(all['llm.claude.model'] ?? 'sonnet')
      setTier(tierOf(stored))
    })
  }, [])

  if (provider !== 'claude' && provider !== 'anthropic') return null

  const pick = (t: ClaudeTier): void => {
    const s = modelSetting(provider, t)
    if (!s) return
    setTier(t)
    void window.parla.settings.set(s.key, s.value)
  }

  return (
    <div className="flex items-center gap-1 rounded-full bg-white/45 p-1 text-[12.5px]" role="radiogroup" aria-label="Claude model">
      {CLAUDE_MODELS.map((m) => (
        <button
          key={m.tier}
          role="radio"
          aria-checked={tier === m.tier}
          disabled={connection !== 'disconnected'}
          onClick={() => pick(m.tier)}
          title={`${m.label} — ${m.blurb}`}
          className={
            'rounded-full px-3.5 py-1 transition disabled:opacity-40 ' +
            (tier === m.tier ? 'bg-white text-ink shadow-sm' : 'text-ink-soft hover:text-ink')
          }
        >
          {m.label.split(' ')[0]}
        </button>
      ))}
    </div>
  )
}
