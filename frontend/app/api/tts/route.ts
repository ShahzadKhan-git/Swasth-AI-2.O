import { NextRequest, NextResponse } from 'next/server'

// Convert ArrayBuffer to base64 string
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return Buffer.from(binary, 'binary').toString('base64')
}

export async function POST(req: NextRequest) {
  try {
    const { text, provider = 'elevenlabs', voiceId } = await req.json()
    if (!text || typeof text !== 'string') return NextResponse.json({ error: 'Missing text' }, { status: 400 })

    if (provider === 'elevenlabs') {
      const apiKey = process.env.ELEVENLABS_API_KEY
      if (!apiKey) return NextResponse.json({ error: 'ELEVENLABS_API_KEY not set' }, { status: 500 })
      const voice = voiceId || '21m00Tcm4TlvDq8ikWAM' // Rachel default

      const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}`
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: { stability: 0.5, similarity_boost: 0.8 },
        }),
        // cache: 'no-store'
      })
      if (!resp.ok) {
        const msg = await resp.text().catch(() => '')
        return NextResponse.json({ error: 'TTS failed', details: msg }, { status: 500 })
      }
      const arr = await resp.arrayBuffer()
      const audioBase64 = arrayBufferToBase64(arr)

      // Note: ElevenLabs phoneme timeline requires different API (not covered here).
      // Frontend will fall back to analyser-driven lip sync when phonemes are absent.
      return NextResponse.json({ audioBase64, phonemes: null })
    }

    if (provider === 'google') {
      const key = process.env.GOOGLE_TTS_API_KEY
      if (!key) return NextResponse.json({ error: 'GOOGLE_TTS_API_KEY not set' }, { status: 500 })
      const ttsRes = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'en-US', name: 'en-US-Neural2-C' },
          audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0 },
        }),
      })
      const data = await ttsRes.json()
      if (!ttsRes.ok || !data.audioContent) return NextResponse.json({ error: 'Google TTS failed', details: data }, { status: 500 })
      return NextResponse.json({ audioBase64: data.audioContent, phonemes: null })
    }

    return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: 'Server error', details: e?.message || String(e) }, { status: 500 })
  }
}