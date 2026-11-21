// First-run / startup screen: what Parla is getting ready, one line each.

import { useEffect, useState } from 'react'
import { useParlaStore } from '@/state/store'
import { Icon } from './ui'

type ItemState = 'done' | 'working' | 'waiting' | 'failed'

const PROVIDER_LABEL: Record<string, string> = {
  claude: 'Claude',
  anthropic: 'Anthropic API',
  openrouter: 'OpenRouter',
  lmstudio: 'Local model'
}

function StatusMark({ state }: { state: ItemState }): React.JSX.Element {
  if (state === 'done')
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full border-[1.5px] border-ink-soft text-ink-soft">
        <Icon name="check" size={16} strokeWidth={1.8} />
      </span>
    )
  if (state === 'failed')
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full border-[1.5px] border-red-600 font-semibold text-red-600">
        !
      </span>
    )
  if (state === 'working')
    return (
      <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="13" fill="none" stroke="rgba(191,95,61,0.18)" strokeWidth="3" />
        <circle
          cx="16"
          cy="16"
          r="13"
          fill="none"
          stroke="#bf5f3d"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="28 100"
          className="spin origin-center"
        />
      </svg>
    )
  return <span className="block h-8 w-8 rounded-full border-[1.5px] border-dashed border-ink/20" />
}

export default function BootScreen(): React.JSX.Element {
  const status = useParlaStore((s) => s.voiceStatus)
  const [provider, setProvider] = useState<string | null>(null)
  const [mic, setMic] = useState<PermissionState | 'unknown'>('unknown')

  useEffect(() => {
    void window.parla.settings.all().then((all) => setProvider(String(all['llm.provider'] ?? 'claude')))
    navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((p) => {
        setMic(p.state)
        p.onchange = () => setMic(p.state)
      })
      .catch(() => setMic('unknown'))
  }, [])

  const failed = status.state === 'error'
  const serverUp = Boolean(status.models)
  const [retrying, setRetrying] = useState(false)
  const stt: ItemState = status.models?.stt ? 'done' : failed ? 'failed' : 'working'
  const tts: ItemState = status.models?.tts ? 'done' : failed ? 'failed' : serverUp ? 'working' : 'waiting'

  const items: { label: string; value: string; state: ItemState }[] = [
    {
      label: 'Speech recognition',
      value: stt === 'done' ? 'Parakeet, ready' : stt === 'failed' ? 'Parakeet, failed' : 'Parakeet, loading',
      state: stt
    },
    {
      label: 'Voice',
      value: tts === 'done' ? 'Kokoro, ready' : tts === 'failed' ? 'Kokoro, failed' : 'Kokoro, warming up',
      state: tts
    },
    {
      label: 'Conversation',
      value: provider ? `${PROVIDER_LABEL[provider] ?? provider}, selected` : '…',
      state: provider ? 'done' : 'waiting'
    },
    {
      label: 'Microphone',
      value:
        mic === 'granted'
          ? 'allowed'
          : mic === 'denied'
            ? 'blocked — allow it in Windows privacy settings'
            : 'asks when you start talking',
      state: mic === 'denied' ? 'failed' : 'done'
    }
  ]
  const done = items.filter((i) => i.state === 'done').length
  // Model loading dominates startup: weight it so the bar keeps moving.
  const progress = failed ? 1 : Math.min((done + (serverUp ? 0.5 : 0.15)) / (items.length + 0.5), 0.97)

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="flex w-full max-w-[560px] flex-col items-center">
        <h1 className="font-display text-[120px] leading-[0.9] text-ink">Parla</h1>
        <p className="mt-4 text-[15px] tracking-[0.42em] text-ink-soft uppercase">Voice Companion</p>

        <div className="card mt-10 w-full px-8 py-2">
          {items.map((item, i) => (
            <div
              key={item.label}
              className={'flex items-center gap-5 py-3.5 ' + (i > 0 ? 'border-t border-ink/8' : '')}
            >
              <StatusMark state={item.state} />
              <p className="text-[16px]">
                <span className="font-display text-[19px] font-semibold text-ink">{item.label}:</span>{' '}
                <span className={item.state === 'failed' ? 'text-red-700' : 'text-ink-soft'}>{item.value}</span>
              </p>
            </div>
          ))}
        </div>

        <div className="mt-10 h-2 w-[86%] overflow-hidden rounded-full bg-ember/12">
          <div
            className={'h-full rounded-full transition-[width] duration-700 ' + (failed ? 'bg-red-600/70' : 'bg-ember')}
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        {failed ? (
          <div className="mt-6 flex flex-col items-center gap-4">
            <p className="text-center text-[14px] text-red-700">
              The voice engine didn’t start{status.detail ? `: ${status.detail}` : ''}.
            </p>
            <button
              disabled={retrying}
              onClick={() => {
                setRetrying(true)
                void window.parla.voice.restart().finally(() => setRetrying(false))
              }}
              className="btn-primary px-7 py-2.5 text-[15px]"
            >
              {retrying ? 'Restarting…' : 'Try again'}
            </button>
            <p className="text-[12px] text-ink-soft">Details: %APPDATA%\Parla\logs\voice-server.log</p>
          </div>
        ) : (
          <p className="font-display mt-6 text-[21px] text-ink">
            Everything you say is transcribed on this computer.
          </p>
        )}
      </div>
    </div>
  )
}
