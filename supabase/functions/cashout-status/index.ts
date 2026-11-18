// POST /functions/v1/cashout-status  { cashoutId }
// Player-facing poll. Falls back to a provider re-check so a missed webhook
// cannot strand a payout in pending_provider forever.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { fetchTransactionStatus, json, normalizeStatus } from '../_shared/dgateway.ts'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'not authenticated' }, 401)

  const { cashoutId } = await req.json().catch(() => ({}))
  if (!cashoutId) return json({ error: 'cashoutId is required' }, 400)

  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: cashout } = await admin
    .from('cashouts').select('*').eq('id', cashoutId).eq('user_id', user.id).maybeSingle()
  if (!cashout) return json({ error: 'cashout not found' }, 404)

  if (cashout.status === 'pending_provider' && cashout.provider_ref) {
    try {
      const tx = await fetchTransactionStatus(cashout.provider_ref)
      const status = normalizeStatus(tx.status)
      if (status !== 'pending') {
        await admin.rpc('settle_cashout', {
          p_cashout: cashout.id,
          p_status: status === 'completed' ? 'paid' : 'failed',
          p_reason: status === 'failed' ? (tx.failure_reason || 'provider reported failure') : null,
        })
        return json({ status: status === 'completed' ? 'paid' : 'failed' })
      }
    } catch {
      /* fall through and report the stored state */
    }
  }

  return json({ status: cashout.status, ugx: cashout.ugx, amountPx: cashout.amount_px })
})
