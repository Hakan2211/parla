import { useEffect, useState } from 'react'
import type { OpenRouterKeyInfo, UsageSummary, UsageTotals } from '@shared/types'
import { formatMinutes, formatTokens, formatUsd } from '@/lib/format'
import { Icon } from './ui'

function totalTokens(u: UsageTotals): number {
  return u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens + u.outputTokens
}

function costLabel(u: UsageTotals): string {
  if (u.hasUnpriced && u.costUsd === 0) return 'cost unknown'
  return (u.hasUnpriced ? '≥ ' : '') + formatUsd(u.costUsd)
}

function tooltip(u: UsageTotals): string {
  return [
    `LLM: ${u.inputTokens} in · ${u.cacheReadTokens} cached · ${u.cacheWriteTokens} cache-write · ${u.outputTokens} out`,
    `Voice: heard ${formatMinutes(u.sttSeconds)} · spoke ${formatMinutes(u.ttsSeconds)} (${u.ttsChars} chars) — local, $0`,
    `Same voice on cloud APIs ≈ ${formatUsd(u.cloudVoiceEquivUsd)}`,
    u.subscriptionCovered ? 'Claude cost is API-equivalent — covered by your Claude subscription.' : '',
    u.hasUnpriced ? 'Some usage could not be priced (unknown model).' : ''
  ]
    .filter(Boolean)
    .join('\n')
}

function hours(seconds: number): string {
  return seconds < 3600 ? formatMinutes(seconds) : `${(seconds / 3600).toFixed(1)} h`
}

/** Compact live readout for the session control capsule. */
export function CostPill({ usage }: { usage: UsageTotals | null }): React.JSX.Element {
  if (!usage) return <span className="font-mono text-[13px] text-ink-soft tabular-nums">$0 · 0 tok</span>
  return (
    <span className="font-mono text-[13px] text-ink tabular-nums" title={tooltip(usage)}>
      {costLabel(usage)}
      <span className="text-ink-soft"> · {formatTokens(totalTokens(usage))} tok</span>
    </span>
  )
}

function Stat({
  label,
  value,
  hint,
  icon
}: {
  label: string
  value: string
  hint?: string
  icon?: React.ReactNode
}): React.JSX.Element {
  return (
    <div title={hint} className="flex-1 px-5 py-3 text-center">
      <div className="text-[10px] font-semibold tracking-[0.2em] whitespace-nowrap text-ink-soft uppercase">
        {label}
      </div>
      <div className="mt-1 flex items-center justify-center gap-1.5 font-mono text-[19px] text-ink tabular-nums">
        {icon}
        {value}
      </div>
    </div>
  )
}

/** Per-conversation stats card for the transcript header. */
export function UsageStatsRow({
  chatId,
  durationS
}: {
  chatId: string
  durationS: number | null
}): React.JSX.Element | null {
  const [usage, setUsage] = useState<UsageTotals | null>(null)
  useEffect(() => {
    setUsage(null)
    void window.parla.usage.chat(chatId).then(setUsage)
  }, [chatId])
  if (!usage) return null
  return (
    <div className="card mt-6 flex divide-x divide-ink/8">
      {durationS !== null && <Stat label="Length" value={formatMinutes(durationS)} />}
      <Stat
        label={usage.subscriptionCovered ? 'Cost (API-equiv.)' : 'Cost'}
        value={costLabel(usage)}
        hint={tooltip(usage)}
      />
      <Stat label="Tokens" value={formatTokens(totalTokens(usage))} hint={tooltip(usage)} />
      <Stat label="You spoke" value={formatMinutes(usage.sttSeconds)} />
      <Stat
        label="Saved vs cloud voice"
        value={formatUsd(usage.cloudVoiceEquivUsd)}
        icon={<Icon name="leaf" size={17} className="text-ember" />}
        hint="What Deepgram STT + ElevenLabs TTS would have charged for the same audio. Parla runs both locally for $0."
      />
    </div>
  )
}

function PeriodCard({ label, u }: { label: string; u: UsageTotals }): React.JSX.Element {
  return (
    <div className="card px-5 py-4" title={tooltip(u)}>
      <div className="eyebrow">{label}</div>
      <div className="font-display mt-1 text-[32px] leading-tight text-ink">{costLabel(u)}</div>
      <div className="mt-0.5 text-[12px] text-ink-soft">
        {formatTokens(totalTokens(u))} tokens · {hours(u.sttSeconds + u.ttsSeconds)} of voice
      </div>
    </div>
  )
}

function niceMax(v: number): number {
  if (v <= 0) return 0.01
  const exp = Math.pow(10, Math.floor(Math.log10(v)))
  const m = v / exp
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10
  return nice * exp
}

function dayFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Single-series bar chart of daily spend, with an average reference line. */
function DailySpendChart({ daily }: { daily: UsageSummary['daily'] }): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  const W = 860
  const H = 150
  const pad = { l: 46, r: 8, t: 8, b: 22 }
  const plotW = W - pad.l - pad.r
  const plotH = H - pad.t - pad.b
  const max = niceMax(Math.max(...daily.map((d) => d.costUsd)))
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)
  const avg = daily.reduce((a, d) => a + d.costUsd, 0) / daily.length
  const slot = plotW / daily.length
  const barW = Math.max(slot - 8, 3)
  const y = (v: number): number => pad.t + plotH - (v / max) * plotH
  const fmtTick = (v: number): string => (max < 0.1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`)

  return (
    <div className="card relative px-5 pt-4 pb-3">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="eyebrow">Daily spend (last 30 days)</div>
        <div className="flex items-center gap-2 text-[11.5px] text-ink-soft">
          <svg width="22" height="2" aria-hidden>
            <line x1="0" y1="1" x2="22" y2="1" stroke="#6b675e" strokeWidth="1.5" strokeDasharray="2 3" />
          </svg>
          Average: {formatUsd(avg)}
        </div>
      </div>
      <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Daily spend, last 30 days">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="rgba(43,42,38,0.07)" />
            <text x={pad.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10.5" fill="#6b675e" className="tabular-nums">
              {fmtTick(t)}
            </text>
          </g>
        ))}
        {daily.map((d, i) => {
          const x = pad.l + i * slot + (slot - barW) / 2
          const h = Math.max((d.costUsd / max) * plotH, d.costUsd > 0 ? 2 : 0)
          const top = pad.t + plotH - h
          const r = Math.min(4, h, barW / 2)
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* hit target: full column */}
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={plotH} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${x},${pad.t + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${pad.t + plotH} Z`}
                  fill="#bf5f3d"
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
              {i % 3 === 0 && (
                <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize="10.5" fill="#6b675e">
                  {dayFromKey(d.day).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </text>
              )}
            </g>
          )
        })}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="rgba(43,42,38,0.25)" />
        {avg > 0 && (
          <line
            x1={pad.l}
            x2={W - pad.r}
            y1={y(avg)}
            y2={y(avg)}
            stroke="#6b675e"
            strokeWidth="1.2"
            strokeDasharray="2 3"
            pointerEvents="none"
          />
        )}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 -mt-2 -translate-x-1/2 -translate-y-full rounded-lg border border-ink/10 bg-white px-2.5 py-1.5 text-[12px] whitespace-nowrap shadow-md"
          style={{ left: `${((pad.l + (hover + 0.5) * slot) / W) * 100}%`, top: `${(y(daily[hover].costUsd) / H) * 100}%` }}
        >
          <span className="text-ink-soft">
            {dayFromKey(daily[hover].day).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>{' '}
          <span className="font-mono text-ink">{formatUsd(daily[hover].costUsd)}</span>
        </div>
      )}
      </div>
      <table className="sr-only">
        <caption>Daily spend</caption>
        <tbody>
          {daily.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td>{formatUsd(d.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OpenRouterKeyCard(): React.JSX.Element {
  const [key, setKey] = useState<OpenRouterKeyInfo | null | 'loading'>('loading')
  const [error, setError] = useState<string | null>(null)
  const check = (): void => {
    setKey('loading')
    setError(null)
    window.parla.usage
      .openrouterKey()
      .then(setKey)
      .catch((e: unknown) => {
        setKey(null)
        setError(e instanceof Error ? e.message.replace(/^Error invoking remote method[^:]*: /, '') : String(e))
      })
  }
  useEffect(check, [])

  const info = key !== 'loading' ? key : null
  const fraction =
    info?.limitUsd && info.usageUsd !== null ? Math.min(info.usageUsd / info.limitUsd, 1) : null

  return (
    <div className="card flex items-center gap-6 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="eyebrow">OpenRouter API key</div>
        <div className="mt-1 flex items-center gap-3">
          <span className="font-display text-[20px] text-ink">{info?.label ?? 'Saved key'}</span>
          {key === 'loading' ? (
            <span className="chip">Checking…</span>
          ) : info ? (
            <span className="chip !bg-emerald-50 !text-emerald-800">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" /> Connected
            </span>
          ) : (
            <span className="chip !bg-red-50 !text-red-700">{error ?? 'Not connected'}</span>
          )}
        </div>
        {info && (
          <p className="mt-1 text-[12.5px] text-ink-soft">
            Key used {formatUsd(info.usageUsd ?? 0)}
            {info.limitRemainingUsd !== null && info.limitUsd !== null
              ? ` · ${formatUsd(info.limitRemainingUsd)} left of ${formatUsd(info.limitUsd)} limit`
              : ' · no spending limit set'}
          </p>
        )}
        {fraction !== null && (
          <div className="mt-2.5 h-1.5 w-full max-w-xl overflow-hidden rounded-full bg-ink/8">
            <div className="h-full rounded-full bg-ember" style={{ width: `${fraction * 100}%` }} />
          </div>
        )}
      </div>
      <button onClick={check} className="btn-quiet">
        Refresh balance
      </button>
    </div>
  )
}

/** Settings → Usage & cost. */
export function UsagePanel({ showOpenRouter }: { showOpenRouter: boolean }): React.JSX.Element {
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  useEffect(() => {
    void window.parla.usage.summary().then(setSummary)
  }, [])

  if (!summary) return <p className="text-sm text-ink-faint">Loading usage…</p>
  const all = summary.allTime

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <PeriodCard label="Today" u={summary.today} />
        <PeriodCard label="7 days" u={summary.last7d} />
        <PeriodCard label="30 days" u={summary.last30d} />
        <PeriodCard label="All time" u={all} />
      </div>

      <p className="text-[13px] text-ink-soft">
        Speech recognition and voice run on your GPU for $0. The same audio on cloud APIs would have
        cost about <span className="font-medium text-ink">{formatUsd(all.cloudVoiceEquivUsd)}</span>.
        {all.subscriptionCovered &&
          ' Claude amounts are API-equivalent: what the tokens would cost on the API. Your Claude subscription covers them.'}
      </p>

      <DailySpendChart daily={summary.daily} />

      {summary.byModel.length > 0 && (
        <div className="card px-5 pt-4 pb-2">
          <div className="eyebrow mb-2">By model</div>
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="bg-ink/[0.03] text-ink">
                <th className="rounded-l-md px-2 py-1.5 font-medium">Model</th>
                <th className="px-2 py-1.5 text-right font-medium">Sessions</th>
                <th className="px-2 py-1.5 text-right font-medium">Tokens</th>
                <th className="rounded-r-md px-2 py-1.5 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="text-ink">
              {summary.byModel.map((m) => (
                <tr key={`${m.provider}/${m.model}`} className="border-t border-ink/6">
                  <td className="px-2 py-2 font-mono text-[12.5px]">
                    {m.provider} · {m.model}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{m.sessions}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatTokens(m.tokens)}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">{formatUsd(m.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showOpenRouter && <OpenRouterKeyCard />}
    </div>
  )
}
