// The voice sphere: one displaced icosahedron, uniforms driven per-frame
// from the store (no React re-renders in the hot path).

import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { selectSphereState, useParlaStore } from '@/state/store'
import { SPHERE_FRAGMENT, SPHERE_VERTEX } from './shaders'

// Per-state targets: wobble amplitude/frequency, flow speed, and the three
// look blends the fragment shader mixes (see shaders.ts).
const STATE_TARGETS = {
  idle: { amp: 0.012, freq: 1.0, flow: 0.35, swirl: 0, warm: 0, cool: 0, scale: 1.0, breathe: 0.008 },
  listening: { amp: 0.016, freq: 1.1, flow: 0.5, swirl: 0, warm: 0, cool: 1, scale: 1.02, breathe: 0.014 },
  thinking: { amp: 0.012, freq: 1.0, flow: 0.85, swirl: 1, warm: 0, cool: 0, scale: 0.97, breathe: 0.004 },
  speaking: { amp: 0.02, freq: 1.2, flow: 0.6, swirl: 0, warm: 1, cool: 0, scale: 1.04, breathe: 0 }
} as const

const REDUCED_MOTION =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function Blob(): React.JSX.Element {
  const mesh = useRef<THREE.Mesh>(null)
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SPHERE_VERTEX,
        fragmentShader: SPHERE_FRAGMENT,
        transparent: true,
        toneMapped: false,
        uniforms: {
          uTime: { value: 0 },
          uClock: { value: 0 },
          uLevel: { value: 0 },
          uAmp: { value: STATE_TARGETS.idle.amp },
          uFreq: { value: STATE_TARGETS.idle.freq },
          uSwirl: { value: 0 },
          uWarm: { value: 0 },
          uCool: { value: 0 }
        }
      }),
    []
  )

  const smoothLevel = useRef(0)
  const flow = useRef<number>(STATE_TARGETS.idle.flow)
  const breathe = useRef<number>(STATE_TARGETS.idle.breathe)
  const baseScale = useRef(1)

  useFrame((_, delta) => {
    const state = useParlaStore.getState()
    const sphereState = selectSphereState(state)
    const target = STATE_TARGETS[sphereState]
    const u = material.uniforms
    const motion = REDUCED_MOTION ? 0.25 : 1

    // Cross-fade state parameters.
    const blend = 1 - Math.exp(-delta * 4)
    flow.current = lerp(flow.current, target.flow, blend)
    breathe.current = lerp(breathe.current, target.breathe, blend)
    // Integrate flow so speed changes never make the liquid jump.
    u.uTime.value += delta * flow.current * motion
    u.uClock.value += delta * motion

    // Audio level: mic while listening, bot voice while speaking.
    const rawLevel =
      sphereState === 'speaking'
        ? state.botLevel * 4
        : sphereState === 'listening'
          ? state.micLevel * 5
          : 0
    const clamped = Math.min(rawLevel, 1)
    // fast attack, slow release — feels reactive without flicker
    smoothLevel.current = lerp(
      smoothLevel.current,
      clamped,
      1 - Math.exp(-delta * (clamped > smoothLevel.current ? 30 : 6))
    )
    u.uLevel.value = smoothLevel.current * motion

    u.uAmp.value = lerp(u.uAmp.value, target.amp, blend)
    u.uFreq.value = lerp(u.uFreq.value, target.freq, blend)
    u.uSwirl.value = lerp(u.uSwirl.value, target.swirl, blend)
    u.uWarm.value = lerp(u.uWarm.value, target.warm, blend)
    u.uCool.value = lerp(u.uCool.value, target.cool, blend)

    if (mesh.current) {
      baseScale.current = lerp(baseScale.current, target.scale, blend)
      const breath = Math.sin(u.uClock.value * 1.3) * breathe.current * motion
      mesh.current.scale.setScalar(baseScale.current * (1 + breath))
    }
  })

  return (
    <mesh ref={mesh} material={material}>
      <icosahedronGeometry args={[1, 32]} />
    </mesh>
  )
}

export default function SphereCanvas(): React.JSX.Element {
  return (
    <Canvas
      camera={{ position: [0, 0, 3.2], fov: 45 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      dpr={[1, 2]}
    >
      <Blob />
    </Canvas>
  )
}
