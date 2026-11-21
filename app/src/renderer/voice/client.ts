// Hand-rolled voice client: WebSocket + protobuf frames + AudioWorklets.
//
// Replaces @pipecat-ai/client-js, whose websocket transport pulls in the
// Daily call-machine bundle from the network — a non-starter for a
// local-first desktop app. The wire protocol is tiny (see protocol.ts) and
// covered by voice/tests/test_pipeline_e2e.py on the server side.

import type { ServerMessage } from '@shared/events'
import { decodeFrame, encodeAudioFrame, encodeMessageFrame } from './protocol'
import { CAPTURE_WORKLET, PLAYBACK_WORKLET, workletUrl } from './worklets'

export interface VoiceSessionCallbacks {
  onConnectionState: (state: 'connecting' | 'connected' | 'disconnected') => void
  onServerMessage: (message: ServerMessage) => void
  onBotSpeaking: (speaking: boolean) => void
  onUserSpeaking: (speaking: boolean) => void
  onBotText: (text: string) => void
  onUserTranscript: (text: string, final: boolean) => void
  onLevels: (mic: number, bot: number) => void
  onError: (message: string) => void
}

const MIC_PROCESSING = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }

/** Open the chosen mic; fall back to the system default if it was unplugged. */
export async function openMic(deviceId: string): Promise<MediaStream> {
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { ...MIC_PROCESSING, deviceId: { exact: deviceId } }
      })
    } catch (e) {
      if (!(e instanceof DOMException && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError'))) throw e
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: MIC_PROCESSING })
}

export class VoiceSession {
  private ws: WebSocket | null = null
  private captureCtx: AudioContext | null = null
  private playbackCtx: AudioContext | null = null
  private playbackNode: AudioWorkletNode | null = null
  private micStream: MediaStream | null = null
  private micLevel = 0
  private botLevel = 0
  private closing = false

  /** `inputDeviceId` empty = the Windows default recording device. */
  async connect(wsUrl: string, callbacks: VoiceSessionCallbacks, inputDeviceId = ''): Promise<void> {
    this.closing = false
    callbacks.onConnectionState('connecting')

    // --- playback path (bot audio @ 24kHz) ---
    const playbackCtx = new AudioContext({ sampleRate: 24000 })
    await playbackCtx.audioWorklet.addModule(workletUrl(PLAYBACK_WORKLET))
    const playbackNode = new AudioWorkletNode(playbackCtx, 'parla-playback')
    playbackNode.connect(playbackCtx.destination)
    playbackNode.port.onmessage = (e) => {
      if (e.data.type === 'rms') {
        this.botLevel = e.data.rms
        callbacks.onLevels(this.micLevel, this.botLevel)
      }
    }
    this.playbackCtx = playbackCtx
    this.playbackNode = playbackNode

    // --- capture path (mic @ 16kHz) ---
    const micStream = await openMic(inputDeviceId)
    this.micStream = micStream
    const captureCtx = new AudioContext({ sampleRate: 16000 })
    await captureCtx.audioWorklet.addModule(workletUrl(CAPTURE_WORKLET))
    const source = captureCtx.createMediaStreamSource(micStream)
    const captureNode = new AudioWorkletNode(captureCtx, 'parla-capture')
    source.connect(captureNode)
    this.captureCtx = captureCtx

    // --- websocket ---
    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    captureNode.port.onmessage = (e) => {
      if (e.data.type !== 'chunk') return
      this.micLevel = e.data.rms
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(encodeAudioFrame(new Uint8Array(e.data.pcm), 16000))
      }
    }

    const flushPlayback = (): void => {
      playbackNode.port.postMessage({ type: 'clear' })
    }

    await new Promise<void>((resolve, reject) => {
      const failTimer = setTimeout(() => reject(new Error('voice connection timed out')), 8000)

      ws.onopen = () => {
        ws.send(
          encodeMessageFrame(
            JSON.stringify({
              id: crypto.randomUUID().slice(0, 8),
              label: 'rtvi-ai',
              type: 'client-ready',
              data: { version: '1.0.0', about: { library: 'parla-client' } }
            })
          )
        )
      }

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') return
        const frame = decodeFrame(new Uint8Array(event.data as ArrayBuffer))
        if (frame.kind === 'audio') {
          const copy = frame.pcm.slice().buffer
          playbackNode.port.postMessage({ type: 'chunk', pcm: copy }, [copy])
          return
        }
        if (frame.kind !== 'message') return
        let payload: { type?: string; data?: unknown }
        try {
          payload = JSON.parse(frame.data)
        } catch {
          return
        }
        const data = payload.data as Record<string, unknown> | undefined
        switch (payload.type) {
          case 'bot-ready':
            clearTimeout(failTimer)
            callbacks.onConnectionState('connected')
            resolve()
            break
          case 'user-transcription':
            if (data) callbacks.onUserTranscript(String(data.text ?? ''), Boolean(data.final))
            break
          case 'bot-llm-text':
            if (data) callbacks.onBotText(String(data.text ?? ''))
            break
          case 'bot-started-speaking':
            callbacks.onBotSpeaking(true)
            break
          case 'bot-stopped-speaking':
            callbacks.onBotSpeaking(false)
            break
          case 'user-started-speaking':
            // No flush here: VAD start is not a barge-in. The server decides
            // (BargeInGate: >= 3 words while the bot speaks) and sends
            // bot-interrupted, which flushes playback below.
            callbacks.onUserSpeaking(true)
            break
          case 'user-stopped-speaking':
            callbacks.onUserSpeaking(false)
            break
          case 'bot-interrupted':
            flushPlayback()
            callbacks.onBotSpeaking(false)
            break
          case 'server-message':
            if (data && typeof data === 'object' && 'type' in data) {
              callbacks.onServerMessage(data as unknown as ServerMessage)
            }
            break
          case 'error':
          case 'error-response':
            if (data?.error && !String(data.error).includes('version')) {
              callbacks.onError(String(data.error))
            }
            break
        }
      }

      ws.onerror = () => {
        clearTimeout(failTimer)
        reject(new Error('voice websocket error'))
      }

      ws.onclose = () => {
        clearTimeout(failTimer)
        if (!this.closing) callbacks.onConnectionState('disconnected')
        void this.teardown()
      }
    })
  }

  async disconnect(): Promise<void> {
    this.closing = true
    try {
      this.ws?.close()
    } catch {
      // already closed
    }
    await this.teardown()
  }

  private async teardown(): Promise<void> {
    this.ws = null
    this.micStream?.getTracks().forEach((t) => t.stop())
    this.micStream = null
    this.playbackNode = null
    const contexts = [this.captureCtx, this.playbackCtx]
    this.captureCtx = null
    this.playbackCtx = null
    for (const ctx of contexts) {
      if (ctx && ctx.state !== 'closed') {
        try {
          await ctx.close()
        } catch {
          // already closing
        }
      }
    }
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }
}
