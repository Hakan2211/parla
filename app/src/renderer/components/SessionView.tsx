import { useEffect, useRef, useState } from 'react'
import SphereCanvas from '@/sphere/SphereCanvas'
import { selectSphereState, useParlaStore } from '@/state/store'
import { Bubble, timeLabel } from './Bubbles'
import LatencyHUD from './LatencyHUD'
import PersonaPicker from './PersonaPicker'
import { CostPill } from './Usage'

const STATE_LABEL = {
  idle: '',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking'
} as const

function todayLabel(): string {
  return new Date()
    .toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
    .toUpperCase()
}

function ElapsedTimer(): React.JSX.Element {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(t)
  }, [])
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  return (
    <span className="font-mono text-sm text-ink-soft tabular-nums">
      {mm}:{ss}
    </span>
  )
}

const BAR_COUNT = 28

function Waveform(): React.JSX.Element {
  const micLevel = useParlaStore((s) => s.micLevel)
  const botLevel = useParlaStore((s) => s.botLevel)
  const level = Math.min(Math.max(micLevel * 5, botLevel * 4), 1)
  const phases = useRef(Array.from({ length: BAR_COUNT }, () => Math.random() * Math.PI * 2))

  const t = Date.now() / 300
  return (
    <div className="flex h-6 items-center gap-[3px]">
      {phases.current.map((phase, i) => {
        const wave = 0.35 + 0.65 * Math.abs(Math.sin(t + phase + i * 0.6))
        const h = 3 + level * wave * 20
        return (
          <span
            key={i}
            className="w-[2px] rounded-full bg-ember/70 transition-[height] duration-100"
            style={{ height: `${h}px` }}
          />
        )
      })}
    </div>
  )
}

function MicIcon(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0014 0M12 19v3" />
    </svg>
  )
}

export default function SessionView(): React.JSX.Element {
  const connection = useParlaStore((s) => s.connection)
  const voiceReady = useParlaStore((s) => s.voiceStatus.state === 'ready')
  const messages = useParlaStore((s) => s.liveMessages)
  const error = useParlaStore((s) => s.sessionError)
  const warning = useParlaStore((s) => s.sessionWarning)
  const notice = useParlaStore((s) => s.sessionNotice)
  const startSession = useParlaStore((s) => s.startSession)
  const endSession = useParlaStore((s) => s.endSession)
  const personas = useParlaStore((s) => s.personas)
  const activePersonaId = useParlaStore((s) => s.activePersonaId)
  const sessionUsage = useParlaStore((s) => s.sessionUsage)
  const progress = useParlaStore((s) => s.sessionProgress)

  const sphereState = useParlaStore(selectSphereState)
  const persona = personas.find((p) => p.id === activePersonaId) ?? personas[0]
  const personaName = persona?.name ?? 'Parla'
  const connected = connection === 'connected'

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  return (
    <div className="relative flex h-full">
      {/* center stage */}
      <div className="flex min-w-0 flex-1 flex-col items-center overflow-hidden px-8 pt-10 pb-8">
        <p className="mb-2 text-[11px] font-semibold tracking-[0.3em] text-ink-faint">
          {todayLabel()}
        </p>
        <h1 className="font-display text-[42px] leading-tight text-ink">
          {connected ? `Talking with ${personaName}` : 'A quiet moment'}
        </h1>
        <div className="mt-3 mb-1 flex w-64 items-center gap-3">
          <span className="h-px flex-1 bg-ink/10" />
          <span className="text-ember/60">◆</span>
          <span className="h-px flex-1 bg-ink/10" />
        </div>
        <p className="font-display text-sm text-ink-soft italic">
          {connected
            ? 'Speak freely — pause whenever you need to.'
            : 'Take a breath, then start when you’re ready.'}
        </p>

        {/* orb */}
        <div className="relative min-h-0 w-full flex-1">
          <div className="orb-halo absolute top-1/2 left-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full" />
          <SphereCanvas />
          <div className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 text-[11px] tracking-[0.3em] text-ink-faint uppercase">
            {connection === 'connecting' ? 'Connecting' : connected ? STATE_LABEL[sphereState] : ''}
          </div>
        </div>

        {/* controls */}
        {connected ? (
          <div className="mt-4 flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-ember text-white shadow-md shadow-ember/30">
              <MicIcon />
            </div>
            <div className="card-glass flex items-center gap-4 rounded-full px-5 py-2.5">
              <Waveform />
              <ElapsedTimer />
              <span className="h-4 w-px bg-ink/10" />
              <CostPill usage={sessionUsage} />
            </div>
            <button
              onClick={() => void endSession()}
              title="End session"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-ink/15 bg-white/60 text-ink-soft transition hover:border-red-300 hover:text-red-500"
            >
              <span className="block h-3.5 w-3.5 rounded-[3px] bg-current" />
            </button>
          </div>
        ) : (
          <div className="mt-4 flex flex-col items-center gap-4">
            <PersonaPicker />
            <button
              onClick={() => void startSession()}
              disabled={!voiceReady || connection === 'connecting'}
              className="flex items-center gap-3 rounded-full bg-ember px-8 py-3 text-sm font-medium text-white shadow-lg shadow-ember/25 transition hover:bg-ember-deep disabled:opacity-40"
            >
              <MicIcon />
              {connection === 'connecting' ? 'Connecting…' : 'Start talking'}
            </button>
            {connection === 'connecting' && progress && (
              <p className="font-display text-xs text-ink-soft italic">{progress}</p>
            )}
          </div>
        )}
      </div>

      {/* conversation panel */}
      <aside className="flex w-[360px] flex-shrink-0 flex-col border-l border-ink/8 bg-parchment/60">
        <header className="flex items-center justify-between border-b border-ink/8 px-5 py-4">
          <h2 className="font-display text-lg text-ink">Conversation</h2>
          {connected && (
            <span className="flex items-center gap-1.5 text-[11px] text-ink-faint">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              live
            </span>
          )}
        </header>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {messages.length === 0 && (
            <p className="mt-8 text-center font-display text-sm text-ink-faint italic">
              Your conversation will appear here.
            </p>
          )}
          {messages.map((m) => (
            <Bubble
              key={m.id}
              role={m.role}
              speaker={m.role === 'user' ? 'You' : personaName}
              time={timeLabel(m.at)}
            >
              {m.text}
              {m.interrupted && (
                <span className="ml-1 text-xs text-ink-faint italic">— interrupted</span>
              )}
            </Bubble>
          ))}
        </div>
      </aside>

      {/* banners */}
      {notice && connected && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full border border-sky-200 bg-sky-50 px-4 py-1.5 text-xs text-sky-700">
          {notice}
        </div>
      )}
      {warning !== null && connected && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-700">
          Session ends in {warning}s
        </div>
      )}
      {error && (
        <div className="absolute bottom-24 left-1/2 max-w-md -translate-x-1/2 rounded-full border border-red-200 bg-red-50 px-4 py-1.5 text-xs text-red-600">
          {error}
        </div>
      )}
      <LatencyHUD />
    </div>
  )
}
