// src/lib/session.ts
//
// Telling the server where this session is, once it is actually signed in.
//
// THE QUESTION THIS ANSWERS
//
//   "Take note of the location and IP address of the players for security
//   reasons."
//
// The IP is not ours to send: a browser cannot know its own public address, and
// anything it could claim would be worthless as evidence. `supabase/functions/
// session` reads it from the request headers at the edge and writes it as the
// player. What this file adds is the one thing only the client can offer — the
// device's position, and only if the player allows it.
//
// WHAT IT DOES WITH THAT
//
// Nothing until a session exists, then one call per sign-in and at most one
// every half hour. The server enforces that interval as well (`record_session`),
// so a tab that reloads in a loop cannot turn this into a movement log. A bet, a
// spin and a page view record nothing at all: a gambling app that logs a location
// per spin has built a surveillance device, and it would not have stopped the bug
// that made spins fail.
//
// WHAT IT DOES NOT DO WITH THAT
//
// No dialog on load. Asking for a position the instant the app opens, before the
// player has done anything, is how a permissions prompt gets denied forever. The
// position is requested only after a sign-in or a returning session has settled,
// it never blocks the UI, and a refusal is not an error — the address is still
// recorded, which is the part that matters.
import { callFunction } from './supabase'

const HEARTBEAT_MS = 30 * 60 * 1000
const LAST_SENT_KEY = 'shoppa.session.last-ping'

/** Positions older than this are not worth sending; a cached fix may be hours old. */
const MAX_FIX_AGE_MS = 5 * 60 * 1000

type Fix = {
  lat: number
  lng: number
  accuracy: number
  source: 'gps' | 'network'
}

let inflight: Promise<void> | null = null

/**
 * A position, if we can get one quickly and without training the player to say no.
 *
 * `enableHighAccuracy: false` on purpose. GPS takes seconds, drains the battery and
 * pops the system dialog; a network fix is a few hundred metres, which is already
 * more precision than we keep — the database rounds to two decimal places (~1 km).
 * Precision we immediately throw away is not worth a second of the player's time.
 */
function deviceFix(timeoutMs = 4000): Promise<Fix | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null)
  }
  // A denied permission never prompts again; short-circuit so we do not ask the
  // browser for something it has already refused.
  if (typeof navigator.permissions?.query === 'function') {
    // fire-and-forget: a rejection here just means we try the normal path
    void navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (status.state === 'denied') denied = true
      })
      .catch(() => undefined)
  }
  if (denied) return Promise.resolve(null)

  return new Promise((resolve) => {
    let settled = false
    const done = (fix: Fix | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(fix)
    }

    const timer = setTimeout(() => done(null), timeoutMs)

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // A fix from an old cache can describe where the phone used to be. Not
        // worth sending, and misleading in exactly the case this feature exists
        // for — "the account signed in from somewhere else".
        if (Date.now() - pos.timestamp > MAX_FIX_AGE_MS) return done(null)
        done({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          source: pos.coords.accuracy <= 100 ? 'gps' : 'network',
        })
      },
      () => done(null), // denied, unavailable, or timed out: the IP still goes
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: MAX_FIX_AGE_MS },
    )
  })
}

let denied = false

function recentlySent(): boolean {
  try {
    const raw = localStorage.getItem(LAST_SENT_KEY)
    if (!raw) return false
    return Date.now() - Number(raw) < HEARTBEAT_MS
  } catch {
    return false
  }
}

function markSent() {
  try {
    localStorage.setItem(LAST_SENT_KEY, String(Date.now()))
  } catch {
    // private mode, quota: the server rate-limits anyway
  }
}

/**
 * Record this session's address and (if allowed) location.
 *
 * `event: 'sign_in'` always sends — it happens once, and it is the entry that
 * answers "where was this account when it first appeared". A heartbeat is skipped
 * when one was sent in the last half hour.
 *
 * Every failure is swallowed. This is evidence for later review, not a gate: a
 * player whose location could not be recorded must still be able to play.
 */
export function noteSession(event: 'sign_in' | 'heartbeat' = 'heartbeat'): Promise<void> {
  if (event === 'heartbeat' && recentlySent()) return Promise.resolve()
  if (inflight) return inflight

  inflight = (async () => {
    const fix = await deviceFix()
    try {
      await callFunction('session', {
        event,
        ...(fix
          ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, source: fix.source }
          : {}),
      })
      markSent()
    } catch {
      // Signed out, offline, or the function is not deployed yet. The next
      // sign-in or the next half hour tries again.
    } finally {
      inflight = null
    }
  })()

  return inflight
}

/** Forget the throttle, so the next sign-in records even within the half hour. */
export function forgetSessionPing() {
  try {
    localStorage.removeItem(LAST_SENT_KEY)
  } catch {
    /* nothing to clear */
  }
}
