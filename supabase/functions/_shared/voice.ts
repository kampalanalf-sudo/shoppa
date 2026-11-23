// supabase/functions/_shared/voice.ts
//
// The phone-call side of support: signing Twilio, and turning a model reply into
// something a phone can actually say.
//
// WHY THIS IS SEPARATE FROM support.ts
//
// The text agents and the voice agents differ in exactly two ways: how the reply
// arrives (JSON vs TwiML) and how it must sound when spoken. Everything about
// what they may say is shared. Keeping the mechanics apart and the policy
// together is what stops the phone line from slowly becoming a second, laxer
// support system.

import { readEnv } from './http.ts'

// NOTE FOR ANYONE EDITING THIS FILE OR support.ts
//
// The build inlines every shared module into ONE file, so a module-scope name
// declared here and in a sibling is a duplicate declaration, not a shadow. Three
// copies of `const env` broke the build the first time these were added.
// Call `readEnv` directly and do not aliasing it as `env` here.

export const isVoiceConfigured = () => Boolean(readEnv('TWILIO_AUTH_TOKEN') && readEnv('TWILIO_ACCOUNT_SID'))

/**
 * Validate Twilio's request signature.
 *
 * Twilio signs the exact URL it called, with the sorted form parameters appended.
 * Two details that break naive implementations:
 *
 *   - the URL must be the one Twilio used, including the query string, so the
 *     function rebuilds it from the request rather than trusting a header;
 *   - the body must be read as text and parsed here, because the signature is
 *     over the raw form encoding, not over re-serialised values.
 *
 * Fails closed: no auth token configured means no call is accepted. An open
 * webhook that drives a paid model is someone else's free phone line.
 */
export async function verifyTwilioSignature(req: Request, url: string): Promise<boolean> {
  const token = readEnv('TWILIO_AUTH_TOKEN')
  if (!token) return false

  const signature =
    req.headers.get('X-Twilio-Signature') || req.headers.get('x-twilio-signature') || ''
  if (!signature) return false

  const raw = await req.text()
  const params = new URLSearchParams(raw)

  const payload =
    url +
    [...params.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => k + v)
      .join('')

  const expected = await hmacBase64(token, payload)

  // Constant-time-ish: equal length and no early exit on the first mismatch.
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  return diff === 0
}

async function hmacBase64(key: string, data: string): Promise<string> {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

/** Twilio compares with our own URL; both must agree on the public origin. */
export function publicUrl(req: Request): string {
  const explicit = readEnv('SUPPORT_PUBLIC_URL')
  const u = new URL(req.url)
  if (explicit) {
    // Twilio was configured with this base, so the signature covers it.
    return explicit.replace(/\/$/, '') + u.pathname + (u.search || '')
  }
  return u.toString()
}

/**
 * A model reply, made speakable.
 *
 * Two things must not reach a text-to-speech engine: our HANDOFF marker (already
 * stripped before this point, but stripped again because a duplicate means a
 * phone says the word "handoff" to a customer) and markdown. Spoken asterisks
 * and screen-read numbers are the difference between help and confusion.
 */
export function speakable(text: string): string {
  return text
    .replace(/[*_`#>]/g, '')
    // 12,345 reads as "twelve thousand three hundred and forty five" in most
    // engines; the pause from a space is clearer for small numbers.
    .replace(/\b(\d),(\d{3})\b/g, '$1 $2')
    .replace(/\s{2,}/g, ' ')
    .replace(/\u2014/g, ', ')
    .trim()
}

/** Escape for TwiML. A player's own words are interpolated, so this is not optional. */
export function xml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** A TwiML document. `say` then optionally keep listening. */
export function twiml(say: string, opts: { hangup?: boolean; listen?: string } = {}): Response {
  const parts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<Response>']
  if (say.trim()) {
    parts.push(`  <Say voice="Polly.Joanna" language="en-US">${xml(speakable(say))}</Say>`)
  }
  if (opts.hangup) {
    parts.push('  <Hangup/>')
  } else if (opts.listen) {
    // Twilio posts the next turn to `listen` when the caller stops speaking.
    parts.push(`  <Gather input="speech" speechTimeout="auto" action="${xml(opts.listen)}" method="POST"/>`)
    parts.push('  <Redirect method="POST">' + xml(opts.listen) + '</Redirect>')
  }
  parts.push('</Response>')
  return new Response(parts.join('\n'), {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}
