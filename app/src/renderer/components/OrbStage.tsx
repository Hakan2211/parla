// The orb plus its live overlay: a ring of ember particles that traces the
// voice level while listening/speaking, and three slow orbiting points
// while thinking. Drawn on a 2D canvas from the store (no React re-renders).

import { useEffect, useRef } from 'react'
import SphereCanvas from '@/sphere/SphereCanvas'
import { selectSphereState, useParlaStore } from '@/state/store'

const DOTS = 120
// SphereCanvas: camera z=3.2, fov 45°, unit sphere → radius ≈ 0.755 × half-height.
const SPHERE_FRACTION = 0.755

function ParticleRing(): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let level = 0
    let presence = 0
    let thinking = 0
    let last = performance.now()
    const phases = Array.from({ length: DOTS }, (_, i) => Math.sin(i * 12.9898) * 43758.5453 % 6.283)

    const frame = (now: number): void => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      const s = useParlaStore.getState()
      const state = selectSphereState(s)
      const raw =
        state === 'speaking' ? s.botLevel * 4 : state === 'listening' ? s.micLevel * 5 : 0
      const target = Math.min(raw, 1)
      level += (target - level) * (1 - Math.exp(-dt * (target > level ? 25 : 5)))
      presence += ((state === 'idle' ? 0 : 1) - presence) * (1 - Math.exp(-dt * 3))
      thinking += ((state === 'thinking' ? 1 : 0) - thinking) * (1 - Math.exp(-dt * 4))

      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      if (presence > 0.01) {
        const cx = w / 2
        const cy = h / 2
        const r = (Math.min(w, h) / 2) * SPHERE_FRACTION * 1.14
        const t = reduce ? 0 : now / 1000
        for (let i = 0; i < DOTS; i++) {
          const a = (i / DOTS) * Math.PI * 2 - Math.PI / 2
          // energy concentrates in a travelling lobe so the ring "traces" the voice
          const lobe = 0.5 + 0.5 * Math.cos(a - t * 0.6)
          const wobble = 0.5 + 0.5 * Math.sin(t * 4 + phases[i])
          const amp = level * (0.25 + 0.75 * lobe * lobe) * (0.4 + 0.6 * wobble)
          const alpha = presence * (0.28 + 0.65 * Math.min(amp * 1.6, 1))
          ctx.strokeStyle = ctx.fillStyle = `rgba(191, 95, 61, ${alpha})`
          const x = cx + Math.cos(a) * r
          const y = cy + Math.sin(a) * r
          if (amp > 0.12) {
            const len = amp * 18
            ctx.lineWidth = 1.6
            ctx.lineCap = 'round'
            ctx.beginPath()
            ctx.moveTo(x, y)
            ctx.lineTo(cx + Math.cos(a) * (r + len), cy + Math.sin(a) * (r + len))
            ctx.stroke()
          } else {
            ctx.beginPath()
            ctx.arc(x, y, 1.15, 0, Math.PI * 2)
            ctx.fill()
          }
        }
        if (thinking > 0.01) {
          for (let k = 0; k < 3; k++) {
            const a = t * 0.9 + (k * Math.PI * 2) / 3
            ctx.fillStyle = `rgba(191, 95, 61, ${0.55 * thinking})`
            ctx.beginPath()
            ctx.arc(cx + Math.cos(a) * (r + 10), cy + Math.sin(a) * (r + 10), 2.6, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" />
}

export default function OrbStage(): React.JSX.Element {
  return (
    <div className="relative h-full w-full">
      <div className="orb-halo absolute top-1/2 left-1/2 aspect-square h-[78%] -translate-x-1/2 -translate-y-1/2 rounded-full" />
      <SphereCanvas />
      <ParticleRing />
    </div>
  )
}
