// Shared visual vocabulary: thin line icons, the ember-diamond divider,
// generative persona art, the voice catalog, and small controls.

import { useRef, useState } from 'react'

type IconName =
  | 'mic'
  | 'talk'
  | 'personas'
  | 'memory'
  | 'settings'
  | 'chat'
  | 'edit'
  | 'trash'
  | 'play'
  | 'pause'
  | 'plus'
  | 'check'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'spark'
  | 'cloud'
  | 'monitor'
  | 'key'
  | 'leaf'
  | 'lock'
  | 'calendar'

const PATHS: Record<IconName, React.ReactNode> = {
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21" />
    </>
  ),
  talk: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21" />
    </>
  ),
  personas: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20.5c.6-3.8 3.6-6 7.5-6s6.9 2.2 7.5 6" />
    </>
  ),
  memory: (
    <>
      <path d="M12 3.5l8.5 4.3L12 12 3.5 7.8 12 3.5z" />
      <path d="M3.5 12L12 16.2 20.5 12M3.5 16.2L12 20.5l8.5-4.3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.9 2.9l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.9-2.9l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.9-2.9l.1.1a1.7 1.7 0 001.9.3 1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.9 2.9l-.1.1a1.7 1.7 0 00-.3 1.9 1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </>
  ),
  chat: <path d="M20 11.5a7.5 7.5 0 01-11 6.6L4 19.5l1.4-4.4A7.5 7.5 0 1120 11.5z" />,
  edit: <path d="M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16v4zM13.5 6.5l4 4" />,
  trash: (
    <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l.8 12.2a1.5 1.5 0 001.5 1.3h6.4a1.5 1.5 0 001.5-1.3L17.5 7M10 11v6M14 11v6" />
  ),
  play: <path d="M8 5.5v13l10.5-6.5L8 5.5z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  spark: (
    <path d="M12 2.5v6M12 15.5v6M2.5 12h6M15.5 12h6M5.3 5.3l4.2 4.2M14.5 14.5l4.2 4.2M5.3 18.7l4.2-4.2M14.5 9.5l4.2-4.2" />
  ),
  cloud: <path d="M7 18.5a4.5 4.5 0 01-.6-9A6 6 0 0118 9a4.8 4.8 0 01-.5 9.5H7z" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12.5" rx="1.8" />
      <path d="M8.5 20.5h7M12 16.5v4" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8.5-8.5M16.5 6.5l2.5 2.5M14.5 8.5l2 2" />
    </>
  ),
  leaf: <path d="M5 19c0-8 5-13.5 15-14-.5 10-6 15-14 15M5 19l7-7" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 018 0v3" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="15" rx="2" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </>
  )
}

export function Icon({
  name,
  size = 18,
  className = '',
  strokeWidth = 1.5
}: {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  )
}

/** Hairline — ember diamond — hairline. */
export function DiamondRule({ className = 'w-72' }: { className?: string }): React.JSX.Element {
  return (
    <div className={'flex items-center gap-3 ' + className}>
      <span className="h-px flex-1 bg-ink/12" />
      <span className="block h-2 w-2 rotate-45 bg-ember" />
      <span className="h-px flex-1 bg-ink/12" />
    </div>
  )
}

/** Page title block: eyebrow, large serif headline, optional subline. */
export function PageHeader({
  eyebrow,
  title,
  sub,
  children
}: {
  eyebrow?: string
  title: string
  sub?: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <header className="mb-7">
      {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
      <div className="flex items-end justify-between gap-6">
        <h1 className="font-display text-[44px] leading-[1.05] text-ink">{title}</h1>
        {children}
      </div>
      {sub && <p className="font-display mt-2 text-[17px] text-ink-soft">{sub}</p>}
    </header>
  )
}

export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={
        'relative h-6 w-11 flex-shrink-0 rounded-full transition ' +
        (checked ? 'bg-ember' : 'bg-ink/15')
      }
    >
      <span
        className={
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ' +
          (checked ? 'left-[22px]' : 'left-0.5')
        }
      />
    </button>
  )
}

/** Segmented pill control. */
export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}): React.JSX.Element {
  return (
    <div className="inline-flex rounded-full bg-white/60 p-1 shadow-[0_6px_20px_-12px_rgba(43,42,38,0.25)]">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={
            'rounded-full px-6 py-2 text-sm transition ' +
            (o.value === value ? 'bg-ember text-white shadow-sm' : 'text-ink-soft hover:text-ink')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Voices

export interface VoiceInfo {
  id: string
  name: string
  accent: 'US' | 'UK'
  gender: 'f' | 'm'
}

/** Kokoro-82M voices offered in the pickers, with human names. */
export const VOICES: VoiceInfo[] = [
  { id: 'af_heart', name: 'Heart', accent: 'US', gender: 'f' },
  { id: 'af_bella', name: 'Bella', accent: 'US', gender: 'f' },
  { id: 'af_nicole', name: 'Nicole', accent: 'US', gender: 'f' },
  { id: 'af_sarah', name: 'Sarah', accent: 'US', gender: 'f' },
  { id: 'af_sky', name: 'Sky', accent: 'US', gender: 'f' },
  { id: 'am_adam', name: 'Adam', accent: 'US', gender: 'm' },
  { id: 'am_michael', name: 'Michael', accent: 'US', gender: 'm' },
  { id: 'bf_emma', name: 'Emma', accent: 'UK', gender: 'f' },
  { id: 'bf_isabella', name: 'Isabella', accent: 'UK', gender: 'f' },
  { id: 'bm_george', name: 'George', accent: 'UK', gender: 'm' },
  { id: 'bm_lewis', name: 'Lewis', accent: 'UK', gender: 'm' }
]

export function voiceName(id: string): string {
  return VOICES.find((v) => v.id === id)?.name ?? id
}

let currentAudio: HTMLAudioElement | null = null

/** Play/stop a short sample of a voice. One preview plays at a time. */
export function useVoicePreview(): {
  playing: string | null
  loading: string | null
  error: string | null
  toggle: (voiceId: string, text?: string) => void
} {
  const [playing, setPlaying] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const token = useRef(0)

  const stop = (): void => {
    currentAudio?.pause()
    currentAudio = null
    setPlaying(null)
  }

  const toggle = (voiceId: string, text?: string): void => {
    if (playing === voiceId) return stop()
    stop()
    setError(null)
    setLoading(voiceId)
    const mine = ++token.current
    window.parla.voice
      .preview(voiceId, text)
      .then((bytes) => {
        if (mine !== token.current) return
        const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }))
        const audio = new Audio(url)
        currentAudio = audio
        audio.onended = () => {
          URL.revokeObjectURL(url)
          if (currentAudio === audio) stop()
        }
        setPlaying(voiceId)
        void audio.play()
      })
      .catch((e: unknown) => {
        if (mine === token.current)
          setError(
            (e instanceof Error ? e.message : String(e)).replace(
              /^Error invoking remote method '[^']+': (Error: )?/,
              ''
            )
          )
      })
      .finally(() => mine === token.current && setLoading(null))
  }

  return { playing, loading, error, toggle }
}

// ---------------------------------------------------------------------------
// Generative art: soft overlapping watercolor blobs in one hue.

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function rng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Deterministic (seeded) cluster of translucent shapes tinted with `color`. */
export function BlobArt({
  seed,
  color,
  className = ''
}: {
  seed: string
  color: string
  className?: string
}): React.JSX.Element {
  const rand = rng(hashString(seed))
  const id = `b${hashString(seed + color).toString(36)}`
  const shapes = Array.from({ length: 6 }, (_, i) => ({
    cx: 70 + rand() * 100,
    cy: 55 + rand() * 60,
    rx: 34 + rand() * 30,
    ry: 26 + rand() * 26,
    rot: rand() * 180,
    opacity: 0.18 + rand() * 0.32 + (i === 5 ? 0.15 : 0)
  }))
  return (
    <svg viewBox="0 0 240 160" className={className} aria-hidden>
      <defs>
        <filter id={id} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
        <radialGradient id={`${id}-g`} cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="100%" stopColor={color} stopOpacity="1" />
        </radialGradient>
      </defs>
      <g filter={`url(#${id})`}>
        {shapes.map((s, i) => (
          <ellipse
            key={i}
            cx={s.cx}
            cy={s.cy}
            rx={s.rx}
            ry={s.ry}
            transform={`rotate(${s.rot} ${s.cx} ${s.cy})`}
            fill={`url(#${id}-g)`}
            opacity={s.opacity}
          />
        ))}
      </g>
    </svg>
  )
}

/** Small round "landscape" avatar for voices: sky + two hills. */
export function VoiceAvatar({ seed, size = 56 }: { seed: string; size?: number }): React.JSX.Element {
  const rand = rng(hashString(seed))
  const palettes = [
    ['#f2cdb8', '#d98a66', '#b9603f'],
    ['#e3dccb', '#a8a07a', '#6f6a4e'],
    ['#f3d6c4', '#e2a483', '#c27a5a'],
    ['#e2d6d2', '#9d8580', '#5e4c4a'],
    ['#eadfc9', '#c9a979', '#8d6e45']
  ]
  const [sky, mid, deep] = palettes[Math.floor(rand() * palettes.length)]
  const y1 = 55 + rand() * 12
  const y2 = 68 + rand() * 10
  const id = `v${hashString(seed).toString(36)}`
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="flex-shrink-0" aria-hidden>
      <defs>
        <clipPath id={id}>
          <circle cx="50" cy="50" r="50" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>
        <rect width="100" height="100" fill={sky} />
        <path d={`M0 ${y1} C 30 ${y1 - 18}, 60 ${y1 + 10}, 100 ${y1 - 8} V100 H0Z`} fill={mid} />
        <path d={`M0 ${y2 + 6} C 35 ${y2 - 10}, 70 ${y2 + 14}, 100 ${y2} V100 H0Z`} fill={deep} />
      </g>
    </svg>
  )
}
