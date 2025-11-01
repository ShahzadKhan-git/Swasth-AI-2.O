'use client'

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

// Default Ready Player Me GLB model URL
const DEFAULT_MODEL_URL = 'https://models.readyplayer.me/6906482aefedb00e4537b79e.glb'

// Types
export type PhonemeTiming = { start: number; end: number; phoneme: string }

export type DoctorAvatarProps = {
  chatResponse?: string // latest chatbot message to speak
  modelUrl?: string
  className?: string
  voiceId?: string // TTS voice id if provider supports it
  ttsProvider?: 'elevenlabs' | 'google'
  muteAudio?: boolean // if true, do not play audio (use for pages where chatbot already speaks)
}

// Lightweight mapper from phoneme to viseme emphasis
const PHONEME_MAP: Record<string, { jaw?: number; smile?: number; aa?: number; ff?: number; pp?: number }> = {
  // vowels -> jaw open
  AA: { jaw: 1, aa: 1 }, AE: { jaw: 0.9, aa: 0.9 }, AH: { jaw: 0.9, aa: 0.8 }, AO: { jaw: 0.9, aa: 0.7 },
  EH: { jaw: 0.7, aa: 0.5 }, ER: { jaw: 0.6 }, IH: { jaw: 0.5 }, IY: { jaw: 0.5 }, UH: { jaw: 0.6 }, UW: { jaw: 0.7 },
  // labiodentals -> FF
  F: { ff: 1 }, V: { ff: 1 },
  // bilabials -> closed PP
  M: { pp: 1 }, B: { pp: 1 }, P: { pp: 1 },
  // smile-ish
  S: { smile: 0.6 }, Z: { smile: 0.6 }, TH: { smile: 0.4 }, DH: { smile: 0.4 }, L: { smile: 0.5 }
}

// Model that exposes hooks to control blendshapes and bones
function DrSwasthModel({
  isSpeaking,
  phonemes,
  audioClock,
  getAmplitude,
  modelUrl,
  desiredScale = 1.0,
}: {
  isSpeaking: boolean
  phonemes: PhonemeTiming[] | null
  audioClock: (() => number) | null // returns seconds elapsed since audio start
  getAmplitude?: () => number | null
  modelUrl?: string
  desiredScale?: number
}) {
  const url = modelUrl || DEFAULT_MODEL_URL
  const gltf = useGLTF(url)
  const groupRef = useRef<THREE.Group>(null)
  useEffect(() => { try { (useGLTF as any).preload?.(url) } catch {} }, [url])

  // Enable shadows on meshes
  useEffect(() => {
    gltf.scene.traverse((obj: any) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh
        m.castShadow = true
        m.receiveShadow = true
      }
    })
  }, [gltf])

  // Collect morph targets and important bones
  const targets = useMemo(() => {
    const out = {
      jawLike: [] as Array<{ mesh: THREE.Mesh; index: number }>,
      smileLike: [] as Array<{ mesh: THREE.Mesh; index: number }>,
      aaLike: [] as Array<{ mesh: THREE.Mesh; index: number }>,
      ffLike: [] as Array<{ mesh: THREE.Mesh; index: number }>,
      ppLike: [] as Array<{ mesh: THREE.Mesh; index: number }>,
      blinkL: [] as Array<{ mesh: THREE.Mesh; index: number }>,
      blinkR: [] as Array<{ mesh: THREE.Mesh; index: number }>,
      leftArm: [] as THREE.Object3D[],
      rightArm: [] as THREE.Object3D[],
      bounds: { height: 0 } as { height: number },
    }
    // compute bounds once for centering help
    const box = new THREE.Box3().setFromObject(gltf.scene)
    const size = new THREE.Vector3(); box.getSize(size)
    out.bounds.height = size.y

    gltf.scene.traverse((obj) => {
      const mesh = obj as any
      // blendshapes
      if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
        const dict: Record<string, number> = mesh.morphTargetDictionary
        const pushIf = (names: string[], arr: Array<{ mesh: any; index: number }>) => {
          for (const n of names) if (dict[n] != null) arr.push({ mesh, index: dict[n] })
        }
        pushIf(['jawOpen', 'JawOpen', 'mouthOpen', 'MouthOpen', 'viseme_aa'], out.jawLike)
        pushIf(['mouthSmile', 'smile', 'Smile'], out.smileLike)
        pushIf(['viseme_aa', 'viseme_ih', 'viseme_oh'], out.aaLike)
        pushIf(['viseme_FF', 'viseme_ff'], out.ffLike)
        pushIf(['viseme_PP', 'viseme_bp', 'viseme_M'], out.ppLike)
        pushIf(['eyeBlinkLeft', 'blink_left', 'Blink_L'], out.blinkL)
        pushIf(['eyeBlinkRight', 'blink_right', 'Blink_R'], out.blinkR)
      }
      // arms / hands bones
      const name = (obj as any).name as string | undefined
      if (name) {
        if (/left.*(hand|forearm|arm)|hand.*left/i.test(name)) out.leftArm.push(obj)
        if (/right.*(hand|forearm|arm)|hand.*right/i.test(name)) out.rightArm.push(obj)
      }
    })
    return out
  }, [gltf])

  // Blink state
  const blinkRef = useRef<{ t: number; phase: 'idle'|'closing'|'opening'; nextAt: number }>({ t: 0, phase: 'idle', nextAt: 1.5 + Math.random()*3 })
  // Track last mouth openness for smoothing
  const mouthOpennessRef = useRef(0)
  // Hand gesture phase offsets
  const gesturePhaseRef = useRef({ l: Math.random() * Math.PI * 2, r: Math.random() * Math.PI * 2 })

  useFrame((state, delta) => {
    const t = state.clock.getElapsedTime()
    // idle gentle rotation
    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(t * 0.2) * 0.1
      // slight upward tilt so the face is visible
      groupRef.current.rotation.x = -0.12 + 0.02 * Math.sin(t * 0.8)
      // center vertically using bounds height heuristic
      const h = targets.bounds.height || 2.0
      const baseY = -h * 0.62 // push down just enough to include feet
      groupRef.current.position.y = baseY + 0.02 * Math.sin(t * 1.2)
      groupRef.current.scale.setScalar(desiredScale)
    }

    // blink controller
    const br = blinkRef.current
    br.t += delta
    if (br.phase === 'idle' && br.t > br.nextAt) {
      br.phase = 'closing'; br.t = 0
    }
    let blinkAmount = 0
    if (br.phase === 'closing') {
      blinkAmount = Math.min(1, br.t * 12)
      if (blinkAmount >= 1) { br.phase = 'opening'; br.t = 0 }
    } else if (br.phase === 'opening') {
      blinkAmount = Math.max(0, 1 - br.t * 10)
      if (blinkAmount <= 0) { br.phase = 'idle'; br.t = 0; br.nextAt = 2 + Math.random()*4 }
    }
    const applyInfl = (arr: Array<{ mesh: any; index: number }>, v: number) => {
      for (const { mesh, index } of arr) if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = mesh.morphTargetInfluences[index] * 0.6 + v * 0.4
    }
    if (blinkAmount > 0) {
      applyInfl(targets.blinkL, blinkAmount)
      applyInfl(targets.blinkR, blinkAmount)
    }

    // speech-driven mouth & gestures
    let openness = 0
    let smile = 0
    let aa = 0, ff = 0, pp = 0

    if (phonemes && audioClock) {
      const ct = audioClock()
      const ph = phonemes.find(p => ct >= p.start && ct <= p.end)
      if (ph) {
        const m = PHONEME_MAP[ph.phoneme.toUpperCase()] || {}
        openness = Math.max(openness, m.jaw ?? 0)
        smile = Math.max(smile, m.smile ?? 0)
        aa = Math.max(aa, m.aa ?? 0)
        ff = Math.max(ff, m.ff ?? 0)
        pp = Math.max(pp, m.pp ?? 0)
      }
    } else {
      // If we have analyser amplitude, use it with smoothing; else subtle fallback
      const amp = getAmplitude?.()
      if (typeof amp === 'number' && !Number.isNaN(amp)) {
        const target = THREE.MathUtils.clamp(0.06 + amp * 0.5, 0, 0.6)
        const prev = mouthOpennessRef.current || 0
        openness = THREE.MathUtils.lerp(prev, target, 0.25)
        mouthOpennessRef.current = openness
      } else if (isSpeaking) {
        const prev = mouthOpennessRef.current || 0
        const target = 0.2 + 0.15 * (0.5 + 0.5 * Math.sin(t * 8))
        openness = THREE.MathUtils.lerp(prev, target, 0.2)
        mouthOpennessRef.current = openness
      }
    }

    // apply morphs
    applyInfl(targets.jawLike, openness)
    applyInfl(targets.smileLike, smile * 0.6)
    applyInfl(targets.aaLike, aa)
    applyInfl(targets.ffLike, ff)
    applyInfl(targets.ppLike, pp)

    // Keep body stable; only tiny breathing handled earlier
    if (groupRef.current) {
      const h = targets.bounds.height || 2.0
      const baseY = -h * 0.62
      // Do not override position.y here
      groupRef.current.position.y = groupRef.current.position.y || baseY
    }
    // Natural hand gestures while speaking (small, smooth)
    const gp = gesturePhaseRef.current
    const speakAmp = Math.min(0.22, 0.08 + (mouthOpennessRef.current || 0) * 0.28)
    const idleAmp = 0.025
    const amp = isSpeaking ? speakAmp : idleAmp
    const freq = isSpeaking ? 1.9 : 0.8

    const lz = amp * Math.sin(t * freq + gp.l)
    const rz = -amp * Math.sin(t * (freq * 0.98) + gp.r)
    const lx = 0.5 * amp * Math.cos(t * (freq * 0.9) + gp.l)
    const rx = 0.5 * amp * Math.cos(t * (freq * 0.95) + gp.r)

    for (const b of targets.leftArm) {
      const r = (b as any).rotation
      r.z = THREE.MathUtils.lerp(r.z || 0, lz, 0.15)
      r.x = THREE.MathUtils.lerp(r.x || 0, lx, 0.12)
    }
    for (const b of targets.rightArm) {
      const r = (b as any).rotation
      r.z = THREE.MathUtils.lerp(r.z || 0, rz, 0.15)
      r.x = THREE.MathUtils.lerp(r.x || 0, rx, 0.12)
    }
  })

  return (
    <group ref={groupRef} position={[0, -1.6, 0]}>
      {/* @ts-ignore primitive accepts Object3D */}
      <primitive object={gltf.scene} position={[0, 0, 0]} />
    </group>
  )
}

// Audio + TTS controller and full-screen presentation
export default function DoctorAvatar({ chatResponse, modelUrl = DEFAULT_MODEL_URL, className, voiceId, ttsProvider = 'elevenlabs', muteAudio = false }: DoctorAvatarProps) {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [phonemes, setPhonemes] = useState<PhonemeTiming[] | null>(null)
  const [audioUnlocked, setAudioUnlocked] = useState(false)

  // WebAudio graph
  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const startTimeRef = useRef<number>(0)

  const ensureAudio = async () => {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    if (audioCtxRef.current.state === 'suspended') {
      try { await audioCtxRef.current.resume() } catch {}
    }
    if (!gainRef.current) gainRef.current = audioCtxRef.current.createGain()
    if (!analyserRef.current) {
      analyserRef.current = audioCtxRef.current.createAnalyser()
      analyserRef.current.fftSize = 2048
    }
    return audioCtxRef.current
  }

  const stopAudio = () => {
    try { sourceRef.current?.stop(); } catch {}
    sourceRef.current?.disconnect(); sourceRef.current = null
    setIsSpeaking(false)
  }

  const base64ToArrayBuffer = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer

  async function speakText(text: string) {
    if (!text || muteAudio) return
    stopAudio()
    const ctx = await ensureAudio()

    try {
      // fetch TTS from our secure API route
      const res = await fetch(`/api/tts?provider=${ttsProvider}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceId })
      })
      if (!res.ok) throw new Error('TTS request failed')
      const payload = await res.json()
      const buf = await ctx.decodeAudioData(base64ToArrayBuffer(payload.audioBase64))

      // optionally provided phonemes from backend
      setPhonemes(Array.isArray(payload.phonemes) ? payload.phonemes as PhonemeTiming[] : null)

      const src = ctx.createBufferSource()
      src.buffer = buf
      const analyser = analyserRef.current!
      const gain = gainRef.current!
      src.connect(analyser)
      analyser.connect(gain)
      gain.connect(ctx.destination)

      startTimeRef.current = ctx.currentTime
      src.onended = () => setIsSpeaking(false)
      src.start(0)
      sourceRef.current = src
      setIsSpeaking(true)
    } catch (e) {
      // Fallback: Web Speech API if TTS API not configured
      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(text)
        u.rate = 1; u.pitch = 1
        u.onstart = () => setIsSpeaking(true)
        u.onerror = () => setIsSpeaking(false)
        u.onend = () => setIsSpeaking(false)
        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(u)
      } else {
        console.warn('No TTS available')
      }
    }
  }

  // react to new chatbot text
  const lastTextRef = useRef<string>('')
  useEffect(() => {
    if (!chatResponse) return
    if (chatResponse === lastTextRef.current) return
    lastTextRef.current = chatResponse
    if (!muteAudio) speakText(chatResponse).catch(() => {})
  }, [chatResponse, muteAudio])

  // make a clock getter used by the model for precise viseme sync
  const audioClock = useMemo<(() => number) | null>(() => {
    return audioCtxRef.current
      ? () => Math.max(0, audioCtxRef.current!.currentTime - startTimeRef.current)
      : null
  }, [isSpeaking])

  // amplitude getter for analyser-based lipsync
  const getAmplitude = useMemo(() => {
    const timeData = new Uint8Array(1024)
    return () => {
      const a = analyserRef.current
      if (!a) return 0
      a.getByteTimeDomainData(timeData)
      // compute normalized RMS around 128
      let sum = 0
      for (let i = 0; i < timeData.length; i++) {
        const v = (timeData[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / timeData.length)
      return Math.min(1, rms * 2.5)
    }
  }, [])

  return (
    <div className={`relative w-full h-[60vh] min-h-[420px] overflow-hidden ${className || ''}`}>
      <div className="absolute inset-0 bg-gradient-to-br from-[#003049] to-[#669bbc]" />
      <div className="absolute inset-0">
        <Canvas
          shadows
          camera={{ position: [0, 1.45, 1.35], fov: 35 }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
          onCreated={({ gl }) => {
            gl.shadowMap.enabled = true
            gl.shadowMap.type = THREE.PCFSoftShadowMap
            gl.toneMapping = THREE.ACESFilmicToneMapping
            ;(gl as any).outputColorSpace = THREE.SRGBColorSpace
            gl.toneMappingExposure = 1.0
          }}
        >
          {/* Key light */}
          <ambientLight intensity={0.5} />
          <directionalLight
            position={[2.5, 4, 2]}
            intensity={1.2}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-bias={-0.0001}
          />
          {/* Fill and rim lights */}
          <directionalLight position={[-3, 2.5, 1]} intensity={0.4} />
          <directionalLight position={[1.5, 2.8, -2.5]} intensity={0.5} color="#88aaff" />

          <Suspense fallback={null}>
            <DrSwasthModel
              isSpeaking={isSpeaking}
              phonemes={phonemes}
              audioClock={audioClock}
              getAmplitude={getAmplitude}
              modelUrl={modelUrl}
            />
            {/* Gentle contact shadow under torso */}
            {/* @ts-ignore - available in drei */}
            <mesh receiveShadow position={[0, -1.6, 0]} visible={false} />
          </Suspense>

          {/* Optional bloom removed (package not installed). Install @react-three/postprocessing to enable. */}
        </Canvas>
      </div>

      {!audioUnlocked && !muteAudio && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <button
            onClick={async () => { await ensureAudio(); setAudioUnlocked(true) }}
            className="px-5 py-3 rounded-xl bg-white text-[#003049] shadow-lg border border-white/60"
          >
            Enable audio
          </button>
        </div>
      )}
    </div>
  )
}
