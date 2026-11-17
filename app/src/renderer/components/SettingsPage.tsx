import { useEffect, useState } from 'react'
import type { LLMProvider, LocalStatus } from '@shared/types'
import { UsagePanel } from './Usage'

interface SettingsState {
  'llm.provider': LLMProvider
  'llm.openrouter.apiKey': string
  'llm.openrouter.model': string
  'llm.lmstudio.baseUrl': string
  'llm.lmstudio.model': string
  'llm.claude.model': string
  'llm.anthropic.apiKey': string
  'llm.anthropic.model': string
  'llm.anthropic.effort': 'low' | 'medium' | 'high'
  'tts.engine': 'kokoro' | 'fish'
}

const DEFAULTS: SettingsState = {
  'llm.provider': 'claude',
  'llm.openrouter.apiKey': '',
  'llm.openrouter.model': 'google/gemini-2.5-flash',
  'llm.lmstudio.baseUrl': 'http://127.0.0.1:1234/v1',
  'llm.lmstudio.model': '',
  'llm.claude.model': 'sonnet',
  'llm.anthropic.apiKey': '',
  'llm.anthropic.model': 'claude-opus-5-5',
  'llm.anthropic.effort': 'low',
  'tts.engine': 'kokoro'
}

// Direct-API models (list prices per 1M tokens, in/out).
const ANTHROPIC_MODELS: { id: string; label: string; note: string }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Most capable · $4 / $20' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Balanced · $2 / $10' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest, cheapest · $0.10 / $0.50' }
]

const PROVIDER_INFO: Record<LLMProvider, { label: string; note: string }> = {
  openrouter: {
    label: 'OpenRouter',
    note: 'Fastest first token (~300ms). Needs an API key from openrouter.ai — costs pennies per conversation.'
  },
  lmstudio: {
    label: 'Local (private)',
    note: 'Runs on your GPU through LM Studio — nothing leaves this computer, $0 per turn. Fastest option measured (~0.8s voice-to-voice with Gemma 4). Parla starts LM Studio and loads the model for you.'
  },
  anthropic: {
    label: 'Anthropic API',
    note: 'Claude directly with your API key — no Claude Code subprocess, real prompt caching, exact per-turn billing. Pay-as-you-go.'
  },
  claude: {
    label: 'Claude (subscription)',
    note: 'Uses your Claude subscription via the Claude Code login. Best conversation quality, noticeably higher latency — quality mode.'
  }
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
}): React.JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-ink-soft">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-ink/15 bg-white/70 px-3 py-2 text-sm text-ink outline-none focus:border-ember/60"
      />
    </label>
  )
}

// Instruction-tuned models that answer quickly with thinking off. Others
// still work; these get a recommendation badge.
const RECOMMENDED_LOCAL = 'gemma-4-26b-a4b-it'

function LocalModelSettings({
  model,
  onModel
}: {
  model: string
  onModel: (m: string) => void
}): React.JSX.Element {
  const [status, setStatus] = useState<LocalStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const selected = model || RECOMMENDED_LOCAL

  useEffect(() => {
    let alive = true
    const poll = (): void => {
      void window.parla.local.status().then((s) => alive && setStatus(s))
    }
    poll()
    const t = setInterval(poll, 3000) // reflects loads started elsewhere
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  if (!status) return <p className="text-xs text-ink-faint">Checking LM Studio…</p>
  if (!status.available) {
    return (
      <p className="text-xs text-red-600">
        LM Studio isn't installed. Install it from lmstudio.ai and download a model (Gemma 4
        26B-A4B recommended for a 24 GB GPU).
      </p>
    )
  }

  const current = status.models.find((m) => m.key === selected)
  const loading = status.loading === selected
  return (
    <>
      <label className="block">
        <span className="mb-1 block text-xs text-ink-soft">Model (downloaded in LM Studio)</span>
        <select
          value={selected}
          onChange={(e) => onModel(e.target.value)}
          className="w-full rounded-lg border border-ink/15 bg-white/70 px-3 py-2 text-sm text-ink outline-none focus:border-ember/60"
        >
          {status.models.map((m) => (
            <option key={m.key} value={m.key}>
              {m.key} — {m.params ?? '?'} · {m.sizeGb.toFixed(1)} GB
              {m.key === RECOMMENDED_LOCAL ? ' · recommended' : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-3 text-xs">
        <span className="flex items-center gap-1.5 text-ink-soft">
          <span
            className={
              'h-2 w-2 rounded-full ' +
              (current?.loaded ? 'bg-emerald-500' : loading ? 'animate-pulse bg-ember' : 'bg-ink/20')
            }
          />
          {current?.loaded
            ? 'Loaded on the GPU — ready'
            : loading
              ? 'Loading onto the GPU… (1–2 minutes)'
              : status.serverUp
                ? 'Not loaded — loads when you start talking'
                : 'LM Studio server off — Parla starts it for you'}
        </span>
        {!current?.loaded && !loading && (
          <button
            onClick={() => {
              setLoadError(null)
              window.parla.local.load().catch((e: unknown) =>
                setLoadError(e instanceof Error ? e.message : String(e))
              )
              setStatus({ ...status, loading: selected })
            }}
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-ink-soft transition hover:border-ink/30"
          >
            Load now
          </button>
        )}
      </div>
      {loadError && <p className="text-xs text-red-600">{loadError}</p>}
      <p className="text-xs text-ink-faint">
        Thinking is switched off for local models — reasoning models otherwise think for seconds
        before every reply. Parla unloads the model when you quit, if it loaded it.
      </p>
    </>
  )
}

export default function SettingsPage(): React.JSX.Element {
  const [settings, setSettings] = useState<SettingsState>(DEFAULTS)
  const [saved, setSaved] = useState(false)
  const [hasStoredKey, setHasStoredKey] = useState(false)
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false)
  const [check, setCheck] = useState<{ ok: boolean; detail: string } | 'checking' | null>(null)

  useEffect(() => {
    void window.parla.settings.all().then((all) => {
      setHasStoredKey(Boolean(all['llm.openrouter.hasKey']))
      setHasAnthropicKey(Boolean(all['llm.anthropic.hasKey']))
      delete all['llm.openrouter.hasKey']
      delete all['llm.anthropic.hasKey']
      setSettings({ ...DEFAULTS, ...(all as Partial<SettingsState>) })
    })
  }, [])

  const update = <K extends keyof SettingsState>(key: K, value: SettingsState[K]): void => {
    setSettings((s) => ({ ...s, [key]: value }))
    void window.parla.settings.set(key, value).then(() => {
      setSaved(true)
      setTimeout(() => setSaved(false), 1200)
    })
  }

  const provider = settings['llm.provider']

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto max-w-xl">
        <h2 className="font-display mb-1 text-3xl text-ink">Settings</h2>
        <p className="mb-6 text-xs text-ink-soft">
          Changes apply to the next session.{' '}
          {saved && <span className="text-emerald-600">Saved.</span>}
        </p>

        <section className="mb-8">
          <h3 className="mb-3 text-sm font-medium text-ink">Usage &amp; cost</h3>
          <UsagePanel showOpenRouter={provider === 'openrouter' || hasStoredKey} />
        </section>

        <section className="mb-8">
          <h3 className="mb-3 text-sm font-medium text-ink">AI provider</h3>
          <div className="mb-3 flex flex-wrap gap-2">
            {(Object.keys(PROVIDER_INFO) as LLMProvider[]).map((p) => (
              <button
                key={p}
                onClick={() => update('llm.provider', p)}
                className={
                  'rounded-lg border px-4 py-2 text-sm transition ' +
                  (provider === p
                    ? 'border-ember/50 bg-ember/10 font-medium text-ember-deep'
                    : 'border-ink/15 text-ink-soft hover:border-ink/30')
                }
              >
                {PROVIDER_INFO[p].label}
              </button>
            ))}
          </div>
          <p className="mb-4 text-xs text-ink-soft">{PROVIDER_INFO[provider].note}</p>

          <div className="space-y-3">
            {provider === 'openrouter' && (
              <>
                <Field
                  label="API key"
                  type="password"
                  placeholder={hasStoredKey ? '•••••••• saved — type to replace' : 'sk-or-…'}
                  value={settings['llm.openrouter.apiKey']}
                  onChange={(v) => {
                    update('llm.openrouter.apiKey', v)
                    setHasStoredKey(false)
                  }}
                />
                <Field
                  label="Model"
                  value={settings['llm.openrouter.model']}
                  onChange={(v) => update('llm.openrouter.model', v)}
                />
              </>
            )}
            {provider === 'lmstudio' && (
              <LocalModelSettings
                model={settings['llm.lmstudio.model']}
                onModel={(m) => update('llm.lmstudio.model', m)}
              />
            )}
            {provider === 'anthropic' && (
              <>
                <Field
                  label="API key"
                  type="password"
                  placeholder={hasAnthropicKey ? '•••••••• saved — type to replace' : 'sk-ant-…'}
                  value={settings['llm.anthropic.apiKey']}
                  onChange={(v) => {
                    update('llm.anthropic.apiKey', v)
                    setHasAnthropicKey(false)
                    setCheck(null)
                  }}
                />
                <label className="block">
                  <span className="mb-1 block text-xs text-ink-soft">Model</span>
                  <select
                    value={settings['llm.anthropic.model']}
                    onChange={(e) => {
                      update('llm.anthropic.model', e.target.value)
                      setCheck(null)
                    }}
                    className="w-full rounded-lg border border-ink/15 bg-white/70 px-3 py-2 text-sm text-ink outline-none focus:border-ember/60"
                  >
                    {ANTHROPIC_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} — {m.note}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <span className="mb-1 block text-xs text-ink-soft">
                    Thinking effort (lower = faster replies)
                  </span>
                  <div className="flex gap-2">
                    {(['low', 'medium', 'high'] as const).map((e) => (
                      <button
                        key={e}
                        onClick={() => update('llm.anthropic.effort', e)}
                        className={
                          'rounded-lg border px-3 py-1.5 text-xs capitalize transition ' +
                          (settings['llm.anthropic.effort'] === e
                            ? 'border-ember/50 bg-ember/10 font-medium text-ember-deep'
                            : 'border-ink/15 text-ink-soft hover:border-ink/30')
                        }
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <button
                    onClick={() => {
                      setCheck('checking')
                      void window.parla.llm.check().then(setCheck)
                    }}
                    className="rounded-lg border border-ink/15 px-3 py-1.5 text-ink-soft transition hover:border-ink/30"
                  >
                    {check === 'checking' ? 'Testing…' : 'Test key'}
                  </button>
                  {check && check !== 'checking' && (
                    <span className={check.ok ? 'text-emerald-600' : 'text-red-600'}>
                      {check.detail}
                    </span>
                  )}
                </div>
              </>
            )}
            {provider === 'claude' && (
              <Field
                label="Model (sonnet, opus, haiku, or full model id)"
                value={settings['llm.claude.model']}
                onChange={(v) => update('llm.claude.model', v)}
              />
            )}
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-medium text-ink">Voice engine</h3>
          <div className="flex gap-2">
            {(['kokoro', 'fish'] as const).map((engine) => (
              <button
                key={engine}
                onClick={() => update('tts.engine', engine)}
                className={
                  'rounded-lg border px-4 py-2 text-sm transition ' +
                  (settings['tts.engine'] === engine
                    ? 'border-ember/50 bg-ember/10 font-medium text-ember-deep'
                    : 'border-ink/15 text-ink-soft hover:border-ink/30')
                }
              >
                {engine === 'kokoro' ? 'Kokoro (fast)' : 'Fish s2-pro (rich)'}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            Fish s2-pro requires the fish-speech server running on this machine; falls back to
            Kokoro when unavailable.
          </p>
        </section>
      </div>
    </div>
  )
}
