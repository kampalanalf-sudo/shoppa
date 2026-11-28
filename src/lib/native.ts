// src/lib/native.ts
//
// The Android app's own capabilities, reached from the web layer.
//
// The app is a Capacitor WebView, so this file is the ONLY place that talks to
// the Java bridge (`FloatBetNative`, added in MainActivity). Two rules:
//
//   1. Anything that cannot be done (a browser tab, a denied permission, an
//      older APK) returns a plain "unavailable" answer. Nothing throws into a
//      React render.
//   2. Nothing here reads an SMS or a position on its own. `smsConfirmations()`
//      and `lastKnownLocation()` are called from a screen, after the player has
//      pressed a button. A permission that is collected at start-up is a
//      permission the player never had a chance to think about.

export type NativeStatus = {
  sms: boolean
  location: boolean
  notifications: boolean
  platform: 'android' | 'web'
  sdk?: number
}

type Bridge = {
  status(): string
  request(which: string): void
  recentSms(): string
  location(): string
}

const bridge = (): Bridge | null => {
  const b = (globalThis as unknown as { FloatBetNative?: Bridge }).FloatBetNative
  return b ?? null
}

/** True inside the Android app; false in a browser or the PWA. */
export const isNativeApp = () => bridge() !== null

const parse = <T,>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function nativeStatus(): NativeStatus {
  const b = bridge()
  if (!b) return { sms: false, location: false, notifications: false, platform: 'web' }
  return parse<NativeStatus>(b.status(), {
    sms: false,
    location: false,
    notifications: false,
    platform: 'web',
  })
}

/**
 * Ask for a permission.
 *
 * Returns immediately: Android shows its own dialog and the answer arrives as a
 * change in `nativeStatus()` on the next call. Polling from the caller is
 * deliberate — there is no permission callback in the bridge, and inventing a
 * promise that might never resolve would be worse than a re-read.
 */
export function requestPermission(which: 'sms' | 'location' | 'notifications') {
  bridge()?.request(which)
}

export type SmsConfirmation = {
  address: string
  body: string
  date: number
}

/**
 * Mobile-money confirmations, newest first. Empty when the permission is absent,
 * when this is not the app, or when there are none.
 *
 * The result is used to notice that a deposit landed — never to take a decision
 * about money. The wallet is credited by the webhook; this only makes the screen
 * refresh sooner.
 */
export function smsConfirmations(): SmsConfirmation[] {
  const b = bridge()
  if (!b) return []
  return parse<SmsConfirmation[]>(b.recentSms(), [])
}

export type NativeLocation =
  | { ok: false; granted: boolean }
  | { ok: true; lat: number; lng: number; accuracy: number; age_ms: number; granted?: boolean }

export function lastKnownLocation(): NativeLocation {
  const b = bridge()
  if (!b) return { ok: false, granted: false }
  return parse<NativeLocation>(b.location(), { ok: false, granted: false })
}

/**
 * The most recent confirmation that mentions a given amount, if any.
 *
 * This is a UI convenience: it lets the deposit screen say "the network's message
 * just arrived" instead of "still waiting". It does NOT credit anything, and a
 * forged SMS changes nothing — the credit still comes from the provider's own
 * webhook, verified against its API.
 */
export function confirmationFor(amount: number, sinceMs = 15 * 60 * 1000): SmsConfirmation | null {
  const cutoff = Date.now() - sinceMs
  const want = Math.round(amount).toLocaleString('en-US')
  const plain = String(Math.round(amount))
  for (const m of smsConfirmations()) {
    if (m.date < cutoff) continue
    if (m.body.includes(want) || m.body.includes(plain)) return m
  }
  return null
}
