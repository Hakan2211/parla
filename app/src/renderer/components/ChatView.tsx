import { useParlaStore } from '@/state/store'
import type { TurnMetrics } from '@shared/types'
import { Bubble, timeLabel } from './Bubbles'
import { UsageStatsRow } from './Usage'

function MetricsBadge({ metrics }: { metrics: TurnMetrics }): React.JSX.Element {
  return (
    <span
      className="ml-2 text-[10px] text-ink-faint"
      title={`eot ${metrics.eotMs}ms · stt ${metrics.sttMs}ms · llm ${metrics.llmTtftMs}ms · tts ${metrics.ttsTtfbMs}ms`}
    >
      {metrics.voiceToVoiceMs}ms
    </span>
  )
}

export default function ChatView({ chatId }: { chatId: string }): React.JSX.Element {
  const chats = useParlaStore((s) => s.chats)
  const messages = useParlaStore((s) => s.chatMessages)
  const personas = useParlaStore((s) => s.personas)
  const chat = chats.find((c) => c.id === chatId)
  const personaName = personas.find((p) => p.id === chat?.personaId)?.name ?? 'Parla'

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-10">
        <header className="mb-8">
          <p className="mb-2 text-[11px] font-semibold tracking-[0.3em] text-ink-faint uppercase">
            {chat &&
              new Date(chat.startedAt).toLocaleDateString([], {
                month: 'long',
                day: 'numeric',
                year: 'numeric'
              })}
            {chat && ' · '}
            {chat && timeLabel(chat.startedAt)}
          </p>
          <h2 className="font-display text-4xl text-ink">{chat?.title ?? 'Conversation'}</h2>
          {chat?.summary && (
            <p className="mt-3 font-display text-sm leading-relaxed text-ink-soft italic">
              {chat.summary}
            </p>
          )}
          <UsageStatsRow
            chatId={chatId}
            durationS={chat?.endedAt ? (chat.endedAt - chat.startedAt) / 1000 : null}
          />
          <div className="mt-5 flex w-48 items-center gap-3">
            <span className="h-px flex-1 bg-ink/10" />
            <span className="text-ember/60">◆</span>
            <span className="h-px flex-1 bg-ink/10" />
          </div>
        </header>

        {messages.length === 0 && (
          <p className="font-display text-sm text-ink-faint italic">No transcript recorded.</p>
        )}
        {messages.map((m) => (
          <Bubble
            key={m.id}
            role={m.role}
            speaker={m.role === 'user' ? 'You' : personaName}
            time={timeLabel(m.createdAt)}
          >
            {m.content}
            {m.interrupted && (
              <span className="ml-1 text-xs text-ink-faint italic">— interrupted</span>
            )}
            {m.role === 'assistant' && m.metrics && <MetricsBadge metrics={m.metrics} />}
          </Bubble>
        ))}
      </div>
    </div>
  )
}
