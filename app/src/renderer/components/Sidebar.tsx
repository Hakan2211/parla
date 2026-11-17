import { formatUsd } from '@/lib/format'
import { useParlaStore } from '@/state/store'

function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const NAV_ICONS: Record<string, React.JSX.Element> = {
  home: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M4.9 19.1l2.2-2.2M16.9 7.1l2.2-2.2" />
    </svg>
  ),
  personas: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.5a3.5 3.5 0 010 7M21.5 20c0-2.9-1.9-5-4.5-5.7" />
    </svg>
  ),
  memory: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21c-5 -3.5 -8 -7 -8 -11a8 8 0 0116 0c0 4 -3 7.5 -8 11z" />
      <path d="M12 21V10M12 13c1.5-1 3-1.2 4-1M12 16c-1.5-1-3-1.2-4-1" />
    </svg>
  ),
  settings: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.9 2.9l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.9-2.9l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.9-2.9l.1.1a1.7 1.7 0 001.9.3h0a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5h0a1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.9 2.9l-.1.1a1.7 1.7 0 00-.3 1.9v0a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  ),
  wave: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M3 12h1M7 8v8M11 5v14M15 8v8M19 10v4M22 12h-1" />
    </svg>
  )
}

export default function Sidebar(): React.JSX.Element {
  const chats = useParlaStore((s) => s.chats)
  const view = useParlaStore((s) => s.view)
  const connection = useParlaStore((s) => s.connection)
  const activeChatId = useParlaStore((s) => s.activeChatId)
  const setView = useParlaStore((s) => s.setView)
  const openChat = useParlaStore((s) => s.openChat)
  const deleteChat = useParlaStore((s) => s.deleteChat)

  const navItems = [
    { kind: 'session', label: connection === 'connected' ? 'Live session' : 'Home', icon: 'home' },
    { kind: 'personas', label: 'Personas', icon: 'personas' },
    { kind: 'memory', label: 'Memory', icon: 'memory' },
    { kind: 'settings', label: 'Settings', icon: 'settings' }
  ] as const

  return (
    <aside className="flex h-full w-64 flex-shrink-0 flex-col border-r border-ink/8 bg-cream-deep/50">
      {/* wordmark */}
      <div className="px-6 pt-7 pb-5">
        <h1 className="font-display text-[28px] leading-none text-ink">Parla</h1>
        <p className="mt-1.5 text-[10px] font-semibold tracking-[0.28em] text-ink-faint uppercase">
          Voice Companion
        </p>
      </div>

      {/* nav */}
      <nav className="space-y-0.5 px-3">
        {navItems.map((item) => {
          const isActive =
            view.kind === item.kind || (item.kind === 'session' && view.kind === 'session')
          return (
            <button
              key={item.kind}
              onClick={() => setView({ kind: item.kind })}
              className={
                'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ' +
                (view.kind === item.kind
                  ? 'bg-white/70 font-medium text-ink shadow-sm'
                  : 'text-ink-soft hover:bg-white/40 hover:text-ink')
              }
            >
              <span className={isActive && view.kind === item.kind ? 'text-ember' : 'text-ink-faint'}>
                {NAV_ICONS[item.icon]}
              </span>
              {item.label}
              {item.kind === 'session' && connection === 'connected' && (
                <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              )}
            </button>
          )
        })}
      </nav>

      {/* history — D-style glass cards */}
      <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="mb-2 px-2 text-[10px] font-semibold tracking-[0.24em] text-ink-faint uppercase">
          History
        </div>
        {chats.length === 0 && (
          <p className="px-2 font-display text-xs text-ink-faint italic">No conversations yet.</p>
        )}
        {chats.map((chat) => {
          const isActive = view.kind === 'chat' && view.chatId === chat.id
          const isLive = chat.id === activeChatId
          return (
            <div
              key={chat.id}
              className={
                'group card-glass relative mb-2 rounded-xl transition ' +
                (isActive ? 'ring-1 ring-ember/40' : '')
              }
            >
              <button
                onClick={() => void openChat(chat.id)}
                className="w-full px-3 py-2.5 text-left"
              >
                <div className="flex items-start gap-2.5">
                  <span className={'mt-0.5 flex-shrink-0 ' + (isLive ? 'text-emerald-500' : 'text-ember/70')}>
                    {NAV_ICONS.wave}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-ink">
                        {chat.title ?? 'Conversation'}
                      </span>
                      <span className="flex-shrink-0 text-[10px] text-ink-faint">
                        {chat.costUsd > 0 && (
                          <span className="font-mono">{formatUsd(chat.costUsd)} · </span>
                        )}
                        {dayLabel(chat.startedAt)}
                      </span>
                    </div>
                    {chat.summary && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-soft">
                        {chat.summary}
                      </p>
                    )}
                  </div>
                </div>
              </button>
              {!isLive && (
                <button
                  onClick={() => void deleteChat(chat.id)}
                  title="Delete chat"
                  className="absolute right-2 bottom-2 hidden rounded p-1 text-ink-faint group-hover:block hover:bg-ink/5 hover:text-red-500"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                  </svg>
                </button>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
