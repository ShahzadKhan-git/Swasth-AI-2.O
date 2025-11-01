import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const { sdp } = await req.json()
    const apiKey = process.env.HEYGEN_API_KEY || process.env.NEXT_PUBLIC_HEYGEN_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Missing HEYGEN_API_KEY' }, { status: 500 })
    }

    // Exchange SDP with HeyGen Realtime (adjust endpoint/params as needed for your account)
    const offerUrl = process.env.HEYGEN_OFFER_URL || 'https://api.heygen.com/v1/realtime/offer'
    const resp = await fetch(offerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey as string,
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        sdp,
        // Generic non-personalized preset
        voice: process.env.HEYGEN_VOICE || 'en-US-Jenny',
        avatar_id: process.env.HEYGEN_AVATAR_ID || 'professional_female_doctor',
        enable_audio: true,
        enable_video: true,
      }),
    })

    if (!resp.ok) {
      const text = await resp.text()
      return NextResponse.json({ error: 'HeyGen error', status: resp.status, urlTried: offerUrl, details: text }, { status: 502 })
    }

    const data = await resp.json()
    // Expecting { sdp: answer }
    return NextResponse.json({ sdp: data.sdp })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Unknown error' }, { status: 500 })
  }
}
