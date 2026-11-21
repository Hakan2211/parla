import { useParlaStore } from '@/state/store'
import type { TurnMetrics } from '@shared/types'

function p50(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const STAGES: { key: keyof TurnMetrics; label: string }[] = [
  { key: 'eotMs', label: 'end of turn' },
  { key: 'sttMs', label: 'stt' },
  { key: 'llmTtftMs', label: 'llm first token' },
  { key: 'ttsTtfbMs', label: 'tts first audio' }
]

/** Compact frosted chip "voice → voice 640ms · p50 702ms"; hover for stages. */
export default function LatencyHUD(): React.JSX.Element | null {
  const metrics = useParlaStore((s) => s.turnMetrics)
  if (metrics.length === 0) return null
  const last = metrics[metrics.length - 1]
  const median = p50(metrics.map((m) => m.voiceToVoiceMs))

  return (
    <div className="group card-glass absolute top-5 left-6 z-10 rounded-xl px-3 py-1.5 font-mono text-[11.5px] text-ink">
      <span>
        voice → voice{' '}
        <span className={last.voiceToVoiceMs > 1000 ? 'text-amber-700' : ''}>{last.voiceToVoiceMs}ms</span>
        {metrics.length > 1 && median !== null && <span className="text-ink-soft"> · p50 {median}ms</span>}
      </span>
      <div className="hidden pt-1.5 pb-0.5 text-[11px] leading-relaxed text-ink-soft group-hover:block">
        {STAGES.map(({ key, label }) => (
          <div key={key} className="flex justify-between gap-6">
            <span>{label}</span>
            <span className="text-ink">
              {last[key]}ms
              {metrics.length > 1 && (
                <span className="text-ink-faint"> · p50 {p50(metrics.map((m) => m[key]))}ms</span>
              )}
            </span>
          </div>
        ))}
        <div className="mt-1 text-ink-faint">turn {metrics.length}</div>
      </div>
    </div>
  )
}
