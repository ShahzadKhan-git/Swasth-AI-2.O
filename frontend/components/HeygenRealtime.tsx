'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'

export default function HeygenRealtime() {
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [status, setStatus] = useState<string>('')
  const [nonce, setNonce] = useState(0)

  const cleanup = useCallback(() => {
    try { pcRef.current?.getSenders().forEach(s => { try { s.track?.stop() } catch {} }) } catch {}
    try { localStreamRef.current?.getTracks().forEach(t=>t.stop()) } catch {}
    try { pcRef.current?.close() } catch {}
    pcRef.current = null
    localStreamRef.current = null
  }, [])

  const connect = useCallback(async () => {
    setConnecting(true)
    setConnected(false)
    setStatus('Requesting microphone…')

    const pc = new RTCPeerConnection({ iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] })
    pcRef.current = pc

    const remoteStream = new MediaStream()
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream
    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach((t) => remoteStream.addTrack(t))
    }
    pc.onconnectionstatechange = () => {
      setStatus(pc.connectionState)
      if (pc.connectionState === 'connected') setConnected(true)
    }

    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      localStreamRef.current = mic
      for (const track of mic.getTracks()) {
        if (pc.signalingState !== 'closed') pc.addTrack(track, mic)
      }
    } catch (e:any) {
      setStatus('Microphone permission denied')
      cleanup(); setConnecting(false)
      return
    }

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      setStatus('Contacting avatar…')
      const res = await fetch('/api/heygen/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp: offer.sdp }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Offer exchange failed')
      }
      const data = await res.json()
      await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp })
      setStatus('Connected')
    } catch (e:any) {
      setStatus(`Failed: ${e?.message || e}`)
      cleanup()
    } finally {
      setConnecting(false)
    }
  }, [cleanup])

  useEffect(() => {
    connect()
    return cleanup
  }, [connect, cleanup, nonce])

  return (
    <div className="relative rounded-2xl overflow-hidden border border-blue-100 shadow-xl">
      <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-[380px] object-cover bg-black/5" />
      {(!connected || connecting) && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-600">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
            <div>{status || 'Connecting avatar…'}</div>
            <button
              className="mt-3 px-3 py-1.5 rounded-lg border border-blue-200 text-blue-700"
              onClick={() => setNonce(n => n+1)}
              disabled={connecting}
            >Retry</button>
          </div>
        </div>
      )}
    </div>
  )
}
