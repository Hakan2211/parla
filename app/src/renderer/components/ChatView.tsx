import { useParlaStore } from '@/state/store'
import type { Chat, TurnMetrics } from '@shared/types'
import { timeLabel } from './Bubbles'
import { Icon } from './ui'
import { UsageStatsRow } from './Usage'

function MetricsBadge({ metrics }: { metrics: TurnMetrics }): React.JSX.Element {
  return (
    <span
      className="ml-2 inline-block rounded-md bg-ink/6 px-1.5 py-px align-[2px] font-mono text-[10.5px] text-ink-soft"
      title={`voice → voice · eot ${metrics.eotMs}ms · stt ${metrics.sttMs}ms · llm ${metrics.llmTtftMs}ms · tts ${metrics.ttsTtfbMs}ms`}
    >
      {metrics.voiceToVoiceMs}ms
    </span>
  )
}

/** Where this conversation's proposals are on their way to Studio's Inbox. */
function StudioLine({ chat }: { chat: Chat }): React.JSX.Element | null {
  const projects = useParlaStore((s) => s.studioProjects)
  if (chat.studioStatus === 'none') return null
  const project = projects.find((p) => p.id === chat.studioProjectId)
  const about = chat.studioProjectId ? ` · about “${project?.title ?? 'a Studio project'}”` : ''
  const text =
    chat.studioStatus === 'pending'
      ? chat.endedAt
        ? 'Sending to Studio…'
        : 'Goes to Studio when it ends'
      : chat.studioStatus === 'done'
        ? chat.studioSent > 0
          ? `${chat.studioSent} proposal${chat.studioSent === 1 ? '' : 's'} in Studio’s Inbox`
          : (chat.studioDetail ?? 'Nothing to propose')
        : chat.studioStatus === 'skipped'
          ? (chat.studioDetail ?? 'Too short for Studio')
          : `Not sent to Studio: ${chat.studioDetail ?? 'it failed'}`
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
      <span className={chat.studioStatus === 'failed' ? 'text-red-700' : 'text-ink-soft'}>
        {text}
        {about}
      </span>
      {(chat.studioStatus === 'failed' || chat.studioStatus === 'done') && chat.endedAt && (
        <button onClick={() => void window.parla.studio.resend(chat.id)} className="btn-quiet !py-1 !text-[12.5px]">
          {chat.studioStatus === 'failed' ? 'Try again' : 'Send again'}
        </button>
      )}
    </div>
  )
}

export default function ChatView({ chatId }: { chatId: string }): React.JSX.Element {
  const chats = useParlaStore((s) => s.chats)
  const messages = useParlaStore((s) => s.chatMessages)
  const personas = useParlaStore((s) => s.personas)
  const startSession = useParlaStore((s) => s.startSession)
  const setActivePersonaId = useParlaStore((s) => s.setActivePersonaId)
  const connection = useParlaStore((s) => s.connection)
  const chat = chats.find((c) => c.id === chatId)
  const persona = personas.find((p) => p.id === chat?.personaId)
  const personaName = persona?.name ?? 'Parla'

  const eyebrow = chat
    ? `${new Date(chat.startedAt)
        .toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
        .toUpperCase()} · ${timeLabel(chat.startedAt).toUpperCase()}`
    : ''

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[820px] px-10 pt-10 pb-16">
        <header>
          <p className="eyebrow mb-1.5">{eyebrow}</p>
          <h1 className="font-display text-[44px] leading-[1.08] text-ink">
            {chat?.title ?? 'Conversation'}
          </h1>
          {chat?.summary && (
            <p className="font-display mt-2.5 text-[17px] leading-relaxed text-ink-soft italic">
              {chat.summary}
            </p>
          )}
          <UsageStatsRow
            chatId={chatId}
            durationS={chat?.endedAt ? (chat.endedAt - chat.startedAt) / 1000 : null}
          />
          {chat && <StudioLine chat={chat} />}
          <div className="mt-6 mb-7 flex items-center gap-3">
            <span className="h-px flex-1 bg-ink/10" />
            <span className="block h-2.5 w-2.5 rotate-45 border border-ember" />
            <span className="h-px flex-1 bg-ink/10" />
          </div>
        </header>

        {messages.length === 0 && (
          <p className="font-display text-[16px] text-ink-faint italic">No transcript recorded.</p>
        )}
        <div className="space-y-5">
          {messages.map((m) => (
            <div key={m.id} className="grid grid-cols-[92px_1fr] gap-4">
              <div className="truncate pt-1 text-[11px] font-semibold tracking-[0.16em] text-ink uppercase" title={m.role === 'user' ? 'You' : personaName}>
                {m.role === 'user' ? 'You' : personaName.replace(/^The /, '')}
              </div>
              <p className="font-display text-[17px] leading-[1.55] text-ink">
                {m.content}
                {m.interrupted && <span className="ml-1 text-ink-soft italic">— interrupted</span>}
                {m.role === 'assistant' && m.metrics && <MetricsBadge metrics={m.metrics} />}
              </p>
            </div>
          ))}
        </div>

        {chat?.endedAt && connection === 'disconnected' && (
          <div className="mt-12 flex justify-center">
            <button
              onClick={() => {
                if (persona) setActivePersonaId(persona.id)
                useParlaStore.getState().setStudioProjectId(chat.studioProjectId)
                void startSession()
              }}
              className="btn-quiet"
            >
              <Icon name="mic" size={15} /> Talk with {personaName} again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
