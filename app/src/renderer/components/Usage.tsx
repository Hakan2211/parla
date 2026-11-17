import { useEffect, useState } from 'react'
import type { OpenRouterKeyInfo, UsageSummary, UsageTotals } from '@shared/types'
import { formatMinutes, formatTokens, formatUsd } from '@/lib/format'

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

/** Compact live readout for the session controls. */
export function CostPill({ usage }: { usage: UsageTotals | null }): React.JSX.Element {
  if (!usage) {
    return <span className="font-mono text-[11px] text-ink-faint tabular-nums">$0</span>
  }
  return (
    <span className="font-mono text-[11px] text-ink-soft tabular-nums" title={tooltip(usage)}>
      {costLabel(usage)}
      <span className="text-ink-faint"> · {formatTokens(totalTokens(usage))} tok</span>
    </span>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): React.JSX.Element {
  return (
    <div title={hint}>
      <div className="text-[10px] tracking-[0.2em] text-ink-faint uppercase">{label}</div>
      <div className="font-mono text-sm text-ink tabular-nums">{value}</div>
    </div>
  )
}

/** Per-conversation stats row for the transcript header. */
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
    <div className="card-glass mt-5 flex flex-wrap gap-x-8 gap-y-3 rounded-xl px-5 py-3">
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
        hint="What Deepgram STT + ElevenLabs TTS would have charged for the same audio. Parla runs both locally for $0."
      />
    </div>
  )
}

function PeriodCard({ label, u }: { label: string; u: UsageTotals }): React.JSX.Element {
  return (
    <div className="card-glass rounded-xl px-4 py-3" title={tooltip(u)}>
      <div className="text-[10px] tracking-[0.2em] text-ink-faint uppercase">{label}</div>
      <div className="font-display text-2xl text-ink">{costLabel(u)}</div>
      <div className="mt-0.5 text-[11px] text-ink-soft">
        {formatTokens(totalTokens(u))} tokens · {formatMinutes(u.sttSeconds + u.ttsSeconds)} of voice
      </div>
    </div>
  )
}

/** Settings → Usage & cost. */
export function UsagePanel({ showOpenRouter }: { showOpenRouter: boolean }): React.JSX.Element {
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [key, setKey] = useState<OpenRouterKeyInfo | null | 'loading'>(null)
  const [keyError, setKeyError] = useState<string | null>(null)

  useEffect(() => {
    void window.parla.usage.summary().then(setSummary)
  }, [])

  const checkKey = (): void => {
    setKey('loading')
    setKeyError(null)
    window.parla.usage
      .openrouterKey()
      .then(setKey)
      .catch((e: unknown) => {
        setKey(null)
        setKeyError(e instanceof Error ? e.message.replace(/^Error invoking remote method[^:]*: /, '') : String(e))
      })
  }

  if (!summary) return <p className="text-xs text-ink-faint">Loading usage…</p>
  const all = summary.allTime

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PeriodCard label="Today" u={summary.today} />
        <PeriodCard label="7 days" u={summary.last7d} />
        <PeriodCard label="30 days" u={summary.last30d} />
        <PeriodCard label="All time" u={all} />
      </div>

      <p className="mt-3 text-xs text-ink-soft">
        Speech recognition and voice run on your GPU for $0. The same audio on cloud APIs would
        have cost about <span className="font-medium text-ink">{formatUsd(all.cloudVoiceEquivUsd)}</span>.
        {all.subscriptionCovered &&
          ' Claude amounts are API-equivalent: what the tokens would cost on the API. Your Claude subscription covers them.'}
      </p>

      {summary.byModel.length > 0 && (
        <table className="mt-4 w-full text-left text-xs">
          <thead className="text-[10px] tracking-[0.15em] text-ink-faint uppercase">
            <tr>
              <th className="py-1 font-normal">Model</th>
              <th className="py-1 font-normal">Sessions</th>
              <th className="py-1 font-normal">Tokens</th>
              <th className="py-1 text-right font-normal">Cost</th>
            </tr>
          </thead>
          <tbody className="text-ink-soft">
            {summary.byModel.map((m) => (
              <tr key={`${m.provider}/${m.model}`} className="border-t border-ink/8">
                <td className="py-1.5 font-mono text-ink">
                  <span className="text-ink-faint">{m.provider} · </span>
                  {m.model}
                </td>
                <td className="py-1.5">{m.sessions}</td>
                <td className="py-1.5 font-mono">{formatTokens(m.tokens)}</td>
                <td className="py-1.5 text-right font-mono">{formatUsd(m.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showOpenRouter && (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
          <button
            onClick={checkKey}
            className="rounded-lg border border-ink/15 px-3 py-1.5 text-ink-soft transition hover:border-ink/30"
          >
            {key === 'loading' ? 'Checking…' : 'Check OpenRouter key balance'}
          </button>
          {key && key !== 'loading' && (
            <span className="text-ink-soft">
              Key used <span className="font-mono text-ink">{formatUsd(key.usageUsd ?? 0)}</span>
              {key.limitRemainingUsd !== null && (
                <>
                  {' '}
                  · <span className="font-mono text-ink">{formatUsd(key.limitRemainingUsd)}</span> left
                  of {formatUsd(key.limitUsd ?? 0)} limit
                </>
              )}
              {key.limitUsd === null && ' · no spending limit set'}
            </span>
          )}
          {keyError && <span className="text-red-600">{keyError}</span>}
        </div>
      )}
    </div>
  )
}
