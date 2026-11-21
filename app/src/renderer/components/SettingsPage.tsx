import { useEffect, useRef, useState } from 'react'
import type { LLMProvider, LocalStatus } from '@shared/types'
import { CLAUDE_MODELS, modelSetting, tierOf } from '@/lib/models'
import { useParlaStore } from '@/state/store'
import { Icon, Segmented, Toggle, VOICES, VoiceAvatar, useVoicePreview } from './ui'
import { UsagePanel } from './Usage'
import { openMic } from '@/voice/client'

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
  'audio.inputDeviceId': string
  'studio.enabled': boolean
  'studio.url': string
  'studio.token': string
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
  'tts.engine': 'kokoro',
  'audio.inputDeviceId': '',
  'studio.enabled': true,
  'studio.url': '',
  'studio.token': ''
}


const PROVIDER_ORDER: LLMProvider[] = ['claude', 'anthropic', 'openrouter', 'lmstudio']

const PROVIDER_INFO: Record<
  LLMProvider,
  { label: string; tagline: string; icon: 'spark' | 'key' | 'cloud' | 'monitor'; chips: string[]; note: string }
> = {
  claude: {
    label: 'Claude',
    tagline: 'Best conversation quality',
    icon: 'spark',
    chips: ['Uses your Claude login', 'API-equiv. pricing'],
    note: 'Uses your Claude subscription via the Claude Code login. Best conversation quality, noticeably higher latency — quality mode.'
  },
  anthropic: {
    label: 'Anthropic API',
    tagline: 'Claude with your own key',
    icon: 'key',
    chips: ['Prompt caching', 'Pay-as-you-go'],
    note: 'Claude directly with your API key — no Claude Code subprocess, real prompt caching, exact per-turn billing.'
  },
  openrouter: {
    label: 'OpenRouter',
    tagline: 'Fastest cloud',
    icon: 'cloud',
    chips: ['~0.3s first token', 'API key'],
    note: 'Fastest first token (~300ms). Needs an API key from openrouter.ai — costs pennies per conversation.'
  },
  lmstudio: {
    label: 'Local',
    tagline: 'Private, runs on your GPU',
    icon: 'monitor',
    chips: ['$0', 'Offline'],
    note: 'Runs on your GPU through LM Studio — nothing leaves this computer, $0 per turn (~0.8s voice-to-voice with Gemma 4). Parla starts LM Studio and loads the model for you.'
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
      <span className="eyebrow mb-1.5 block">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="field"
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
        <span className="eyebrow mb-1.5 block">Model (downloaded in LM Studio)</span>
        <select
          value={selected}
          onChange={(e) => onModel(e.target.value)}
          className="field"
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
            className="btn-quiet"
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

function ModelPicker({
  provider,
  value,
  onPick
}: {
  provider: 'claude' | 'anthropic'
  value: string
  onPick: (key: 'llm.claude.model' | 'llm.anthropic.model', value: string) => void
}): React.JSX.Element {
  const current = tierOf(value)
  return (
    <div>
      <span className="eyebrow mb-2 block">Model</span>
      <div className="grid grid-cols-3 gap-3">
        {CLAUDE_MODELS.map((m) => {
          const selected = current === m.tier
          return (
            <button
              key={m.tier}
              aria-pressed={selected}
              onClick={() => {
                const s = modelSetting(provider, m.tier)!
                onPick(s.key, s.value)
              }}
              className={
                'rounded-2xl border px-4 py-3 text-left transition ' +
                (selected ? 'border-ember bg-ember-wash/60' : 'border-ink/10 bg-white/50 hover:bg-white/85')
              }
            >
              <div className="flex items-center justify-between">
                <span className="font-display text-[20px] text-ink">{m.label}</span>
                {selected && <Icon name="check" size={16} strokeWidth={2} className="text-ember" />}
              </div>
              <div className="mt-0.5 text-[12.5px] text-ink-soft">{m.blurb}</div>
              <div className="mt-1.5 font-mono text-[11px] text-ink-faint">
                {m.price} per 1M tok{provider === 'claude' ? ' · API-equiv.' : ''}
              </div>
            </button>
          )
        })}
      </div>
      {current === null && value && (
        <p className="mt-2 text-[12px] text-ink-soft">
          Currently using a custom model: <span className="font-mono">{value}</span>
        </p>
      )}
    </div>
  )
}

/** Studio connection: Studio's MCP endpoint and its token (Studio › Settings). */
function StudioSettings({
  settings,
  update,
  hasToken,
  setHasToken
}: {
  settings: SettingsState
  update: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void
  hasToken: boolean
  setHasToken: (v: boolean) => void
}): React.JSX.Element {
  const [check, setCheck] = useState<{ ok: boolean; detail: string } | 'checking' | null>(null)
  const refreshProjects = useParlaStore((s) => s.refreshStudioProjects)
  const test = (): void => {
    setCheck('checking')
    void window.parla.studio.test().then((r) => {
      setCheck(r)
      void refreshProjects()
    })
  }
  return (
    <div className="card space-y-4 px-6 py-5">
      <div className="flex items-start justify-between gap-6">
        <p className="text-[13.5px] leading-relaxed text-ink-soft">
          Talk a video or article through with the Producer, and what comes out of it (ideas, the
          angle, key points, open questions, your best lines) lands in Studio’s Inbox to accept or
          reject. Studio is only asked before a conversation (the project’s brief) and after it,
          never while you talk.
        </p>
        <Toggle
          checked={settings['studio.enabled']}
          onChange={(v) => {
            update('studio.enabled', v)
            setCheck(null)
            setTimeout(() => void refreshProjects(), 50)
          }}
          label="Connect to Studio"
        />
      </div>
      {settings['studio.enabled'] && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Token (from Studio › Settings)"
              type="password"
              placeholder={hasToken ? '•••••••• saved — paste to replace' : 'Paste the token or the whole claude mcp add command'}
              value={settings['studio.token']}
              onChange={(v) => {
                update('studio.token', v)
                setHasToken(v.trim() !== '')
                setCheck(null)
              }}
            />
            <Field
              label="Address"
              placeholder="http://127.0.0.1:47825/mcp"
              value={settings['studio.url']}
              onChange={(v) => {
                update('studio.url', v)
                setCheck(null)
              }}
            />
          </div>
          <div className="flex items-center gap-3 text-[13px]">
            <button onClick={test} className="btn-quiet">
              {check === 'checking' ? 'Testing…' : 'Test'}
            </button>
            {check && check !== 'checking' && (
              <span className={check.ok ? 'text-emerald-700' : 'text-red-700'}>{check.detail}</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-4 flex items-center gap-4">
      <h3 className="text-[11px] font-semibold tracking-[0.32em] text-ink uppercase">{children}</h3>
      <span className="h-px flex-1 bg-ink/8" />
    </div>
  )
}

function ProviderCard({
  provider,
  selected,
  onSelect
}: {
  provider: LLMProvider
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const info = PROVIDER_INFO[provider]
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={
        'card relative flex flex-col items-start px-5 pt-5 pb-4 text-left transition ' +
        (selected ? '!border-ember ring-1 ring-ember' : 'hover:bg-white/80')
      }
    >
      {selected && (
        <span className="absolute top-4 right-4 flex h-6 w-6 items-center justify-center rounded-full bg-ember text-white">
          <Icon name="check" size={14} strokeWidth={2.2} />
        </span>
      )}
      <div className="flex items-center gap-3">
        <Icon name={info.icon} size={24} className={selected ? 'text-ember' : 'text-ink'} strokeWidth={1.4} />
        <span className="font-display text-[24px] leading-none text-ink">{info.label}</span>
      </div>
      <p className="mt-1.5 text-[13.5px] text-ink-soft">{info.tagline}</p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {info.chips.map((c) => (
          <span key={c} className="chip">
            {c}
          </span>
        ))}
      </div>
    </button>
  )
}

function VoiceGallery(): React.JSX.Element {
  const preview = useVoicePreview()
  const [page, setPage] = useState(0)
  const perPage = 4
  const pages = Math.ceil(VOICES.length / perPage)
  const shown = VOICES.slice(page * perPage, page * perPage + perPage)
  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          aria-label="Previous voices"
          className="card flex h-9 w-9 flex-shrink-0 items-center justify-center !rounded-full disabled:opacity-30"
        >
          <Icon name="chevron-left" size={16} />
        </button>
        <div className="grid flex-1 grid-cols-2 gap-3 xl:grid-cols-4">
          {shown.map((v) => {
            const playing = preview.playing === v.id
            return (
              <div key={v.id} className="card flex items-center gap-3 px-3 py-3">
                <VoiceAvatar seed={v.id} size={52} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-display truncate text-[19px] text-ink">{v.name}</span>
                    <span className="chip !px-1.5 !py-0 !text-[10px]">{v.accent}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2.5">
                    <button
                      onClick={() => preview.toggle(v.id)}
                      aria-label={`${playing ? 'Stop' : 'Play'} ${v.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-full border-[1.5px] border-ember text-ember transition hover:bg-ember hover:text-white"
                    >
                      <Icon
                        name={playing ? 'pause' : 'play'}
                        size={11}
                        strokeWidth={2.2}
                        className={preview.loading === v.id ? 'animate-pulse' : ''}
                      />
                    </button>
                    <span className="flex h-4 items-center gap-[2px]" aria-hidden>
                      {[5, 9, 6, 12, 8, 14, 7, 10, 5, 11, 6, 8].map((h, i) => (
                        <span
                          key={i}
                          className={'w-[2px] rounded-full ' + (playing ? 'animate-pulse bg-ember' : 'bg-ink/35')}
                          style={{ height: h, animationDelay: `${i * 80}ms` }}
                        />
                      ))}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <button
          onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
          disabled={page >= pages - 1}
          aria-label="More voices"
          className="card flex h-9 w-9 flex-shrink-0 items-center justify-center !rounded-full disabled:opacity-30"
        >
          <Icon name="chevron-right" size={16} />
        </button>
      </div>
      <p className="mt-3 text-[12.5px] text-ink-soft">
        {preview.error ?? 'Each persona picks its own voice. Choose one under Personas.'}
      </p>
    </div>
  )
}

/** Mic chooser with a live input meter, so a muted or low-gain input is obvious. */
function MicPicker({ value, onChange }: { value: string; onChange: (id: string) => void }): React.JSX.Element {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [defaultLabel, setDefaultLabel] = useState('')
  const [db, setDb] = useState(-100)
  const [error, setError] = useState<string | null>(null)
  const peakRef = useRef(-100)

  const refresh = (): void => {
    void navigator.mediaDevices.enumerateDevices().then((all) => {
      const inputs = all.filter((d) => d.kind === 'audioinput')
      // Chromium adds 'default'/'communications' aliases; show real devices only.
      setDefaultLabel(inputs.find((d) => d.deviceId === 'default')?.label.replace(/^Default - /, '') ?? '')
      setDevices(inputs.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications'))
    })
  }

  useEffect(() => {
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    refresh()
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [])

  useEffect(() => {
    let stopped = false
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let raf = 0
    setError(null)
    openMic(value)
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop())
        stream = s
        // Labels are only exposed once mic access was granted.
        refresh()
        ctx = new AudioContext()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 2048
        ctx.createMediaStreamSource(s).connect(analyser)
        const buf = new Float32Array(analyser.fftSize)
        const tick = (): void => {
          analyser.getFloatTimeDomainData(buf)
          let sum = 0
          for (const v of buf) sum += v * v
          const level = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-5)
          // Fast attack, slow release so speech is readable.
          peakRef.current = Math.max(level, peakRef.current - 1.2)
          setDb(peakRef.current)
          raf = requestAnimationFrame(tick)
        }
        tick()
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close()
    }
  }, [value])

  const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100))
  const known = value === '' || devices.some((d) => d.deviceId === value)
  return (
    <div className="flex flex-col gap-3">
      <select value={known ? value : ''} onChange={(e) => onChange(e.target.value)} className="field max-w-[520px]">
        <option value="">System default{defaultLabel ? ` (${defaultLabel})` : ''}</option>
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Microphone ${i + 1}`}
          </option>
        ))}
      </select>
      <div className="flex max-w-[520px] items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/8">
          <div
            className={`h-full rounded-full transition-[width] duration-75 ${db > -45 ? 'bg-emerald-600' : 'bg-ember'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-16 text-right text-[12px] tabular-nums text-ink-soft">
          {db <= -99 ? '—' : `${Math.round(db)} dB`}
        </span>
      </div>
      <p className="text-[12.5px] text-ink-soft">
        {error
          ? `Can’t open this microphone: ${error}`
          : 'Speak normally — the bar should turn green. If it barely moves, raise the input gain on your interface or pick another device. Parla uses the first channel (Input 1).'}
      </p>
    </div>
  )
}

export default function SettingsPage(): React.JSX.Element {
  const [tab, setTab] = useState<'general' | 'usage'>('general')
  const [settings, setSettings] = useState<SettingsState>(DEFAULTS)
  const [saved, setSaved] = useState(false)
  const [hasStoredKey, setHasStoredKey] = useState(false)
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false)
  const [hasStudioToken, setHasStudioToken] = useState(false)
  const [check, setCheck] = useState<{ ok: boolean; detail: string } | 'checking' | null>(null)

  useEffect(() => {
    void window.parla.settings.all().then((all) => {
      setHasStoredKey(Boolean(all['llm.openrouter.hasKey']))
      setHasAnthropicKey(Boolean(all['llm.anthropic.hasKey']))
      setHasStudioToken(Boolean(all['studio.hasToken']))
      delete all['llm.openrouter.hasKey']
      delete all['llm.anthropic.hasKey']
      delete all['studio.hasToken']
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
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1080px] px-10 pt-10 pb-16">
        <header className="mb-8 flex items-end justify-between gap-6">
          <div>
            <p className="eyebrow mb-1.5">{tab === 'usage' ? 'Settings' : 'Changes apply to the next conversation'}</p>
            <h1 className="font-display text-[44px] leading-[1.05] text-ink">
              {tab === 'usage' ? 'Usage & cost' : 'Settings'}
              {saved && <span className="ml-4 align-middle text-[13px] font-normal text-emerald-700">Saved</span>}
            </h1>
          </div>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'general', label: 'Preferences' },
              { value: 'usage', label: 'Usage & cost' }
            ]}
          />
        </header>

        {tab === 'usage' ? (
          <UsagePanel showOpenRouter={provider === 'openrouter' || hasStoredKey} />
        ) : (
          <>
            <section className="mb-10">
              <SectionLabel>AI provider</SectionLabel>
              <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                {PROVIDER_ORDER.map((p) => (
                  <ProviderCard
                    key={p}
                    provider={p}
                    selected={provider === p}
                    onSelect={() => update('llm.provider', p)}
                  />
                ))}
              </div>

              <div className="card mt-4 space-y-4 px-6 py-5">
                <p className="text-[13.5px] leading-relaxed text-ink-soft">{PROVIDER_INFO[provider].note}</p>
                {provider === 'openrouter' && (
                  <div className="grid grid-cols-2 gap-4">
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
                  </div>
                )}
                {provider === 'lmstudio' && (
                  <LocalModelSettings
                    model={settings['llm.lmstudio.model']}
                    onModel={(m) => update('llm.lmstudio.model', m)}
                  />
                )}
                {provider === 'anthropic' && (
                  <>
                    <ModelPicker
                      provider="anthropic"
                      value={settings['llm.anthropic.model']}
                      onPick={(key, value) => {
                        update(key, value)
                        setCheck(null)
                      }}
                    />
                    <div>
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
                    </div>
                    <div className="flex flex-wrap items-center gap-6">
                      <div>
                        <span className="eyebrow mb-1.5 block">Thinking effort (lower = faster replies)</span>
                        <div className="flex gap-2">
                          {(['low', 'medium', 'high'] as const).map((e) => (
                            <button
                              key={e}
                              onClick={() => update('llm.anthropic.effort', e)}
                              className={
                                'rounded-full border px-4 py-1.5 text-[13px] capitalize transition ' +
                                (settings['llm.anthropic.effort'] === e
                                  ? 'border-ember bg-ember text-white'
                                  : 'border-ink/12 bg-white/50 text-ink-soft hover:text-ink')
                              }
                            >
                              {e}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 self-end text-[13px]">
                        <button
                          onClick={() => {
                            setCheck('checking')
                            void window.parla.llm.check().then(setCheck)
                          }}
                          className="btn-quiet"
                        >
                          {check === 'checking' ? 'Testing…' : 'Test key'}
                        </button>
                        {check && check !== 'checking' && (
                          <span className={check.ok ? 'text-emerald-700' : 'text-red-700'}>{check.detail}</span>
                        )}
                      </div>
                    </div>
                  </>
                )}
                {provider === 'claude' && (
                  <ModelPicker
                    provider="claude"
                    value={settings['llm.claude.model']}
                    onPick={(key, value) => update(key, value)}
                  />
                )}
              </div>
            </section>

            <section className="mb-10">
              <SectionLabel>Voices</SectionLabel>
              <VoiceGallery />
            </section>

            <section className="mb-10">
              <SectionLabel>Voice engine</SectionLabel>
              <Segmented
                value={settings['tts.engine']}
                onChange={(v) => update('tts.engine', v)}
                options={[
                  { value: 'kokoro', label: 'Kokoro (fastest)' },
                  { value: 'fish', label: 'Fish s2-pro (richer)' }
                ]}
              />
              <p className="mt-3 text-[12.5px] text-ink-soft">
                Fish s2-pro needs the fish-speech server running on this machine. Parla falls back to
                Kokoro when it isn’t available.
              </p>
            </section>

            <section className="mb-10">
              <SectionLabel>Microphone</SectionLabel>
              <MicPicker value={settings['audio.inputDeviceId']} onChange={(id) => update('audio.inputDeviceId', id)} />
            </section>

            <section className="mb-10">
              <SectionLabel>Studio</SectionLabel>
              <StudioSettings
                settings={settings}
                update={update}
                hasToken={hasStudioToken}
                setHasToken={setHasStudioToken}
              />
            </section>

            <section>
              <SectionLabel>Speech recognition</SectionLabel>
              <div className="flex items-center gap-4">
                <span className="rounded-full bg-ember px-6 py-2 text-sm text-white">English (Parakeet)</span>
                <p className="text-[12.5px] text-ink-soft">
                  Runs on this computer. Everything you say is transcribed locally.
                </p>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
