import { useEffect, useRef } from 'react'
import ChatView from './components/ChatView'
import MemoryPage from './components/MemoryPage'
import PersonaEditor from './components/PersonaEditor'
import SessionView from './components/SessionView'
import SettingsPage from './components/SettingsPage'
import Sidebar from './components/Sidebar'
import { useParlaStore } from './state/store'

export default function App(): React.JSX.Element {
  const status = useParlaStore((s) => s.voiceStatus)
  const view = useParlaStore((s) => s.view)

  // Dev hook: PARLA_AUTOSTART=1 starts a session as soon as voice is ready.
  const autostarted = useRef(false)
  useEffect(() => {
    if (
      status.state === 'ready' &&
      !autostarted.current &&
      new URLSearchParams(window.location.search).has('autostart')
    ) {
      autostarted.current = true
      void useParlaStore.getState().startSession()
    }
  }, [status.state])

  if (status.state !== 'ready') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h1 className="font-display mb-2 text-6xl text-ink">Parla</h1>
          <p className="mb-8 text-[10px] font-semibold tracking-[0.35em] text-ink-faint uppercase">
            Voice Companion
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-ink-soft">
            <span
              className={
                'inline-block h-2.5 w-2.5 rounded-full ' +
                (status.state === 'error' ? 'bg-red-500' : 'animate-pulse bg-ember')
              }
            />
            <span>
              {status.state === 'error' ? 'Voice engine failed' : 'Starting voice engine…'}
            </span>
          </div>
          {status.detail && <p className="mt-2 text-xs text-ink-faint">{status.detail}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="min-w-0 flex-1">
        {view.kind === 'session' && <SessionView />}
        {view.kind === 'chat' && <ChatView chatId={view.chatId} />}
        {view.kind === 'settings' && <SettingsPage />}
        {view.kind === 'personas' && <PersonaEditor />}
        {view.kind === 'memory' && <MemoryPage />}
      </main>
    </div>
  )
}
