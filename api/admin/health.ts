// GET /api/admin/health
//
// Is the platform actually able to do its job?
//
// Every line here is a thing that has silently been broken at least once on
// this project: a feed that stopped syncing, odds that aged past their
// freshness limit, a role without an admin, an SMS provider with no
// credentials. None of them raise an error — the site looks fine and simply
// stops working. This turns them into one page an operator can glance at.
import { requireAdmin } from '../_lib/admin'
import {
  json, methodNotAllowed, restSelect, supabaseAdminConfig,
} from '../_lib/http'

type Check = {
  key: string
  label: string
  state: 'ok' | 'warn' | 'bad'
  detail: string
}

/** Counting rows without pulling them: PostgREST returns the length header. */
async function count(path: string): Promise<number | null> {
  const { url, key, ready } = supabaseAdminConfig()
  if (!ready) return null
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method: 'HEAD',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'count=exact',
        Range: '0-0',
      },
    })
    const range = res.headers.get('content-range')
    if (!range) return null
    const total = Number(range.split('/')[1])
    return Number.isFinite(total) ? total : null
  } catch {
    return null
  }
}

export default async function handler(req: Request): Promise<Response> {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response
  if (req.method !== 'GET') return methodNotAllowed()

  const now = Date.now()
  const checks: Check[] = []

  try {
    const [fixtures, priced, admins, suspendedCount, pendingCashouts] = await Promise.all([
      count('sports_fixtures?status=in.(upcoming,live)'),
      count('sports_markets?is_open=eq.true'),
      restSelect<{ id: string }>('profiles?is_admin=eq.true&select=id'),
      count('profiles?suspended=eq.true'),
      count('cashouts?status=in.(requested,pending_provider)'),
    ])

    // --- board ---
    checks.push({
      key: 'fixtures',
      label: 'Fixtures on the board',
      state: (fixtures ?? 0) > 0 ? 'ok' : 'warn',
      detail:
        (fixtures ?? 0) > 0
          ? `${fixtures} upcoming or live`
          : 'none — the odds feed may not be syncing (cron: /api/feed/settle at 03:25 UTC)',
    })

    checks.push({
      key: 'priced',
      label: 'Markets open for betting',
      state: (priced ?? 0) > 0 ? 'ok' : 'warn',
      detail: (priced ?? 0) > 0 ? `${priced} open` : 'no open markets — players cannot place a bet',
    })

    // --- newest price ---
    const newest = await restSelect<{ price_at: string; name: string }>(
      'sports_selections?is_active=eq.true&select=price_at,name&order=price_at.desc&limit=1',
    )
    if (newest[0]) {
      const ageMins = Math.floor((now - new Date(newest[0].price_at).getTime()) / 60_000)
      checks.push({
        key: 'price_age',
        label: 'Newest price',
        state: ageMins > 360 ? 'bad' : ageMins > 120 ? 'warn' : 'ok',
        detail: `${ageMins} min old — a stale price is a price a player can beat`,
      })
    }

    // --- admins ---
    checks.push({
      key: 'admins',
      label: 'Admin accounts',
      state: admins.length === 1 ? 'warn' : admins.length === 0 ? 'bad' : 'ok',
      detail:
        admins.length === 0
          ? 'nobody can reach the admin screens'
          : admins.length === 1
            ? 'only one — if it is lost, there is no way back in'
            : `${admins.length} accounts`,
    })

    // --- withdrawals ---
    checks.push({
      key: 'cashouts',
      label: 'Withdrawals waiting',
      state: (pendingCashouts ?? 0) > 0 ? 'warn' : 'ok',
      detail:
        (pendingCashouts ?? 0) > 0
          ? `${pendingCashouts} awaiting a decision — every hour is a player who thinks we kept it`
          : 'queue empty',
    })

    // --- phones ---
    // The OTP provider is separate from this app and cannot be tested from
    // here, so this reports the population instead: if players are verifying,
    // the credential works.
    const verified = await count('profiles?phone_verified=eq.true')
    const total = await count('profiles')
    checks.push({
      key: 'phone',
      label: 'Verified phone numbers',
      state: (verified ?? 0) > 0 ? 'ok' : 'warn',
      detail:
        (verified ?? 0) > 0
          ? `${verified} of ${total ?? '?'} players`
          : 'nobody has ever verified a phone — check the Twilio credentials before blaming the app',
    })

    checks.push({
      key: 'suspended',
      label: 'Suspended accounts',
      state: 'ok',
      detail: `${suspendedCount ?? 0} suspended`,
    })

    return json({ checks, environment: { checked_at: new Date().toISOString() } })
  } catch (e) {
    console.error('admin health failed', (e as Error).message)
    return json({ error: 'could not run the health checks' }, 502)
  }
}

export const config = { runtime: 'nodejs' }
