// supabase/functions/admin-ops/index.ts
//
// One function behind every admin screen, plus the parked-payment queue.
//
//   GET  ?op=health             platform health checks
//   GET  ?op=cashouts           the withdrawal queue
//   GET  ?op=audit              the admin action log
//   GET  ?op=lookup&q=          find an account
//   GET  ?op=players[&id=]      player list, or one player's full picture
//   GET  ?op=parked[&status=]   uncredited store top-ups
//   POST ?op=actions            adjust / suspend / grant / settle cashout
//   POST ?op=parked             release or dismiss a parked payment
//
// WHY IT IS ONE FUNCTION
//
// The same reason the Vercel admin router was: a small surface, one gate. Every
// operation runs `requireAdmin()` before anything else, and the gate is three
// checks deep — a verified JWT, a profile row with is_admin, read with the
// service role so a client cannot spoof the flag. Nothing here can be reached
// without all three.
//
// The parked-payment operations moved in from their own endpoint because they
// share that gate exactly and they are the other place that moves money.
import { CORS, json, readEnv } from '../_shared/http.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import {
  GatewayError, disbursePayment, normalizePhone, assertLiveSafety, paymentReadiness,
  checkIpAllowed,
} from '../_shared/zengapay.ts'

/** Env var, trimmed. Missing becomes '' and never the string "undefined". */
const env = (key: string) => readEnv(key)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Admin = { id: string; username: string }

/**
 * The gate.
 *
 * The profile lookup uses the service role, so `is_admin` is read from the
 * database on every request and can never be supplied by the caller.
 */
async function requireAdmin(req: Request): Promise<{ admin: Admin } | { response: Response }> {
  const auth = req.headers.get('Authorization') || ''
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return { response: json({ error: 'not signed in' }, 401) }
  }

  const url = env('SUPABASE_URL')
  const anon = env('SUPABASE_ANON_KEY')
  const service = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anon || !service) {
    return { response: json({ error: 'admin is not configured on the server' }, 503) }
  }

  const asUser = createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: auth } },
  })
  const { data: userData, error: userError } = await asUser.auth.getUser()
  if (userError || !userData?.user) return { response: json({ error: 'not signed in' }, 401) }

  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id,username,is_admin')
    .eq('id', userData.user.id)
    .limit(1)
    .maybeSingle()

  if (profileError) return { response: json({ error: 'could not verify admin access' }, 502) }
  // 403 rather than 404: the caller is authenticated, just not an admin.
  if (!profile?.is_admin) return { response: json({ error: 'admin access required' }, 403) }

  return { admin: { id: profile.id, username: profile.username } }
}

function svc() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  })
}

/** Row count without shipping rows. */
async function count(path: string): Promise<number | null> {
  const { count: n, error } = await svc()
    .from(path)
    .select('*', { count: 'exact', head: true })
  return error ? null : n
}

// ----------------------------------------------------------------- health ---

type Check = { key: string; label: string; state: 'ok' | 'warn' | 'bad'; detail: string }

/**
 * A count, or the reason there is not one.
 *
 * The first version returned null on failure and the caller rendered that as 0,
 * so a single unreadable table produced a cheerful "0 fixtures on the board".
 * Here a failure is a named check with a 'bad' state, so the screen says which
 * thing is broken instead of pretending everything is empty.
 */
async function countOrWhy(
  table: string,
  filter?: (q: any) => any,
): Promise<{ ok: true; n: number } | { ok: false; why: string }> {
  let q = svc().from(table).select('*', { count: 'exact', head: true }) as any
  if (filter) q = filter(q)
  const { count, error } = await q
  if (error) {
    return { ok: false, why: `${error.message}${error.code ? ` (${error.code})` : ''}` }
  }
  return { ok: true, n: count ?? 0 }
}

async function health(): Promise<Response> {
  const now = Date.now()
  const checks: Check[] = []
  const db = svc()

  // Every check is settled independently. One table being unreadable must not
  // take the whole screen down with it: the operator needs to see the other
  // seven answers AND the name of the one that failed.
  const [fixtures, markets, selections, adminsRes, suspended, waiting, recentSync] = await Promise.all([
    countOrWhy('sports_fixtures'),
    countOrWhy('sports_markets'),
    countOrWhy('sports_selections'),
    db.from('profiles').select('id').eq('is_admin', true),
    countOrWhy('profiles', (q) => q.eq('suspended', true)),
    db.from('cashouts').select('id, created_at').eq('status', 'requested'),
    db.from('feed_sync_log').select('finished_at, status, fixtures_upserted, credits_left')
      .order('finished_at', { ascending: false }).limit(1),
  ])

  const bump = (r: { ok: true; n: number } | { ok: false; why: string }, key: string, label: string) => {
    if (!r.ok) {
      checks.push({ key, label, state: 'bad', detail: `could not be read: ${r.why}` })
      return null
    }
    return r.n
  }

  const fixtureCount = bump(fixtures, 'fixtures', 'Fixtures on the board')
  if (fixtureCount !== null) {
    checks.push({
      key: 'fixtures',
      label: 'Fixtures on the board',
      state: fixtureCount > 0 ? 'ok' : 'warn',
      detail: fixtureCount > 0 ? `${fixtureCount} on file` : 'none — the odds feed may not be syncing',
    })
  }

  const marketCount = bump(markets, 'markets', 'Markets on file')
  if (marketCount !== null) {
    checks.push({
      key: 'markets',
      label: 'Markets on file',
      state: marketCount > 0 ? 'ok' : 'warn',
      detail: marketCount > 0 ? `${marketCount} markets` : 'no markets — players cannot bet',
    })
  }

  const selectionCount = bump(selections, 'selections', 'Prices published')
  if (selectionCount !== null) {
    checks.push({
      key: 'selections',
      label: 'Prices published',
      state: selectionCount > 0 ? 'ok' : 'warn',
      detail: selectionCount > 0 ? `${selectionCount} active selections` : 'no prices — nothing is bettable',
    })
  }

  // Price freshness: a stale price is a price a player can beat.
  const { data: newest, error: newestErr } = await db
    .from('sports_selections')
    .select('price_at')
    .eq('is_active', true)
    .order('price_at', { ascending: false })
    .limit(1)

  if (newestErr) {
    checks.push({
      key: 'price_age', label: 'Newest price', state: 'bad',
      detail: `could not be read: ${newestErr.message}`,
    })
  } else if ((newest ?? [])[0]) {
    const ageMins = Math.floor((now - new Date(String((newest as any[])[0].price_at)).getTime()) / 60_000)
    checks.push({
      key: 'price_age',
      label: 'Newest price',
      state: ageMins > 360 ? 'bad' : ageMins > 120 ? 'warn' : 'ok',
      detail: `${ageMins} min old — a stale price is a price a player can beat`,
    })
  }

  if (adminsRes.error) {
    checks.push({
      key: 'admins', label: 'Admin accounts', state: 'bad',
      detail: `could not be read: ${adminsRes.error.message}`,
    })
  } else {
    const admins = (adminsRes.data ?? []) as { id: string }[]
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
  }

  const suspendedCount = bump(suspended, 'suspended', 'Suspended players')
  if (suspendedCount !== null) {
    checks.push({
      key: 'suspended', label: 'Suspended players', state: 'ok',
      detail: `${suspendedCount} accounts`,
    })
  }

  if (waiting.error) {
    checks.push({
      key: 'cashouts', label: 'Withdrawals waiting', state: 'bad',
      detail: `could not be read: ${waiting.error.message}`,
    })
  } else {
    const rows = (waiting.data ?? []) as { created_at: string }[]
    checks.push({
      key: 'cashouts',
      label: 'Withdrawals waiting',
      state: rows.length > 0 ? 'warn' : 'ok',
      detail:
        rows.length > 0
          ? `${rows.length} awaiting a decision — every hour is a player who thinks we kept it`
          : 'queue empty',
    })
  }

  // The last odds sync. Without this the operator has no way to tell a quiet
  // board from a dead feed.
  if (recentSync.error) {
    checks.push({
      key: 'sync', label: 'Last odds sync', state: 'bad',
      detail: `could not be read: ${recentSync.error.message}`,
    })
  } else {
    const sync = ((recentSync.data ?? []) as any[])[0]
    if (!sync) {
      checks.push({
        key: 'sync', label: 'Last odds sync', state: 'warn',
        detail: 'never run — prices will stay empty until feed-sync runs',
      })
    } else {
      const ageMins = Math.floor((now - new Date(String(sync.finished_at)).getTime()) / 60_000)
      checks.push({
        key: 'sync',
        label: 'Last odds sync',
        state: sync.status === 'ok' && ageMins < 480 ? 'ok' : sync.status === 'error' ? 'bad' : 'warn',
        detail: `${sync.status}, ${ageMins} min ago — ${sync.fixtures_upserted ?? 0} fixtures, ${
          sync.credits_left ?? '?'
        } credits left`,
      })
    }
  }

  const worst = checks.some((c) => c.state === 'bad')
    ? 'bad'
    : checks.some((c) => c.state === 'warn')
      ? 'warn'
      : 'ok'

  // ------------------------------------------------ can we actually take money --
  // This was missing, and it is the reason a live site sat there refusing every
  // deposit with "Mobile money is not configured" while this screen reported
  // everything healthy: eight checks, none of them payments. A player found it
  // before the operator did.
  //
  // Read from the same helper the payment functions use, so the health screen
  // cannot disagree with what `pay` will actually do.
  {
    const p = paymentReadiness()
    checks.push({
      key: 'payments',
      label: 'Card & mobile-money deposits',
      state: p.blockers.length === 0 ? 'ok' : 'bad',
      detail: p.blockers.length === 0
        ? `live, ${p.mode} — collections and checkouts enabled`
        : p.blockers.join('; '),
    })
  }

  // ------------------------------------------------ can we actually pay OUT --
  // Deposits and payouts fail differently, and only one of them was checked.
  // ZENGAPAY whitelists transfers and checkout by IP but not collections, so
  // this platform took two real deposits while every withdrawal was refused
  // with "Connection refused from unauthorized host". Nothing on screen said
  // so: the first sign was a player asking where their money went.
  //
  // A read of /account is whitelisted exactly like /transfers, so this is a
  // real answer rather than an inference. Skipped when there is no token at
  // all, because the payments check already reports that.
  {
    const p = paymentReadiness()
    if (!p.blockers.some((b) => /API_TOKEN is not set/.test(b))) {
      const ip = await checkIpAllowed()
      checks.push({
        key: 'payouts',
        label: 'Withdrawals (payout IP whitelist)',
        state: ip.allowed ? 'ok' : 'bad',
        detail: ip.allowed
          ? 'this server\'s IP is whitelisted for transfers'
          : `ZENGAPAY refuses this server${ip.ip ? ` (${ip.ip})` : ''}. ` +
            'Add that IP in Settings -> Developer Settings -> IP Address(es). ' +
            'Deposits still work; payouts will fail until it is added.',
      })
    }
  }

  return json({ checks, overall: worst, checked_at: new Date(now).toISOString() })
}

// --------------------------------------------------------------- cashouts ---

const CASHOUT_STATUSES = ['requested', 'pending_provider', 'paid', 'failed', 'cancelled']

async function cashouts(url: URL): Promise<Response> {
  const status = url.searchParams.get('status') || 'requested'
  if (!CASHOUT_STATUSES.includes(status)) return json({ error: 'invalid status' }, 400)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 200)

  const { data: rows, error } = await svc()
    .from('cashouts')
    .select('id,user_id,kind,amount_px,ugx,phone,rail,asset,address,status,failure_reason,provider_ref,created_at')
    .eq('status', status)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) return json({ error: 'could not load the queue' }, 502)
  const list = (rows ?? []) as Record<string, unknown>[]
  if (!list.length) return json({ rows: [], players: {}, totals: null })

  const ids = Array.from(new Set(list.map((r) => String(r.user_id))))
  const { data: profiles } = await svc()
    .from('profiles')
    .select('id,username,suspended,phone_verified')
    .in('id', ids)

  const players = Object.fromEntries(
    ((profiles ?? []) as { id: string; username: string; suspended: boolean; phone_verified: boolean }[])
      .map((p) => [p.id, { username: p.username, suspended: p.suspended, phone_verified: p.phone_verified }]),
  )

  return json({
    rows: list,
    players,
    totals: {
      count: list.length,
      px_held: list.reduce((s, r) => s + Number(r.amount_px), 0),
      ugx_due: list.reduce((s, r) => s + Number(r.ugx), 0),
      oldest_hours: Math.floor((Date.now() - new Date(String(list[0].created_at)).getTime()) / 3_600_000),
    },
  })
}

// ------------------------------------------------------------------ audit ---

async function audit(url: URL): Promise<Response> {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500)

  const { data, error } = await svc()
    .from('admin_actions')
    .select('id,admin_id,action,target_id,detail,created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return json({ error: 'could not load the log' }, 502)
  const actions = (data ?? []) as {
    id: number; admin_id: string; action: string; target_id: string | null
    detail: Record<string, unknown> | null; created_at: string
  }[]
  if (!actions.length) return json({ rows: [] })

  // A log of uuids is not accountability: resolve both sides to usernames.
  const ids = Array.from(
    new Set(actions.flatMap((a) => [a.admin_id, a.target_id].filter((x): x is string => Boolean(x)))),
  )
  const { data: profiles } = await svc().from('profiles').select('id,username').in('id', ids)
  const names = Object.fromEntries(((profiles ?? []) as { id: string; username: string }[]).map((p) => [p.id, p.username]))

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
  reference?: string
}

async function actions(req: Request, admin: string): Promise<Response> {
  const body = (await req.json().catch(() => null)) as ActionBody | null
  if (!body?.action) return json({ error: 'action is required' }, 400)

  const db = svc()
  const target = typeof body.userId === 'string' ? body.userId.trim() : ''

  // The RPCs raise readable messages for states an admin cannot override. Map
  // them to 409 so the UI can show the database's own words.
  const runRpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args)
    if (error) throw new Error(error.message)
    return data
  }

  try {
    switch (body.action) {
      case 'adjust': {
        if (!UUID.test(target)) return json({ error: 'invalid player id' }, 400)
        const delta = Math.trunc(Number(body.deltaPx))
        if (!Number.isFinite(delta) || delta === 0) {
          return json({ error: 'deltaPx must be a non-zero whole number' }, 400)
        }
        // A stray zero is the difference between a courtesy credit and a
        // month's takings, so refuse the absurd before the DB guard is needed.
        if (Math.abs(delta) > 5_000_000) {
          return json({ error: 'adjustments are capped at 5,000,000 PX (50,000 UGX)' }, 400)
        }
        const balance = await runRpc('admin_adjust_balance', {
          p_admin: admin, p_user: target, p_delta: delta, p_reason: (body.reason || '').trim(),
        })
        return json({ ok: true, balance })
      }

      case 'suspend':
      case 'unsuspend': {
        if (!UUID.test(target)) return json({ error: 'invalid player id' }, 400)
        await runRpc('admin_set_suspended', {
          p_admin: admin, p_user: target,
          p_state: body.action === 'suspend',
          p_reason: (body.reason || '').trim() || null,
        })
        return json({ ok: true, suspended: body.action === 'suspend' })
      }

      case 'grant_admin':
      case 'revoke_admin': {
        if (!UUID.test(target)) return json({ error: 'invalid player id' }, 400)
        await runRpc('admin_set_admin_flag', {
          p_admin: admin, p_user: target, p_state: body.action === 'grant_admin',
        })
        return json({ ok: true })
      }

      case 'settle_cashout': {
        const id = typeof body.cashoutId === 'string' ? body.cashoutId.trim() : ''
        if (!UUID.test(id)) return json({ error: 'invalid cashout id' }, 400)
        if (!body.status || !['paid', 'failed', 'cancelled'].includes(body.status)) {
          return json({ error: 'status must be paid, failed or cancelled' }, 400)
        }

        const { data: co } = await db
          .from('cashouts')
          .select('id,user_id,kind,amount_px,ugx,phone,status')
          .eq('id', id)
          .limit(1)
          .maybeSingle()

        if (!co) return json({ error: 'no such cashout' }, 404)
        if (['paid', 'failed', 'cancelled'].includes(String(co.status))) {
          return json({ error: `already ${co.status}` }, 409)
        }

        // Paying means actually paying. If the provider rejects the payout we
        // do not mark it paid — the row stays pending and we say why.
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

          let reference: string
          let provider: string | null
          try {
            const tx = await disbursePayment({
              amount: Number(co.ugx), currency: 'UGX', phone_number: phone,
              description: 'FloatBet withdrawal',
              // Unique per payout: ZENGAPAY rejects a repeat, which stops an
              // admin double-tap paying a cashout twice.
              order_id: `ADMIN-${String(co.id).slice(0, 8)}-${Date.now().toString(36)}`,
            })
            reference = tx.reference
            provider = tx.provider ?? null
          } catch (e) {
            const err = e as GatewayError
            console.error('admin cashout disbursement failed', err.message)
            return json(
              { error: `The provider did not accept the payout: ${err.message}. Nothing was marked paid.`, code: err.code },
              err.httpStatus ?? 502,
            )
          }

          await runRpc('record_disburse', {
            p_user: co.user_id,
            p_order: `ADMIN-${String(co.id).slice(0, 8)}`,
            p_reference: reference,
            p_amount: Number(co.ugx),
            p_currency: 'UGX',
            p_phone: phone,
            p_provider: provider,
            p_cashout: co.id,
          })
        }

        await runRpc('admin_settle_cashout', {
          p_admin: admin, p_cashout: id, p_status: body.status,
          p_reason: (body.reason || '').trim() || null,
        })
        return json({ ok: true, status: body.status })
      }

      default:
        return json({ error: 'unknown action' }, 400)
    }
  } catch (e) {
    const message = (e as Error).message || ''
    if (/not an admin|suspended|cannot|below zero|requires|must/i.test(message)) {
      return json({ error: message }, 409)
    }
    console.error('admin action failed', body.action, message)
    return json({ error: message || 'that action failed' }, 502)
  }
}

// ---------------------------------------------------------------- lookup ---

/** Find the account an admin means. Returns nothing an admin should not see. */
async function lookup(url: URL): Promise<Response> {
  const q = (url.searchParams.get('q') || '').trim()
  if (q.length < 3) return json({ rows: [] })
  // Strip PostgREST pattern characters so a stray % cannot enumerate the table.
  const safe = q.replace(/[%,()*\\]/g, '').slice(0, 80)
  if (!safe) return json({ rows: [] })

  const { data, error } = await svc()
    .from('profiles')
    .select('id,username,display_name,created_at')
    .or(`username.ilike.*${safe}*,display_name.ilike.*${safe}*`)
    .limit(10)

  if (error) return json({ error: 'could not search' }, 502)
  return json({ rows: data ?? [] })
}

// --------------------------------------------------------------- players ---

const SIGNUP_PX = 10_000
const DAILY_PX = 15_000

/** Days since signup, floored. Makes the 7-day gate visible, not guessed. */
const ageDays = (createdAt: string) =>
  Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000)

/**
 * "Worth a look" — a sort order, never a verdict.
 *
 * An earlier version compared idle PX against PX wagered and flagged every
 * account on the platform, because a new player has collected grants and not
 * yet staked anything. A signal that fires for 100% of players teaches an admin
 * to ignore the column. This asks a narrower question: is there PX here that
 * the platform's own grants do not explain?
 */
function riskScore(w: Record<string, unknown> | undefined, claims: number): number {
  if (!w) return 0
  const granted = SIGNUP_PX + claims * DAILY_PX
  const unexplained = Math.max(0, Number(w.balance_px ?? 0) - granted)
  let score = 0
  if (Number(w.gifted_in_px ?? 0) > 0 && Number(w.wagered_px ?? 0) === 0) score += 30
  if (unexplained > 0) score += Math.min(40, Math.round((unexplained / granted) * 20))
  return score
}

async function players(url: URL): Promise<Response> {
  const id = (url.searchParams.get('id') || '').trim()
  const db = svc()

  // ---------------------------------------------------------- one player --
  if (id) {
    if (!UUID.test(id)) return json({ error: 'invalid id' }, 400)

    const [profiles, wallets, ledger, cashoutRows, claims] = await Promise.all([
      db.from('profiles').select('*').eq('id', id).limit(1),
      db.from('wallets').select('*').eq('user_id', id).limit(1),
      db.from('ledger')
        .select('id,kind,delta_px,balance_after,ref,meta,created_at')
        .eq('user_id', id).order('created_at', { ascending: false }).limit(100),
      db.from('cashouts')
        .select('id,kind,amount_px,ugx,status,failure_reason,created_at')
        .eq('user_id', id).order('created_at', { ascending: false }).limit(25),
      db.from('px_claims').select('claim_date').eq('user_id', id).limit(30),
    ])

    const profile = (profiles.data ?? [])[0]
    if (!profile) return json({ error: 'no such player' }, 404)

    const wallet = (wallets.data ?? [])[0]
    const newest = (ledger.data ?? [])[0]
    // Replay check: the newest ledger row must agree with the wallet. If it does
    // not, something changed a balance with no record — worth shouting about.
    const reconciled =
      !wallet || !newest || Number(newest.balance_after) === Number(wallet.balance_px)

    return json({
      profile: { ...profile, age_days: ageDays(profile.created_at) },
      wallet: wallet ?? null,
      ledger: ledger.data ?? [],
      cashouts: cashoutRows.data ?? [],
      daily_claims: (claims.data ?? []).length,
      reconciled,
      risk: riskScore(wallet, (claims.data ?? []).length),
    })
  }

  // ------------------------------------------------------------ the list --
  const q = (url.searchParams.get('q') || '').trim()
  const sort = url.searchParams.get('sort') || 'recent'
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200)

  const safe = q.replace(/[%,()*\\]/g, '').slice(0, 80)
  let query = db.from('profiles').select('id,username,display_name,country,is_admin,suspended,created_at')
  if (safe) query = query.or(`username.ilike.*${safe}*,display_name.ilike.*${safe}*`)
  const { data: profileRows, error: profileError } = await query
    .order('created_at', { ascending: sort === 'oldest' })
    .limit(limit)

  if (profileError) return json({ error: 'could not load players' }, 502)
  const profiles = (profileRows ?? []) as Record<string, unknown>[]
  if (!profiles.length) return json({ rows: [], totals: null })

  const ids = profiles.map((p) => String(p.id))

  // The daily grant is claimed against a Kampala calendar day, so "claimed
  // today" must use the same boundary or it undercounts three hours a night.
  const kampalaToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala' }).format(new Date())

  const [wallets, claims, todayClaims] = await Promise.all([
    db.from('wallets').select('*').in('user_id', ids),
    db.from('px_claims').select('user_id').in('user_id', ids),
    db.from('px_claims').select('user_id').in('user_id', ids).eq('claim_date', kampalaToday),
  ])

  const walletBy = new Map(
    ((wallets.data ?? []) as { user_id: string }[]).map((w) => [w.user_id, w as Record<string, unknown>]),
  )
  const claimBy = new Map<string, number>()
  for (const c of (claims.data ?? []) as { user_id: string }[]) {
    claimBy.set(c.user_id, (claimBy.get(c.user_id) ?? 0) + 1)
  }

  const rows = profiles.map((p) => {
    const pid = String(p.id)
    const w = walletBy.get(pid)
    const n = claimBy.get(pid) ?? 0
    return {
      ...p,
      age_days: ageDays(String(p.created_at)),
      balance_px: Number(w?.balance_px ?? 0),
      wagered_px: Number(w?.wagered_px ?? 0),
      won_px: Number(w?.won_px ?? 0),
      cashed_out_px: Number(w?.cashed_out_px ?? 0),
      gifted_in_px: Number(w?.gifted_in_px ?? 0),
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
      claims_today: new Set(((todayClaims.data ?? []) as { user_id: string }[]).map((c) => c.user_id)).size,
    },
  })
}

// ---------------------------------------------------------------- parked ---

async function parkedList(url: URL): Promise<Response> {
  const status = url.searchParams.get('status') || 'pending'
  if (!['pending', 'completed', 'failed'].includes(status)) {
    return json({ error: 'invalid status' }, 400)
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200)

  const { data, error } = await svc()
    .from('store_topups')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return json({ error: 'could not load the queue' }, 502)
  const rows = data ?? []
  return json({ rows, count: rows.length })
}

async function parkedAction(req: Request, admin: Admin): Promise<Response> {
  const body = (await req.json().catch(() => null)) as ActionBody | null
  const reference = typeof body?.reference === 'string' ? body.reference.trim() : ''
  const action = body?.action

  if (!reference) return json({ error: 'reference is required' }, 400)
  if (action !== 'release' && action !== 'dismiss') {
    return json({ error: "action must be 'release' or 'dismiss'" }, 400)
  }

  const db = svc()

  if (action === 'dismiss') {
    // Marking a parked payment failed. It must never have been credited, and
    // store_topups.status is the flag the player's claim path checks.
    const { error } = await db.rpc('dismiss_store_topup', { p_reference: reference, p_admin_id: admin.id })
    if (error) {
      console.error('admin dismiss failed', error.message)
      return json({ error: 'could not dismiss that payment' }, 502)
    }
    return json({ ok: true, action: 'dismiss' })
  }

  const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
  if (!userId) return json({ error: 'userId is required to release a payment' }, 400)

  const { data, error } = await db.rpc('admin_release_store_topup', {
    p_reference: reference, p_user_id: userId, p_admin_id: admin.id,
  })

  if (error) {
    const message = error.message || ''
    // These are the SQL's own messages for states an admin cannot override.
    if (/already been credited|failed payments cannot|still pending|unknown reference|wallet missing/i.test(message)) {
      return json({ error: message }, 409)
    }
    console.error('admin release failed', message)
    return json({ error: 'could not release that payment' }, 502)
  }

  const result = (data ?? {}) as { px?: number; balance?: number; replay?: boolean }
  return json({
    ok: true,
    action: 'release',
    credited: true,
    replay: Boolean(result.replay),
    px: result.px ?? null,
    balance: result.balance ?? null,
    admin: admin.username,
  })
}

// ---------------------------------------------------------------- router ---

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()

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
      if (op === 'parked') return await parkedList(url)
      return json({ error: 'unknown operation' }, 400)
    }

    if (req.method === 'POST') {
      if (op === 'actions') return await actions(req, gate.admin.id)
      if (op === 'parked') return await parkedAction(req, gate.admin)
      return json({ error: 'method not allowed' }, 405)
    }

    return json({ error: 'method not allowed' }, 405)
  } catch (e) {
    const msg = (e as Error).message || 'that request failed'
    // Surface the database's own words: they name the constraint that actually
    // rejected the request, which is what an operator needs to correct it.
    console.error('admin-ops failed', op, msg)
    return json({ error: msg }, 400)
  }
})
