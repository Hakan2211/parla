// Minimal protobuf wire codec for pipecat's frames.proto — only the two
// message types we exchange (AudioRawFrame, MessageFrame). Hand-rolled to
// keep the client dependency-free; the schema is 5 fields deep and frozen
// by the server's pipecat version, verified by voice/tests.
//
//   message Frame { oneof frame {
//     TextFrame text = 1; AudioRawFrame audio = 2;
//     TranscriptionFrame transcription = 3; MessageFrame message = 4;
//     InterruptionFrame interruption = 5; } }
//   message AudioRawFrame  { uint64 id=1; string name=2; bytes audio=3;
//                            uint32 sample_rate=4; uint32 num_channels=5;
//                            optional uint64 pts=6; }
//   message MessageFrame   { string data=1; }

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

// Uint8Array<ArrayBuffer> — TS 5.7+ types Uint8Array over ArrayBufferLike,
// but WebSocket.send wants a plain ArrayBuffer-backed view.
export type Bytes = Uint8Array<ArrayBuffer>

function varintLength(value: number): number {
  let n = 0
  do {
    n++
    value = Math.floor(value / 128)
  } while (value > 0)
  return n
}

function writeVarint(buf: Uint8Array, offset: number, value: number): number {
  while (value > 127) {
    buf[offset++] = (value & 0x7f) | 0x80
    value = Math.floor(value / 128)
  }
  buf[offset++] = value
  return offset
}

function readVarint(buf: Uint8Array, offset: number): [number, number] {
  let result = 0
  let shift = 0
  for (;;) {
    const byte = buf[offset++]
    result += (byte & 0x7f) * Math.pow(2, shift)
    if ((byte & 0x80) === 0) return [result, offset]
    shift += 7
    if (shift > 63) throw new Error('varint too long')
  }
}

/** Encode Frame{audio: {id:1, name, audio, sample_rate, num_channels}}. */
export function encodeAudioFrame(
  pcm: Uint8Array,
  sampleRate: number,
  numChannels = 1
): Bytes {
  const name = textEncoder.encode('audio')
  // inner AudioRawFrame
  const innerLen =
    1 + varintLength(1) + // id
    1 + varintLength(name.length) + name.length +
    1 + varintLength(pcm.length) + pcm.length +
    1 + varintLength(sampleRate) +
    1 + varintLength(numChannels)
  const total = 1 + varintLength(innerLen) + innerLen
  const out = new Uint8Array(total)
  let o = 0
  out[o++] = (2 << 3) | 2 // Frame.audio, length-delimited
  o = writeVarint(out, o, innerLen)
  out[o++] = (1 << 3) | 0 // id, varint
  o = writeVarint(out, o, 1)
  out[o++] = (2 << 3) | 2 // name, string
  o = writeVarint(out, o, name.length)
  out.set(name, o)
  o += name.length
  out[o++] = (3 << 3) | 2 // audio, bytes
  o = writeVarint(out, o, pcm.length)
  out.set(pcm, o)
  o += pcm.length
  out[o++] = (4 << 3) | 0 // sample_rate
  o = writeVarint(out, o, sampleRate)
  out[o++] = (5 << 3) | 0 // num_channels
  o = writeVarint(out, o, numChannels)
  return out
}

/** Encode Frame{message: {data: json}}. */
export function encodeMessageFrame(json: string): Bytes {
  const data = textEncoder.encode(json)
  const innerLen = 1 + varintLength(data.length) + data.length
  const out = new Uint8Array(1 + varintLength(innerLen) + innerLen)
  let o = 0
  out[o++] = (4 << 3) | 2 // Frame.message
  o = writeVarint(out, o, innerLen)
  out[o++] = (1 << 3) | 2 // data, string
  o = writeVarint(out, o, data.length)
  out.set(data, o)
  return out
}

export type DecodedFrame =
  | { kind: 'audio'; pcm: Uint8Array; sampleRate: number; numChannels: number }
  | { kind: 'message'; data: string }
  | { kind: 'other' }

export function decodeFrame(buf: Uint8Array): DecodedFrame {
  let o = 0
  const tag = buf[o++]
  const field = tag >> 3
  const [len, afterLen] = readVarint(buf, o)
  o = afterLen
  const body = buf.subarray(o, o + len)

  if (field === 2) {
    // AudioRawFrame
    let pcm: Uint8Array = new Uint8Array(0)
    let sampleRate = 16000
    let numChannels = 1
    let i = 0
    while (i < body.length) {
      const t = body[i++]
      const f = t >> 3
      const wire = t & 7
      if (wire === 0) {
        const [value, next] = readVarint(body, i)
        i = next
        if (f === 4) sampleRate = value
        if (f === 5) numChannels = value
      } else if (wire === 2) {
        const [blen, next] = readVarint(body, i)
        i = next
        if (f === 3) pcm = body.subarray(i, i + blen)
        i += blen
      } else {
        throw new Error(`unexpected wire type ${wire}`)
      }
    }
    return { kind: 'audio', pcm, sampleRate, numChannels }
  }

  if (field === 4) {
    // MessageFrame
    let i = 0
    while (i < body.length) {
      const t = body[i++]
      const wire = t & 7
      const [blen, next] = readVarint(body, i)
      i = next
      if (wire === 2 && t >> 3 === 1) {
        return { kind: 'message', data: textDecoder.decode(body.subarray(i, i + blen)) }
      }
      if (wire === 2) i += blen
    }
  }
  return { kind: 'other' }
}
