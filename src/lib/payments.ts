import { useEffect, useRef, useState } from 'react'
import { api } from './api'

/**
 * Client helpers for the payment routes.
 *
 * The browser never talks to DGateway and never sees the API key: it calls our
 * own server routes, which hold the key. Those routes are Supabase Edge
 * Functions (`pay?op=...`); `apiUrl()` maps the old `/api/...` names onto them.
 */

export type PaymentState = 'idle' | 'pending' | 'completed' | 'failed' | 'timeout' | 'error'

export type CollectResponse = {
  reference: string
  status: string
  provider: string | null
  orderId: string
  message: string
}

const post = <T,>(path: string, body: unknown): Promise<T> =>
  api<T>(path, { method: 'POST', body })

/** Start a top-up. Opens a mobile-money prompt on the payer's phone. */
export function collect(input: {
  amount: number
  currency?: string
  phone: string
  description?: string
}): Promise<CollectResponse> {
  return post<CollectResponse>('/api/collect', input)
}

/** Send a withdrawal payout to any MTN/Airtel number. */
export function disburse(input: {
  amount: number
  currency?: string
  phone: string
  description?: string
  cashoutId?: string
}): Promise<CollectResponse> {
  return post<CollectResponse>('/api/disburse', input)
}

export type StatusResponse = {
  reference: string
  status: 'pending' | 'completed' | 'failed'
  rawStatus?: string
  provider?: string | null
  amount?: number | null
  currency?: string | null
  failureReason?: string | null
  pollAfterMs?: number
}

/** One status read through our server proxy. */
export async function fetchStatus(reference: string, fresh = false): Promise<StatusResponse> {
  return api<StatusResponse>('/api/status', {
    params: { reference, ...(fresh ? { fresh: '1' } : {}) },
  })
}

const POLL_MS = 10_000
const GIVE_UP_MS = 5 * 60 * 1000

/**
 * Polls /api/status every 10 seconds until the payment is terminal, and gives
 * up after 5 minutes. Never polls faster than the spec allows — the server also
 * memoises each reference for 10s, so extra tabs cannot multiply the rate.
 */
export function usePaymentPoll(reference: string | null) {
  const [state, setState] = useState<PaymentState>('idle')
  const [detail, setDetail] = useState<StatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const startedRef = useRef<number>(0)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!reference) {
      setState('idle')
      setDetail(null)
      setError(null)
      setElapsed(0)
      return
    }

    let cancelled = false
    startedRef.current = Date.now()
    setState('pending')
    setError(null)

    const tick = async () => {
      if (cancelled) return
      const ms = Date.now() - startedRef.current
      setElapsed(ms)

      if (ms > GIVE_UP_MS) {
        setState('timeout')
        return
      }

      try {
        const res = await fetchStatus(reference)
        if (cancelled) return
        setDetail(res)
        if (res.status === 'completed') {
          setState('completed')
          return
        }
        if (res.status === 'failed') {
          setState('failed')
          return
        }
      } catch (e) {
        if (cancelled) return
        // Transient: keep polling, but surface the message.
        setError((e as Error).message)
      }

      timerRef.current = window.setTimeout(tick, POLL_MS)
    }

    void tick()

    return () => {
      cancelled = true
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [reference])

  return {
    state,
    detail,
    error,
    elapsed,
    /** What to show the player while we wait. */
    message:
      state === 'pending'
        ? 'Check your phone and approve the prompt'
        : state === 'completed'
          ? 'Payment confirmed'
          : state === 'failed'
            ? 'Payment failed'
            : state === 'timeout'
              ? 'Still waiting — we will update this automatically'
              : null,
  }
}

// ------------------------------------------------------------- hosted mode --

/**
 * Hosted checkout, ZENGAPAY's own payment page.
 *
 * Unlike the old DGateway storefront this is not a static per-merchant URL:
 * the server creates a session and returns its one-time URL, so nothing about
 * the merchant is baked into the bundle and the API token never reaches the
 * browser.
 *
 * Returns null when the server cannot create a session, and the caller falls
 * back to the in-app mobile-money prompt.
 */
export async function startHostedCheckout(ugx: number): Promise<string | null> {
  if (!Number.isInteger(ugx) || ugx <= 0) return null
  const res = await api<{ url?: string }>('/api/pay?op=checkout', {
    method: 'POST',
    body: { amount: ugx, currency: 'UGX' },
  })
  return res.url ?? null
}

/** Where the player lands after paying. Cosmetic only — the webhook credits. */
export function successReturnUrl(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/#topup-success`
}
