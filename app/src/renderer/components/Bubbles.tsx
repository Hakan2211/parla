// Live-panel transcript bubbles: you on the right in warm sand, the persona on
// the left in light stone; a small mono "Speaker · time" label inside.

export function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function Bubble({
  role,
  speaker,
  time,
  streaming,
  children
}: {
  role: 'user' | 'assistant'
  speaker: string
  time?: string
  streaming?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const isUser = role === 'user'
  return (
    <div className={'mb-3.5 flex ' + (isUser ? 'justify-end pl-8' : 'justify-start pr-8')}>
      <div
        className={
          'rounded-2xl px-4 pt-2 pb-3 shadow-[0_6px_18px_-12px_rgba(43,42,38,0.3)] ' +
          (isUser ? 'rounded-tr-md bg-bubble-user' : 'rounded-tl-md bg-bubble-ai')
        }
      >
        <div className={'mb-1 font-mono text-[10.5px] text-ink-soft ' + (isUser ? 'text-right' : '')}>
          {speaker}
          {time && ` · ${time}`}
        </div>
        <div className={'font-display text-[15.5px] leading-[1.45] text-ink ' + (streaming ? 'caret' : '')}>
          {children}
        </div>
      </div>
    </div>
  )
}
