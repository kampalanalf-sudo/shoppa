// GET /api/admin/players?q=&sort=balance|recent|risk&limit=50
// GET /api/admin/players?id=<uuid>            -> one player's full activity
//
// Player visibility for admins.
//
// Design notes that are deliberate, not incidental:
//
//  * The list returns AGGREGATES, not history. An admin scanning 50 players does
//    not need 50 ledgers; they need to spot who is unusual. History is one click
//    away and one query per player.
//
//  * The per-player view returns the ledger as it is stored — append-only, with
//    `balance_after` — so an admin can replay the account and reconcile it
//    against the wallet. That is the difference between seeing a balance and
//    being able to prove it.
//
//  * PII is minimised. The list shows username and country. Phone, date of
//    birth and the auth email are only returned in the single-player view,
//    where there is a specific decision to make. An admin exporting a roster
//    should not also be exporting everyone's phone number by accident.
//
//  * Read-only. Nothing here changes a balance. Money moves only through the
//    parked-payment release, which is separately attributed. A view that can
//    quietly adjust a wallet is a view that can quietly be abused.
import { requireAdmin } from '../_lib/admin'
import { json, methodNotAllowed, restSelect } from '../_lib/http'

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

type Wallet = {
  user_id: string
  balance_px: number
  wagered_px: number
  won_px: number
  cashed_out_px: number
  gifted_out_px: number
  gifted_in_px: number
  updated_at: string
}

type LedgerRow = {
  id: number
  kind: string
  delta_px: number
  balance_after: number
  ref: string | null
  meta: Record<string, unknown> | null
  created_at: string
}

type Cashout = {
  id: string
  kind: string
  amount_px: number
  ugx: number
  status: string
  phone: string | null
  rail: string | null
  asset: string | null
  failure_reason: string | null
  created_at: string
}

/** Days since signup, floored. Used for the 7-day conversion gate display. */
function ageDays(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000)
}

/**
 * "Worth a look" — a sort order, never a verdict.
 *
 * The first version of this scored idle PX against PX wagered, which flagged
 * every single account on the platform: everyone new has collected daily
 * grants and not yet staked anything. A signal that fires for 100% of players
 * is not a signal, it is noise that teaches an admin to ignore the column.
 *
 * This version asks a narrower question: is there PX in this wallet that the
 * platform's own grants do not explain? Two things qualify.
 *
 *  1. PX arriving as gifts while the account has never wagered anything. That
 *     is the shape of a funnel between accounts, which is how a bonus ring
 *     moves value to the account it intends to cash out.
 *  2. A balance materially larger than signup plus every daily claim since.
 *
 * Neither is proof of anything. A player can be gifted PX and happen not to
 * have played yet. The point is only to decide what to read first.
 */
const SIGNUP_PX = 10_000
const DAILY_PX = 15_000

function riskScore(w: Wallet | undefined, claims: number): number {
  if (!w) return 0

  const granted = SIGNUP_PX + claims * DAILY_PX
  const unexplained = Math.max(0, w.balance_px - granted)

  let score = 0
  // Gifts in, nothing staked: the classic funnel.
  if (w.gifted_in_px > 0 && w.wagered_px === 0) score += 30
  // Balance beyond what the grants account for.
  if (unexplained > 0) score += Math.min(40, Math.round((unexplained / granted) * 20))

  return score
}

export default async function handler(req: Request): Promise<Response> {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response
  if (req.method !== 'GET') return methodNotAllowed()

  const url = new URL(req.url)
  const id = (url.searchParams.get('id') || '').trim()

  try {
    // ---------------------------------------------------------- one player --
    if (id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'invalid id' }, 400)

      const [profiles, wallets, ledger, cashouts, claims] = await Promise.all([
        restSelect<Profile>(
          `profiles?id=eq.${id}&select=id,username,display_name,country,phone,phone_verified,age_confirmed,date_of_birth,is_admin,suspended,created_at&limit=1`,
        ),
        restSelect<Wallet>(`wallets?user_id=eq.${id}&limit=1`),
        restSelect<LedgerRow>(
          `ledger?user_id=eq.${id}&select=id,kind,delta_px,balance_after,ref,meta,created_at&order=created_at.desc&limit=100`,
        ),
        restSelect<Cashout>(
          `cashouts?user_id=eq.${id}&select=id,kind,amount_px,ugx,status,phone,rail,asset,failure_reason,created_at&order=created_at.desc&limit=25`,
        ),
        restSelect<{ claim_date: string }>(
          `px_claims?user_id=eq.${id}&select=claim_date&order=claim_date.desc&limit=30`,
        ),
      ])

      const profile = profiles[0]
      if (!profile) return json({ error: 'no such player' }, 404)

      const wallet = wallets[0]
      // Replay check: the newest ledger row's balance_after must equal the
      // wallet. If it does not, something changed a balance without a ledger
      // row, and that is worth shouting about rather than hiding.
      const newest = ledger[0]
      const reconciled = !wallet || !newest || Number(newest.balance_after) === Number(wallet.balance_px)

      return json({
        profile: { ...profile, age_days: ageDays(profile.created_at) },
        wallet: wallet ?? null,
        ledger,
        cashouts,
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
    const order =
      sort === 'balance'
        ? ''
        : sort === 'oldest'
          ? 'created_at.asc'
          : 'created_at.desc'

    const profiles = await restSelect<Profile>(
      `profiles?select=id,username,display_name,country,is_admin,suspended,created_at${filter}&order=${order || 'created_at.desc'}&limit=${limit}`,
    )

    if (!profiles.length) return json({ rows: [], totals: null })

    // Batch the wallets and claim counts in one query each rather than N+1.
    const ids = profiles.map((p) => p.id).join(',')
    // The daily grant is claimed against a Kampala calendar day, so "claimed
    // today" has to use the same boundary the award does -- UTC today would
    // undercount for three hours every evening.
    const kampalaToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Kampala',
    }).format(new Date())

    const [wallets, claims, todayClaims] = await Promise.all([
      restSelect<Wallet>(
        `wallets?user_id=in.(${ids})&select=user_id,balance_px,wagered_px,won_px,cashed_out_px,gifted_out_px,gifted_in_px,updated_at`,
      ),
      restSelect<{ user_id: string }>(`px_claims?user_id=in.(${ids})&select=user_id`),
      restSelect<{ user_id: string }>(
        `px_claims?user_id=in.(${ids})&claim_date=eq.${kampalaToday}&select=user_id`,
      ),
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

    const totals = {
      players: rows.length,
      px_in_circulation: rows.reduce((s, r) => s + r.balance_px, 0),
      px_wagered: rows.reduce((s, r) => s + r.wagered_px, 0),
      px_cashed_out: rows.reduce((s, r) => s + r.cashed_out_px, 0),
      claims_today: new Set(todayClaims.map((c) => c.user_id)).size,
    }

    return json({ rows, totals })
  } catch (e) {
    console.error('admin players failed', (e as Error).message)
    return json({ error: 'could not load players' }, 502)
  }
}

export const config = { runtime: 'nodejs' }
