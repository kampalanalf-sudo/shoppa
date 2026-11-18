// POST /api/topup/claim   { reference }
//
// Recovers a hosted-store top-up that could not be auto-matched, e.g. the buyer
// typed a different email at checkout than the one they registered with.
//
// The DGateway reference is the shared secret: it is in the buyer's payment SMS
// and nowhere public. The credit itself happens inside claim_store_topup, which
// is granted to `authenticated` only and takes the user from auth.uid() — so a
// caller can never credit a wallet other than their own.
import { json, methodNotAllowed, readJson, requireUser, restRpc } from '../_lib/http'

type RpcResult = { ok?: boolean; credited?: boolean; px?: number; balance?: number; replay?: boolean }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return methodNotAllowed()

  const user = await requireUser(req)
  if (!user) return json({ error: 'not signed in' }, 401)

  const body = await readJson<{ reference?: string }>(req)
  const reference = typeof body?.reference === 'string' ? body.reference.trim() : ''
  if (!reference || reference.length > 200) return json({ error: 'reference is required' }, 400)

  try {
    const result = await restRpc<RpcResult>('claim_store_topup', { p_reference: reference })
    return json({
      credited: Boolean(result?.credited),
      replay: Boolean(result?.replay),
      px: result?.px ?? null,
      balance: result?.balance ?? null,
    })
  } catch (e) {
    // The RPC raises a readable message for already-claimed / failed / pending.
    const message = (e as Error).message || ''
    const known =
      /already been claimed|cannot be claimed|still pending|unknown reference/i.test(message)
    if (known) return json({ error: message }, 409)
    console.error('topup claim failed', message)
    return json({ error: 'could not claim this top-up' }, 502)
  }
}

export const config = { runtime: 'nodejs' }
