'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import DoctorAvatar from '@/components/DoctorAvatar'
import HeygenRealtime from '@/components/HeygenRealtime'
import { Mic, MicOff, Video, VideoOff, PhoneOff, RefreshCw } from 'lucide-react'
import { useSpeechRecognition } from 'react-speech-kit'

// Lightweight live session that feels like a video call with Dr. Swasth
export default function DoctorLive() {
  const [connected, setConnected] = useState(true)
  const [cameraOn, setCameraOn] = useState(true)
  const [micOn, setMicOn] = useState(false)
  const [messages, setMessages] = useState<Array<{sender: 'user'|'bot'; text: string; at: number}>>([
    { sender: 'bot', text: "Hello! I’m Dr. Swasth. Tell me what’s on your mind today.", at: Date.now() }
  ])
  const [useHumanAvatar, setUseHumanAvatar] = useState(false)

  // Webcam preview
  const videoRef = useRef<HTMLVideoElement>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    const startCam = async () => {
      if (!cameraOn) return stopCam()
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        mediaStreamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
      } catch (e) {
        setCameraOn(false)
      }
    }
    const stopCam = () => {
      mediaStreamRef.current?.getTracks().forEach(t => t.stop())
      mediaStreamRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null
    }
    startCam()
    return stopCam
  }, [cameraOn])

  // STT push-to-talk
  const [transcript, setTranscript] = useState('')
  const { listen, listening, stop, supported: sttSupported } = useSpeechRecognition({
    onResult: (t: string) => setTranscript(t),
    onEnd: () => {
      const text = transcript.trim()
      if (text) sendUser(text)
      setTranscript('')
      setMicOn(false)
    },
  })

  const lastBot = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].sender === 'bot') return messages[i].text
    return ''
  }, [messages])

  function sendUser(text: string) {
    setMessages(prev => [...prev, { sender: 'user', text, at: Date.now() }])
    // Simulate doctor thinking then replying (replace with real API call)
    setTimeout(() => {
      const reply = getDoctorReply(text)
      setMessages(prev => [...prev, { sender: 'bot', text: reply, at: Date.now() }])
    }, 900)
  }

  function getDoctorReply(input: string) {
    const s = input.toLowerCase()
    if (s.includes('cold') || s.includes('cough'))
      return 'It sounds like an upper respiratory infection. Hydration, rest, and steam inhalation can help. If fever persists > 3 days, consult in person.'
    if (s.includes('diet'))
      return 'Aim for a balanced plate: half veggies, a quarter lean protein, a quarter whole grains. Limit added sugar and ultra-processed foods.'
    if (s.includes('stress'))
      return 'Try 4-7-8 breathing for 2 minutes, a 10-minute walk, and consistent sleep. If anxiety interferes with daily life, consider counseling.'
    return 'Thanks for sharing. I can give general guidance, but this is not a diagnosis. Tell me your key symptoms, duration, and any medications.'
  }

  function toggleMic() {
    if (!sttSupported) return
    if (listening) {
      stop(); setMicOn(false)
    } else {
      setTranscript(''); listen({ interimResults: true }); setMicOn(true)
    }
  }

  if (!connected) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-cyan-50">
        <button onClick={() => setConnected(true)} className="px-6 py-3 rounded-xl bg-blue-600 text-white shadow-lg">Rejoin Dr. Swasth</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#003049] to-[#669bbc]">
      <div className="container mx-auto p-4 max-w-7xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Doctor large tile */}
          <div className="lg:col-span-2">
            <div className="bg-white/90 backdrop-blur rounded-2xl border border-white/30 shadow-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm text-blue-900/80">Live with Dr. Swasth</div>
                <button
                  onClick={() => setUseHumanAvatar(v=>!v)}
                  className="px-3 py-2 rounded-lg border border-white/40 text-blue-900 flex items-center gap-2 bg-white/60"
                >
                  <RefreshCw className="w-4 h-4" />
                  {useHumanAvatar ? 'Switch to 3D' : 'Switch to Human'}
                </button>
              </div>
              {useHumanAvatar ? (
                <HeygenRealtime />
              ) : (
                <DoctorAvatar chatResponse={lastBot} className="w-full" />
              )}
            </div>
          </div>

          {/* User preview + chat */}
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-white rounded-2xl border border-blue-100 shadow-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-blue-900">You</h3>
                <div className="flex gap-2">
                  <button onClick={() => setCameraOn(v => !v)} className={`px-3 py-2 rounded-lg border ${cameraOn?'border-blue-200 text-blue-700':'border-gray-300 text-gray-500'}`}>
                    {cameraOn ? <Video className="w-5 h-5"/> : <VideoOff className="w-5 h-5"/>}
                  </button>
                  <button onClick={toggleMic} disabled={!sttSupported} className={`px-3 py-2 rounded-lg border ${micOn?'border-red-300 text-red-600':'border-blue-200 text-blue-700'}`}>
                    {micOn ? <MicOff className="w-5 h-5"/> : <Mic className="w-5 h-5"/>}
                  </button>
                  <button onClick={() => setConnected(false)} className="px-3 py-2 rounded-lg border border-red-300 text-red-600">
                    <PhoneOff className="w-5 h-5"/>
                  </button>
                </div>
              </div>
              <div className="aspect-video bg-black/5 rounded-lg overflow-hidden">
                <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
              </div>
              <div className="mt-3 text-xs text-gray-500">
                {sttSupported ? (listening ? 'Listening… speak now' : 'Press mic to talk') : 'Speech recognition not supported in this browser.'}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-blue-100 shadow-xl p-4 h-[300px] overflow-y-auto space-y-3">
              {messages.map((m, i) => (
                <div key={i} className={`max-w-[85%] px-3 py-2 rounded-xl ${m.sender==='user'?'ml-auto bg-blue-600 text-white':'bg-blue-50 text-blue-900'}`}>{m.text}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
