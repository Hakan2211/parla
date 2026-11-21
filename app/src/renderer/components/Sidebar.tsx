import { formatUsd } from '@/lib/format'
import { useParlaStore, type View } from '@/state/store'
import { Icon } from './ui'

function dayLabel(ts: number): string {
  const d = new Date(ts)
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === new Date().toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const NAV: { kind: View['kind']; label: string; icon: 'talk' | 'personas' | 'memory' | 'settings' }[] = [
  { kind: 'session', label: 'Talk', icon: 'talk' },
  { kind: 'personas', label: 'Personas', icon: 'personas' },
  { kind: 'memory', label: 'Memory', icon: 'memory' },
  { kind: 'settings', label: 'Settings', icon: 'settings' }
]

export default function Sidebar(): React.JSX.Element {
  const chats = useParlaStore((s) => s.chats)
  const view = useParlaStore((s) => s.view)
  const connection = useParlaStore((s) => s.connection)
  const activeChatId = useParlaStore((s) => s.activeChatId)
  const setView = useParlaStore((s) => s.setView)
  const openChat = useParlaStore((s) => s.openChat)
  const deleteChat = useParlaStore((s) => s.deleteChat)
  const live = connection === 'connected'

  return (
    <aside className="flex h-full w-[260px] flex-shrink-0 flex-col border-r border-ink/8 bg-cream-deep/40">
      <div className="px-6 pt-7 pb-5">
        <h1 className="font-display text-[34px] leading-none text-ink">Parla</h1>
        <p className="mt-2 text-[9.5px] font-semibold tracking-[0.26em] text-ink-soft uppercase">
          Your voice companion
        </p>
      </div>

      <nav className="space-y-0.5 px-3">
        {NAV.map((item) => {
          const active = view.kind === item.kind
          return (
            <button
              key={item.kind}
              onClick={() => setView({ kind: item.kind } as View)}
              className={
                'flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-[14.5px] transition ' +
                (active
                  ? 'bg-ember-wash/80 text-ember-deep'
                  : 'text-ink hover:bg-white/45')
              }
            >
              <Icon name={item.icon} size={19} className={active ? 'text-ember' : 'text-ink-soft'} />
              {item.label}
              {item.kind === 'session' && live && (
                <span className="ml-auto flex items-center gap-1.5 text-[10px] font-medium tracking-[0.15em] text-ember uppercase">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ember" />
                  Live
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="mx-6 mt-5 h-px bg-ink/8" />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-4 pb-4">
        <div className="eyebrow mb-2.5 px-3">Recent</div>
        {chats.length === 0 && (
          <p className="font-display px-3 text-sm text-ink-faint italic">No conversations yet.</p>
        )}
        {chats.map((chat) => {
          const isActive = view.kind === 'chat' && view.chatId === chat.id
          const isLive = chat.id === activeChatId
          return (
            <div
              key={chat.id}
              className={
                'group relative mb-2 rounded-xl border transition ' +
                (isActive
                  ? 'border-ember/35 bg-white/85 shadow-sm'
                  : 'border-transparent bg-white/50 hover:bg-white/80')
              }
            >
              <button onClick={() => void openChat(chat.id)} className="w-full px-3.5 py-3 text-left">
                <div className="flex items-baseline gap-2">
                  <span className="font-display min-w-0 flex-1 truncate text-[15px] leading-snug text-ink">
                    {chat.title ?? (isLive ? 'In conversation…' : 'Conversation')}
                  </span>
                  {isLive && <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-ember" />}
                </div>
                <div className="mt-1 flex items-end gap-2">
                  <p className="line-clamp-2 min-w-0 flex-1 text-[11.5px] leading-snug text-ink-soft">
                    {chat.summary ?? ''}
                  </p>
                  <span className="flex-shrink-0 text-[10.5px] whitespace-nowrap text-ink-faint">
                    {chat.costUsd > 0 && <span className="tabular-nums">{formatUsd(chat.costUsd)} · </span>}
                    {dayLabel(chat.startedAt)}
                  </span>
                </div>
              </button>
              {!isLive && (
                <button
                  onClick={() => void deleteChat(chat.id)}
                  title="Delete conversation"
                  className="absolute top-2 right-2 hidden rounded-md p-1 text-ink-faint group-hover:block hover:bg-ink/5 hover:text-red-600"
                >
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
