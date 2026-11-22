// api/admin/ops.ts
//
// One serverless function behind every admin screen.
//
// WHY THIS IS ONE FUNCTION AND NOT FOUR
//
// The Vercel Hobby plan allows 12 Serverless Functions per deployment and the
// project sits exactly on that ceiling. Splitting health, cashouts, audit and
// actions into four files pushed the count to 16 and the production deploy
// failed with `exceeded_serverless_functions_per_deployment` -- after the merge,
// with the site still serving the previous build.
//
// The alternative to merging was deleting an endpoint that does real work, so
// these four share a router instead. vercel.json rewrites the old paths here,
// so every caller and every existing URL keeps working unchanged:
//
//   /api/admin/health    -> ?op=health
//   /api/admin/cashouts  -> ?op=cashouts
//   /api/admin/audit     -> ?op=audit
//   /api/admin/actions   -> ?op=actions   (POST)
//
// Everyone still gets requireAdmin() once, at the top, before the router runs.
// That is the one property that must not vary between operations.
import { requireAdmin } from '../_lib/admin'
import {
  GatewayError, assertLiveSafety, disbursePayment, normalizePhone,
} from '../_lib/dgateway'
import {
  json, methodNotAllowed, readJson, restRpc, restSelect, supabaseAdminConfig,
} from '../_lib/http'

// ---------------------------------------------------------------- helpers ---

/** Row count without shipping rows: PostgREST reports the total in a header. */
async function count(path: string): Promise<number | null> {
  const { url, key, ready } = supabaseAdminConfig()
  if (!ready) return null
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method: 'HEAD',
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' },
    })
    const range = res.headers.get('content-range')
    if (!range) return null
    const total = Number(range.split('/')[1])
    return Number.isFinite(total) ? total : null
  } catch {
    return null
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Check = { key: string; label: string; state: 'ok' | 'warn' | 'bad'; detail: string }

// ----------------------------------------------------------------- health ---

async function health(): Promise<Response> {
  const now = Date.now()
  const checks: Check[] = []

  const [fixtures, priced, admins, suspendedCount, pendingCashouts] = await Promise.all([
    count('sports_fixtures?status=in.(upcoming,live)'),
    count('sports_markets?is_open=eq.true'),
    restSelect<{ id: string }>('profiles?is_admin=eq.true&select=id'),
    count('profiles?suspended=eq.true'),
    count('cashouts?status=in.(requested,pending_provider)'),
  ])

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

  const newest = await restSelect<{ price_at: string }>(
    'sports_selections?is_active=eq.true&select=price_at&order=price_at.desc&limit=1',
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

  checks.push({
    key: 'cashouts',
    label: 'Withdrawals waiting',
    state: (pendingCashouts ?? 0) > 0 ? 'warn' : 'ok',
    detail:
      (pendingCashouts ?? 0) > 0
        ? `${pendingCashouts} awaiting a decision — every hour is a player who thinks we kept it`
        : 'queue empty',
  })

  // The OTP provider is outside this app and cannot be probed from here, so
  // report the population instead: if nobody has ever verified, the credential
  // is the first thing to check, not the code.
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
}

// --------------------------------------------------------------- cashouts ---

type CashoutRow = {
  id: string
  user_id: string
  kind: string
  amount_px: number
  ugx: number
  phone: string | null
  rail: string | null
  asset: string | null
  address: string | null
  status: string
  failure_reason: string | null
  provider_ref: string | null
  created_at: string
}

const CASHOUT_STATUSES = ['requested', 'pending_provider', 'paid', 'failed', 'cancelled']

async function cashouts(url: URL): Promise<Response> {
  const status = url.searchParams.get('status') || 'requested'
  if (!CASHOUT_STATUSES.includes(status)) return json({ error: 'invalid status' }, 400)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 200)

  const rows = await restSelect<CashoutRow>(
    `cashouts?status=eq.${status}&select=id,user_id,kind,amount_px,ugx,phone,rail,asset,address,status,failure_reason,provider_ref,created_at&order=created_at.asc&limit=${limit}`,
  )
  if (!rows.length) return json({ rows: [], players: {}, totals: null })

  const ids = Array.from(new Set(rows.map((r) => r.user_id))).join(',')
  const profiles = await restSelect<{ id: string; username: string; suspended: boolean; phone_verified: boolean }>(
    `profiles?id=in.(${ids})&select=id,username,suspended,phone_verified`,
  )
  const players = Object.fromEntries(
    profiles.map((p) => [p.id, { username: p.username, suspended: p.suspended, phone_verified: p.phone_verified }]),
  )

  return json({
    rows,
    players,
    totals: {
      count: rows.length,
      px_held: rows.reduce((s, r) => s + Number(r.amount_px), 0),
      ugx_due: rows.reduce((s, r) => s + Number(r.ugx), 0),
      oldest_hours: Math.floor((Date.now() - new Date(rows[0].created_at).getTime()) / 3_600_000),
    },
  })
}

// ------------------------------------------------------------------ audit ---

async function audit(url: URL): Promise<Response> {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500)

  const actions = await restSelect<{
    id: number
    admin_id: string
    action: string
    target_id: string | null
    detail: Record<string, unknown> | null
    created_at: string
  }>(
    `admin_actions?select=id,admin_id,action,target_id,detail,created_at&order=created_at.desc&limit=${limit}`,
  )
  if (!actions.length) return json({ rows: [] })

  // Resolve both sides to usernames: a log of uuids is not accountability.
  const ids = Array.from(
    new Set(actions.flatMap((a) => [a.admin_id, a.target_id].filter((x): x is string => Boolean(x)))),
  ).join(',')
  const profiles = await restSelect<{ id: string; username: string }>(
    `profiles?id=in.(${ids})&select=id,username`,
  )
  const names = Object.fromEntries(profiles.map((p) => [p.id, p.username]))

  return json({
    rows: actions.map((a) => ({
      ...a,
      admin_name: names[a.admin_id] ?? a.admin_id.slice(0, 8),
      target_name: a.target_id ? names[a.target_id] ?? a.target_id.slice(0, 8) : null,
    })),
  })
}

// ---------------------------------------------------------------- actions ---

type ActionBody = {
  action?: string
  userId?: string
  deltaPx?: number
  reason?: string
  cashoutId?: string
  status?: 'paid' | 'failed' | 'cancelled'
}

async function actions(req: Request, admin: string): Promise<Response> {
  const body = await readJson<ActionBody>(req)
  if (!body?.action) return json({ error: 'action is required' }, 400)

  const target = typeof body.userId === 'string' ? body.userId.trim() : ''

  switch (body.action) {
    case 'adjust': {
      if (!UUID.test(target)) return json({ error: 'invalid player id' }, 400)
      const delta = Math.trunc(Number(body.deltaPx))
      if (!Number.isFinite(delta) || delta === 0) {
        return json({ error: 'deltaPx must be a non-zero whole number' }, 400)
      }
      // A stray zero is the difference between a courtesy credit and a month's
      // takings, so refuse the absurd before the database guard is the backstop.
      if (Math.abs(delta) > 5_000_000) {
        return json({ error: 'adjustments are capped at 5,000,000 PX (50,000 UGX)' }, 400)
      }
      const balance = await restRpc<number>('admin_adjust_balance', {
        p_admin: admin,
        p_user: target,
        p_delta: delta,
        p_reason: (body.reason || '').trim(),
      })
      return json({ ok: true, balance })
    }

    case 'suspend':
    case 'unsuspend': {
      if (!UUID.test(target)) return json({ error: 'invalid player id' }, 400)
      await restRpc('admin_set_suspended', {
        p_admin: admin,
        p_user: target,
        p_state: body.action === 'suspend',
        p_reason: (body.reason || '').trim() || null,
      })
      return json({ ok: true, suspended: body.action === 'suspend' })
    }

    case 'grant_admin':
    case 'revoke_admin': {
      if (!UUID.test(target)) return json({ error: 'invalid player id' }, 400)
      await restRpc('admin_set_admin_flag', {
        p_admin: admin,
        p_user: target,
        p_state: body.action === 'grant_admin',
      })
      return json({ ok: true })
    }

    case 'settle_cashout': {
      const id = typeof body.cashoutId === 'string' ? body.cashoutId.trim() : ''
      if (!UUID.test(id)) return json({ error: 'invalid cashout id' }, 400)
      if (!body.status || !['paid', 'failed', 'cancelled'].includes(body.status)) {
        return json({ error: 'status must be paid, failed or cancelled' }, 400)
      }

      const rows = await restSelect<CashoutRow>(
        `cashouts?id=eq.${id}&select=id,user_id,kind,amount_px,ugx,phone,status&limit=1`,
      )
      const co = rows[0]
      if (!co) return json({ error: 'no such cashout' }, 404)
      if (['paid', 'failed', 'cancelled'].includes(co.status)) {
        return json({ error: `already ${co.status}` }, 409)
      }

      // Paying means actually paying. If the provider rejects the payout we do
      // not mark it paid — the row stays pending and we say what went wrong.
      if (body.status === 'paid') {
        if (co.kind !== 'momo') {
          return json({ error: 'only mobile-money payouts can be sent from here' }, 400)
        }
        const phone = normalizePhone(co.phone || '')
        if (!phone) return json({ error: 'this cashout has no usable phone number' }, 400)

        try {
          assertLiveSafety()
        } catch (e) {
          const err = e as GatewayError
          return json({ error: err.message, code: err.code }, err.httpStatus)
        }

        try {
          const tx = await disbursePayment({
            amount: co.ugx,
            currency: 'UGX',
            phone_number: phone,
            description: 'FloatBet withdrawal',
          })
          await restRpc('record_disburse', {
            p_user: co.user_id,
            p_order: `ADMIN-${co.id.slice(0, 8)}`,
            p_reference: tx.reference,
            p_amount: co.ugx,
            p_currency: 'UGX',
            p_phone: phone,
            p_provider: tx.provider ?? null,
            p_cashout: co.id,
          })
        } catch (e) {
          const err = e as GatewayError
          console.error('admin cashout disbursement failed', err.message)
          return json(
            { error: `The provider did not accept the payout: ${err.message}. Nothing was marked paid.`, code: err.code },
            err.httpStatus ?? 502,
          )
        }
      }

      await restRpc('admin_settle_cashout', {
        p_admin: admin,
        p_cashout: id,
        p_status: body.status,
        p_reason: (body.reason || '').trim() || null,
      })
      return json({ ok: true, status: body.status })
    }

    default:
      return json({ error: 'unknown action' }, 400)
  }
}


// ---------------------------------------------------------------- lookup ---

/** Find the account an admin means. Returns nothing an admin should not see. */
async function lookup(url: URL): Promise<Response> {
  const q = (url.searchParams.get('q') || '').trim()
  if (q.length < 3) return json({ rows: [] })
  // Escape PostgREST pattern characters so a stray % cannot enumerate the table.
  const safe = q.replace(/[%,()*\\]/g, '').slice(0, 80)
  if (!safe) return json({ rows: [] })

  const rows = await restSelect<{ id: string; username: string; display_name: string | null; created_at: string }>(
    `profiles?or=(username.ilike.*${encodeURIComponent(safe)}*,display_name.ilike.*${encodeURIComponent(safe)}*)&select=id,username,display_name,created_at&limit=10`,
  )
  return json({ rows })
}

// --------------------------------------------------------------- players ---

type Profile = {
  id: string
  username: string
  display_name: string | null
  country: string | null
  phone: string | null
  phone_verified: boolean | null
  age_confirmed: boolean | null
  date_of_birth: string | null
  is_admin: boolean | null
  suspended: boolean | null
  created_at: string
}

type WalletRow = {
  user_id: string
  balance_px: number
  wagered_px: number
  won_px: number
  cashed_out_px: number
  gifted_out_px: number
  gifted_in_px: number
  updated_at: string
}

const SIGNUP_PX = 10_000
const DAILY_PX = 15_000

/** Days since signup, floored. Shown so the 7-day gate is visible, not guessed. */
function ageDays(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000)
}

/**
 * "Worth a look" — a sort order, never a verdict.
 *
 * The first version compared idle PX against PX wagered and flagged every
 * account on the platform, because a new player has collected grants and not
 * yet staked anything. A signal that fires for 100% of players is noise that
 * teaches an admin to ignore the column.
 *
 * This asks a narrower question: is there PX here that the platform's own
 * grants do not explain?
 */
function riskScore(w: WalletRow | undefined, claims: number): number {
  if (!w) return 0
  const granted = SIGNUP_PX + claims * DAILY_PX
  const unexplained = Math.max(0, w.balance_px - granted)
  let score = 0
  if (w.gifted_in_px > 0 && w.wagered_px === 0) score += 30
  if (unexplained > 0) score += Math.min(40, Math.round((unexplained / granted) * 20))
  return score
}

async function players(url: URL): Promise<Response> {
  const id = (url.searchParams.get('id') || '').trim()

  // ---------------------------------------------------------- one player --
  if (id) {
    if (!UUID.test(id)) return json({ error: 'invalid id' }, 400)

    const [profiles, wallets, ledger, cashoutRows, claims] = await Promise.all([
      restSelect<Profile>(
        `profiles?id=eq.${id}&select=id,username,display_name,country,phone,phone_verified,age_confirmed,date_of_birth,is_admin,suspended,created_at&limit=1`,
      ),
      restSelect<WalletRow>(`wallets?user_id=eq.${id}&limit=1`),
      restSelect<{ id: number; kind: string; delta_px: number; balance_after: number; ref: string | null; meta: Record<string, unknown> | null; created_at: string }>(
        `ledger?user_id=eq.${id}&select=id,kind,delta_px,balance_after,ref,meta,created_at&order=created_at.desc&limit=100`,
      ),
      restSelect<{ id: string; kind: string; amount_px: number; ugx: number; status: string; failure_reason: string | null; created_at: string }>(
        `cashouts?user_id=eq.${id}&select=id,kind,amount_px,ugx,status,failure_reason,created_at&order=created_at.desc&limit=25`,
      ),
      restSelect<{ claim_date: string }>(
        `px_claims?user_id=eq.${id}&select=claim_date&order=claim_date.desc&limit=30`,
      ),
    ])

    const profile = profiles[0]
    if (!profile) return json({ error: 'no such player' }, 404)

    const wallet = wallets[0]
    const newest = ledger[0]
    // Replay check: the newest ledger row must agree with the wallet. If it
    // does not, something changed a balance with no record, which is worth
    // shouting about rather than hiding.
    const reconciled =
      !wallet || !newest || Number(newest.balance_after) === Number(wallet.balance_px)

    return json({
      profile: { ...profile, age_days: ageDays(profile.created_at) },
      wallet: wallet ?? null,
      ledger,
      cashouts: cashoutRows,
      daily_claims: claims.length,
      reconciled,
      risk: riskScore(wallet, claims.length),
    })
  }

  // ------------------------------------------------------------ the list --
  const q = (url.searchParams.get('q') || '').trim()
  const sort = url.searchParams.get('sort') || 'recent'
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200)

  const safe = q.replace(/[%,()*\\]/g, '').slice(0, 80)
  const filter = safe
    ? `&or=(username.ilike.*${encodeURIComponent(safe)}*,display_name.ilike.*${encodeURIComponent(safe)}*)`
    : ''
  const order = sort === 'oldest' ? 'created_at.asc' : 'created_at.desc'

  const profiles = await restSelect<Profile>(
    `profiles?select=id,username,display_name,country,is_admin,suspended,created_at${filter}&order=${order}&limit=${limit}`,
  )
  if (!profiles.length) return json({ rows: [], totals: null })

  const ids = profiles.map((p) => p.id).join(',')

  // The daily grant is claimed against a Kampala calendar day, so "claimed
  // today" must use the same boundary or it undercounts three hours a night.
  const kampalaToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala' }).format(new Date())

  const [wallets, claims, todayClaims] = await Promise.all([
    restSelect<WalletRow>(
      `wallets?user_id=in.(${ids})&select=user_id,balance_px,wagered_px,won_px,cashed_out_px,gifted_out_px,gifted_in_px,updated_at`,
    ),
    restSelect<{ user_id: string }>(`px_claims?user_id=in.(${ids})&select=user_id`),
    restSelect<{ user_id: string }>(`px_claims?user_id=in.(${ids})&claim_date=eq.${kampalaToday}&select=user_id`),
  ])

  const walletBy = new Map(wallets.map((w) => [w.user_id, w]))
  const claimBy = new Map<string, number>()
  for (const c of claims) claimBy.set(c.user_id, (claimBy.get(c.user_id) ?? 0) + 1)

  const rows = profiles.map((p) => {
    const w = walletBy.get(p.id)
    const n = claimBy.get(p.id) ?? 0
    return {
      ...p,
      age_days: ageDays(p.created_at),
      balance_px: w?.balance_px ?? 0,
      wagered_px: w?.wagered_px ?? 0,
      won_px: w?.won_px ?? 0,
      cashed_out_px: w?.cashed_out_px ?? 0,
      gifted_in_px: w?.gifted_in_px ?? 0,
      daily_claims: n,
      risk: riskScore(w, n),
    }
  })

  if (sort === 'balance') rows.sort((a, b) => b.balance_px - a.balance_px)
  if (sort === 'risk') rows.sort((a, b) => b.risk - a.risk)

  return json({
    rows,
    totals: {
      players: rows.length,
      px_in_circulation: rows.reduce((s, r) => s + r.balance_px, 0),
      px_wagered: rows.reduce((s, r) => s + r.wagered_px, 0),
      px_cashed_out: rows.reduce((s, r) => s + r.cashed_out_px, 0),
      claims_today: new Set(todayClaims.map((c) => c.user_id)).size,
    },
  })
}

// ----------------------------------------------------------------- router ---

export default async function handler(req: Request): Promise<Response> {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response

  const url = new URL(req.url)
  const op = url.searchParams.get('op') || 'health'

  try {
    if (req.method === 'GET') {
      if (op === 'health') return await health()
      if (op === 'cashouts') return await cashouts(url)
      if (op === 'audit') return await audit(url)
      if (op === 'lookup') return await lookup(url)
      if (op === 'players') return await players(url)
      return json({ error: 'unknown operation' }, 400)
    }

    if (req.method === 'POST') {
      if (op === 'actions') return await actions(req, gate.admin.id)
      return methodNotAllowed()
    }

    return methodNotAllowed()
  } catch (e) {
    const msg = (e as Error).message || 'that request failed'
    // Surface the database's own words: they name the constraint that actually
    // rejected the request, which is what an operator needs to correct it.
    console.error('admin ops failed', op, msg)
    return json({ error: msg }, 400)
  }
}

export const config = { runtime: 'nodejs' }
