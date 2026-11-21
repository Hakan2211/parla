import { useEffect, useRef } from 'react'
import ChatView from './components/ChatView'
import MemoryPage from './components/MemoryPage'
import PersonaEditor from './components/PersonaEditor'
import SessionView from './components/SessionView'
import SettingsPage from './components/SettingsPage'
import Sidebar from './components/Sidebar'
import BootScreen from './components/BootScreen'
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

  if (status.state !== 'ready') return <BootScreen />

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
