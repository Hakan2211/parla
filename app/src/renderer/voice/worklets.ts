// AudioWorklet sources, inlined as strings and loaded via Blob URLs so the
// renderer stays fully self-contained (no runtime asset fetches).

/** Mic capture: runs in a 16kHz AudioContext, batches 20ms PCM16 chunks. */
export const CAPTURE_WORKLET = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Int16Array(320) // 20ms @ 16kHz
    this.offset = 0
    this.rms = 0
  }
  process(inputs) {
    const input = inputs[0]?.[0]
    if (!input) return true
    let sumSquares = 0
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]))
      sumSquares += s * s
      this.buffer[this.offset++] = s < 0 ? s * 0x8000 : s * 0x7fff
      if (this.offset === this.buffer.length) {
        this.port.postMessage(
          { type: 'chunk', pcm: this.buffer.buffer.slice(0), rms: this.rms },
          []
        )
        this.offset = 0
      }
    }
    // exponential smoothing across process() calls (~2.7ms each)
    const frameRms = Math.sqrt(sumSquares / input.length)
    this.rms = this.rms * 0.9 + frameRms * 0.1
    return true
  }
}
registerProcessor('parla-capture', CaptureProcessor)
`

/** Bot playback: ring buffer of PCM16 chunks in a 24kHz AudioContext.
 *  'clear' drops everything queued — the barge-in flush. */
export const PLAYBACK_WORKLET = `
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.queue = []       // Float32Array chunks
    this.current = null
    this.offset = 0
    this.rms = 0
    this.reportCounter = 0
    this.port.onmessage = (e) => {
      if (e.data.type === 'chunk') {
        const pcm = new Int16Array(e.data.pcm)
        const f32 = new Float32Array(pcm.length)
        for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 0x8000
        this.queue.push(f32)
      } else if (e.data.type === 'clear') {
        this.queue = []
        this.current = null
        this.offset = 0
      }
    }
  }
  process(_inputs, outputs) {
    const out = outputs[0][0]
    let sumSquares = 0
    for (let i = 0; i < out.length; i++) {
      if (!this.current || this.offset >= this.current.length) {
        this.current = this.queue.shift() || null
        this.offset = 0
      }
      const sample = this.current ? this.current[this.offset++] : 0
      out[i] = sample
      sumSquares += sample * sample
    }
    this.rms = this.rms * 0.85 + Math.sqrt(sumSquares / out.length) * 0.15
    if (++this.reportCounter >= 12) { // ~64ms at 24kHz/128
      this.reportCounter = 0
      this.port.postMessage({ type: 'rms', rms: this.rms })
    }
    return true
  }
}
registerProcessor('parla-playback', PlaybackProcessor)
`

export function workletUrl(source: string): string {
  return URL.createObjectURL(new Blob([source], { type: 'application/javascript' }))
}
