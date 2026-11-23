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

// ---------------------------------------------------------------- store mode --

/**
 * Hosted-store checkout. The buyer pays on DGateway's own page, so this is a
 * plain navigation — the browser only follows a link, which is why it also
 * works on GitHub Pages where /api routes do not exist.
 *
 * Safe to call with no reference: the return trip cannot carry our order_id,
 * which is exactly why the browser return is cosmetic and the webhook is the
 * only thing that credits.
 */
export function storeUrl(ugx: number): string | null {
  const base = (import.meta.env.VITE_DGATEWAY_STORE_URL as string | undefined)?.trim()
  if (!base || base === 'off') return null
  try {
    const url = new URL(base)
    if (Number.isInteger(ugx) && ugx > 0) url.searchParams.set('amount', String(ugx))
    return url.toString()
  } catch {
    return null
  }
}

export function storeEnabled(): boolean {
  const base = (import.meta.env.VITE_DGATEWAY_STORE_URL as string | undefined)?.trim()
  return Boolean(base && base !== 'off')
}

/** The URL we tell DGateway to send the buyer back to. Cosmetic only. */
export function successReturnUrl(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/#topup-success`
}
