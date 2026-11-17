// C-style transcript entries: small-caps speaker label + time, then a soft
// rounded bubble. Used by the live session panel and the chat archive.

export function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function Bubble({
  role,
  speaker,
  time,
  children
}: {
  role: 'user' | 'assistant'
  speaker: string
  time?: string
  children: React.ReactNode
}): React.JSX.Element {
  const isUser = role === 'user'
  return (
    <div className="mb-4">
      <div className="mb-1 flex items-baseline gap-2 px-1">
        <span className="text-[10px] font-semibold tracking-[0.18em] text-ink-faint uppercase">
          {speaker}
        </span>
        {time && <span className="text-[10px] text-ink-faint/80">{time}</span>}
      </div>
      <div
        className={
          'rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed text-ink ' +
          (isUser
            ? 'border-[#e5d9bf] bg-bubble-user'
            : 'border-ink/5 bg-bubble-ai')
        }
      >
        {children}
      </div>
    </div>
  )
}
