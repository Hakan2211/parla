import { useEffect, useRef, useState } from 'react'
import { selectSphereState, useParlaStore } from '@/state/store'
import { Bubble, timeLabel } from './Bubbles'
import LatencyHUD from './LatencyHUD'
import ModelSwitch from './ModelSwitch'
import OrbStage from './OrbStage'
import PersonaPicker from './PersonaPicker'
import StudioPicker from './StudioPicker'
import { DiamondRule, Icon } from './ui'
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

function useElapsed(): string {
  const startedAt = useParlaStore((s) => s.sessionStartedAt)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!startedAt) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [startedAt])
  const s = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const BAR_COUNT = 30

/** Live mic/bot waveform: bars driven by level, animated off rAF. */
function Waveform(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const phases = Array.from({ length: BAR_COUNT }, () => Math.random() * Math.PI * 2)
    let raf = 0
    let level = 0
    const frame = (): void => {
      const s = useParlaStore.getState()
      const target = Math.min(Math.max(s.micLevel * 5, s.botLevel * 4), 1)
      level += (target - level) * 0.25
      const t = performance.now() / 260
      const bars = ref.current?.children
      if (bars) {
        for (let i = 0; i < bars.length; i++) {
          const wave = 0.35 + 0.65 * Math.abs(Math.sin(t + phases[i] + i * 0.5))
          ;(bars[i] as HTMLElement).style.height = `${3 + level * wave * 22}px`
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div ref={ref} className="flex h-7 items-center gap-[3px]" aria-hidden>
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span key={i} className="block w-[2px] rounded-full bg-ember/80" style={{ height: 3 }} />
      ))}
    </div>
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
  const elapsed = useElapsed()

  const persona = personas.find((p) => p.id === activePersonaId) ?? personas[0]
  const personaName = persona?.name ?? 'Parla'
  const connected = connection === 'connected'

  // Space starts a conversation from the idle screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || e.repeat) return
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, button, [contenteditable]')) return
      if (useParlaStore.getState().connection !== 'disconnected' || !voiceReady) return
      e.preventDefault()
      void startSession()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [voiceReady, startSession])

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  return (
    <div className="relative flex h-full">
      {/* center stage */}
      <div className="relative flex min-w-0 flex-1 flex-col items-center overflow-hidden px-8 pt-12 pb-8">
        {connected ? (
          <p className="eyebrow mb-2 !text-ember">LIVE · {elapsed}</p>
        ) : (
          <p className="eyebrow mb-2">{todayLabel()}</p>
        )}
        <h1 className="font-display text-center text-[52px] leading-[1.05] text-ink">
          {connected ? `Talking with ${personaName}` : 'A quiet moment'}
        </h1>
        {!connected && (
          <>
            <DiamondRule className="mt-5 mb-4 w-80" />
            <p className="font-display text-[18px] text-ink-soft italic">
              Take a breath, then start when you’re ready.
            </p>
          </>
        )}

        <div className="relative min-h-[240px] w-full flex-1">
          <OrbStage />
          <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 text-[12px] font-medium tracking-[0.32em] text-ember uppercase">
            {connection === 'connecting' ? 'Connecting' : connected ? STATE_LABEL[sphereState] : ''}
          </div>
        </div>

        {connected ? (
          <div className="card-glass mt-6 flex items-center gap-5 rounded-full py-2 pr-2 pl-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ember-deep text-white">
              <Icon name="mic" size={20} strokeWidth={1.8} />
            </div>
            <Waveform />
            <span className="font-mono text-[15px] text-ink tabular-nums">{elapsed}</span>
            <span className="h-7 w-px bg-ink/12" />
            <CostPill usage={sessionUsage} />
            <button
              onClick={() => void endSession()}
              title="End conversation"
              aria-label="End conversation"
              className="ml-1 flex h-12 w-12 items-center justify-center rounded-full border-[1.5px] border-ember/70 text-ember transition hover:bg-ember hover:text-white"
            >
              <span className="block h-3.5 w-3.5 rounded-[2px] bg-current" />
            </button>
          </div>
        ) : (
          <div className="mt-6 flex flex-col items-center gap-5">
            <PersonaPicker />
            <StudioPicker />
            <ModelSwitch />
            <button
              onClick={() => void startSession()}
              disabled={!voiceReady || connection === 'connecting'}
              className="btn-primary px-12 py-3.5 text-[19px] font-display"
            >
              <Icon name="mic" size={20} />
              {connection === 'connecting' ? 'Connecting…' : 'Start talking'}
            </button>
            <p className="-mt-1 text-[13px] text-ink-soft">
              {connection === 'connecting' && progress ? (
                <span className="font-display italic">{progress}</span>
              ) : (
                'Press Space to talk'
              )}
            </p>
          </div>
        )}

        <LatencyHUD />

        {notice && connected && (
          <div className="absolute top-5 left-1/2 -translate-x-1/2 rounded-full border border-ink/10 bg-white/80 px-4 py-1.5 text-xs text-ink-soft">
            {notice}
          </div>
        )}
        {warning !== null && connected && (
          <div className="absolute bottom-28 left-1/2 -translate-x-1/2 rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800">
            Session ends in {warning}s
          </div>
        )}
        {error && (
          <div className="absolute bottom-28 left-1/2 max-w-md -translate-x-1/2 rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-center text-xs text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* conversation panel */}
      <aside className="my-3 mr-3 flex w-[360px] flex-shrink-0 flex-col rounded-[22px] border border-ink/6 bg-parchment/70">
        {connected || messages.length > 0 ? (
          <>
            <header className="flex items-center gap-3 px-6 pt-6 pb-4">
              <h2 className="font-display text-[26px] text-ink">Conversation</h2>
              {connected && (
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-ink-soft">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-600" />
                  live
                </span>
              )}
            </header>
            <div className="mx-6 h-px bg-ink/8" />
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {messages.map((m) => (
                <Bubble
                  key={m.id}
                  role={m.role}
                  speaker={m.role === 'user' ? 'You' : personaName}
                  time={timeLabel(m.at)}
                  streaming={m.pending}
                >
                  {m.text}
                  {m.interrupted && <span className="ml-1 text-sm text-ink-faint italic">— interrupted</span>}
                </Bubble>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
            <Icon name="chat" size={34} className="mb-4 text-ink-soft" strokeWidth={1.3} />
            <h2 className="font-display text-[22px] text-ink">No conversation yet</h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
              Start talking to begin a conversation with {personaName}.
            </p>
          </div>
        )}
      </aside>
    </div>
  )
}
