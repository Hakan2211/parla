import { useParlaStore } from '@/state/store'

function p50(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const STAGES: { key: keyof StageRow; label: string }[] = [
  { key: 'eotMs', label: 'end of turn' },
  { key: 'sttMs', label: 'stt' },
  { key: 'llmTtftMs', label: 'llm first token' },
  { key: 'ttsTtfbMs', label: 'tts first audio' },
  { key: 'voiceToVoiceMs', label: 'voice → voice' }
]

interface StageRow {
  eotMs: number
  sttMs: number
  llmTtftMs: number
  ttsTtfbMs: number
  voiceToVoiceMs: number
}

export default function LatencyHUD(): React.JSX.Element | null {
  const metrics = useParlaStore((s) => s.turnMetrics)
  if (metrics.length === 0) return null
  const last = metrics[metrics.length - 1]

  return (
    <div className="card-glass pointer-events-none absolute top-4 left-4 rounded-xl p-3 font-mono text-[11px] leading-relaxed text-ink-soft">
      <div className="mb-1 text-[10px] tracking-widest text-ink-faint uppercase">
        latency · turn {metrics.length}
      </div>
      {STAGES.map(({ key, label }) => {
        const median = p50(metrics.map((m) => m[key]))
        const isTotal = key === 'voiceToVoiceMs'
        const value = last[key]
        return (
          <div key={key} className={'flex justify-between gap-6 ' + (isTotal ? 'mt-1 border-t border-ink/10 pt-1' : '')}>
            <span className={isTotal ? 'text-ink' : ''}>{label}</span>
            <span>
              <span className={isTotal && value > 1000 ? 'text-amber-600' : 'text-ink'}>
                {value}ms
              </span>
              {median !== null && metrics.length > 1 && (
                <span className="text-ink-faint"> · p50 {median}ms</span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
