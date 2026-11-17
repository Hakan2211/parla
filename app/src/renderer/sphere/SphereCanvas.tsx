// The voice sphere: one displaced icosahedron, uniforms driven per-frame
// from the store (no React re-renders in the hot path).

import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { selectSphereState, useParlaStore } from '@/state/store'
import { SPHERE_FRAGMENT, SPHERE_VERTEX } from './shaders'

// Per-state targets: displacement amplitude, noise frequency, speed, rim glow.
const STATE_TARGETS = {
  idle: { amp: 0.06, freq: 1.4, speed: 0.25, glow: 0.35, scale: 1.0 },
  listening: { amp: 0.1, freq: 2.2, speed: 0.5, glow: 0.7, scale: 1.03 },
  thinking: { amp: 0.16, freq: 4.5, speed: 1.6, glow: 0.55, scale: 0.97 },
  speaking: { amp: 0.22, freq: 2.8, speed: 0.9, glow: 1.0, scale: 1.08 }
} as const

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
        uniforms: {
          uTime: { value: 0 },
          uLevel: { value: 0 },
          uAmp: { value: STATE_TARGETS.idle.amp },
          uFreq: { value: STATE_TARGETS.idle.freq },
          uSpeed: { value: STATE_TARGETS.idle.speed },
          uGlow: { value: STATE_TARGETS.idle.glow },
          // Fixed warm ember — matches the app accent; persona colors stay
          // on their small UI dots so the orb never clashes with the theme.
          uColor: { value: new THREE.Color('#d97a4e') }
        }
      }),
    []
  )

  const smoothLevel = useRef(0)

  useFrame((_, delta) => {
    const state = useParlaStore.getState()
    const sphereState = selectSphereState(state)
    const target = STATE_TARGETS[sphereState]
    const u = material.uniforms

    u.uTime.value += delta

    // Audio level: mic while listening, bot voice while speaking.
    const rawLevel =
      sphereState === 'speaking'
        ? state.botLevel * 4
        : sphereState === 'listening'
          ? state.micLevel * 5
          : 0
    const clamped = Math.min(rawLevel, 1)
    // fast attack, slow release — feels reactive without flicker
    smoothLevel.current =
      clamped > smoothLevel.current
        ? lerp(smoothLevel.current, clamped, 1 - Math.exp(-delta * 30))
        : lerp(smoothLevel.current, clamped, 1 - Math.exp(-delta * 6))
    u.uLevel.value = smoothLevel.current

    // Cross-fade state parameters.
    const blend = 1 - Math.exp(-delta * 5)
    u.uAmp.value = lerp(u.uAmp.value, target.amp, blend)
    u.uFreq.value = lerp(u.uFreq.value, target.freq, blend)
    u.uSpeed.value = lerp(u.uSpeed.value, target.speed, blend)
    u.uGlow.value = lerp(u.uGlow.value, target.glow, blend)

    if (mesh.current) {
      const s = lerp(mesh.current.scale.x, target.scale, blend)
      mesh.current.scale.setScalar(s)
      mesh.current.rotation.y += delta * 0.05
    }
  })

  return (
    <mesh ref={mesh} material={material}>
      <icosahedronGeometry args={[1, 48]} />
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
