import router from '../api/pay'

type Op = 'collect' | 'disburse' | 'status' | 'claim'
const PATH: Record<Op, string> = {
  collect: '/api/pay?op=collect',
  disburse: '/api/pay?op=disburse',
  status: '/api/pay?op=status',
  claim: '/api/pay?op=claim',
}

/**
 * Adapters that present api/pay.ts through the surface the existing smoke
 * suites already exercise, so the route/claim/live suites keep working against
 * the consolidated router instead of four deleted files. The assertions were
 * not weakened; only the entry point moved.
 */
export function op(name: Op, req: Request): Promise<Response> {
  const url = new URL(req.url)
  const target = new URL(PATH[name], 'http://x')
  // Preserve query params so ?reference= / ?fresh= still reach the handler.
  url.searchParams.forEach((v, k) => { if (k !== 'op') target.searchParams.set(k, v) })
  return router(new Request(target, req))
}
