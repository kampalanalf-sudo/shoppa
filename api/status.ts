// GET /api/status?reference=...
//
// Server-side status proxy. The client polls THIS route every 10 seconds; it
// never calls DGateway directly, because that would expose the API key.
//
// Rate limiting: the spec says never poll DGateway faster than every 10s.
// We therefore memoise each reference for 10 seconds, so even if ten tabs poll
// at once only one upstream request per reference is made per window.
import { GatewayError, fetchTransactionStatus, normalizeStatus } from './_lib/dgateway'
import { json, methodNotAllowed, preflight, requireUser } from './_lib/http'

const MIN_INTERVAL_MS = 10_000

type CacheEntry = { at: number; payload: StatusPayload }
type StatusPayload = {
  reference: string
  status: 'pending' | 'completed' | 'failed'
  rawStatus?: string
  provider?: string | null
  amount?: number | null
  currency?: string | null
  failureReason?: string | null
}

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<StatusPayload>>()

function gc() {
  const cutoff = Date.now() - 5 * 60_000
  for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k)
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'GET') return methodNotAllowed()

  const user = await requireUser(req)
  if (!user) return json({ error: 'not authenticated' }, 401)

  const url = new URL(req.url)
  const reference = (url.searchParams.get('reference') || '').trim()
  if (!reference) return json({ error: 'reference is required' }, 400)

  // Serve from the 10-second window unless the caller demands freshness.
  const fresh = url.searchParams.get('fresh') === '1'
  const hit = cache.get(reference)
  if (!fresh && hit && Date.now() - hit.at < MIN_INTERVAL_MS) {
    return json({ ...hit.payload, cached: true, pollAfterMs: MIN_INTERVAL_MS })
  }

  // Collapse concurrent polls for the same reference into one upstream call.
  let pending = inflight.get(reference)
  if (!pending) {
    pending = (async (): Promise<StatusPayload> => {
      const tx = await fetchTransactionStatus(reference)
      const payload: StatusPayload = {
        reference,
        status: normalizeStatus(tx.status),
        rawStatus: tx.status,
        provider: tx.provider ?? null,
        amount: tx.amount ?? null,
        currency: tx.currency ?? null,
        failureReason: tx.failure_reason ?? null,
      }
      cache.set(reference, { at: Date.now(), payload })
      gc()
      return payload
    })().finally(() => inflight.delete(reference))
    inflight.set(reference, pending)
  }

  try {
    const payload = await pending
    return json({ ...payload, cached: false, pollAfterMs: MIN_INTERVAL_MS })
  } catch (e) {
    const err = e as GatewayError
    // Keep the last known good state on a transient upstream failure so the UI
    // does not flap back to "unknown".
    if (hit) return json({ ...hit.payload, cached: true, stale: true, pollAfterMs: MIN_INTERVAL_MS })
    return json({ error: err.message, code: err.code }, err.httpStatus || 502)
  }
}

export const config = { runtime: 'nodejs' }
