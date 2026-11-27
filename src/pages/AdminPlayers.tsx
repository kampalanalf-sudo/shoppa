import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { money } from '../lib/format'
import { api, describeApiError } from '../lib/api'
import { IconChevronLeft, IconShield, IconSearch, IconClock } from '../components/Icons'

/**
 * Player activity, for admins.
 *
 * Read-only by design: this page answers "what is this player doing", and money
 * never moves from here. The one place an admin can move money — releasing a
 * parked payment — is a separate screen with its own confirmation and audit row.
 * Keeping those apart means a mis-tap while browsing cannot credit anyone.
 */

type Row = {
  id: string
  username: string
  display_name: string | null
  country: string | null
  is_admin: boolean | null
  suspended: boolean | null
  created_at: string
  age_days: number
  balance_px: number
  wagered_px: number
  won_px: number
  cashed_out_px: number
  gifted_in_px: number
  daily_claims: number
  risk: number
}

type Totals = {
  players: number
  px_in_circulation: number
  px_wagered: number
  px_cashed_out: number
  claims_today: number
}

type Detail = {
  profile: Row & { phone: string | null; phone_verified: boolean | null; date_of_birth: string | null }
  wallet: { balance_px: number; wagered_px: number; won_px: number; cashed_out_px: number } | null
  ledger: { id: number; kind: string; delta_px: number; balance_after: number; ref: string | null; created_at: string }[]
  cashouts: { id: string; kind: string; amount_px: number; ugx: number; status: string; failure_reason: string | null; created_at: string }[]
  daily_claims: number
  reconciled: boolean
  risk: number
}

const SORTS = [
  { id: 'recent', label: 'Newest' },
  { id: 'balance', label: 'Balance' },
  { id: 'risk', label: 'Worth a look' },
  { id: 'oldest', label: 'Oldest' },
] as const

const ago = (iso: string): string => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const KIND_TONE: Record<string, string> = {
  grant: 'text-sky-300',
  bet: 'text-slate-400',
  win: 'text-emerald-300',
  cashout_hold: 'text-amber-300',
  cashout_refund: 'text-amber-200',
  gift_out: 'text-rose-300',
  gift_in: 'text-emerald-200',
  adjustment: 'text-violet-300',
}

export function AdminPlayers({ onHome }: { onHome: () => void }) {
  const { profile, ready } = useAuth()

  const [rows, setRows] = useState<Row[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [sort, setSort] = useState<(typeof SORTS)[number]['id']>('recent')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  // Player-level controls. Every one of these hits /api/admin/actions, which
  // re-checks the admin flag server-side -- this state is UI only.
  const [actBusy, setActBusy] = useState(false)
  const [actNote, setActNote] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustPx, setAdjustPx] = useState('')
  const [adjustReason, setAdjustReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, string> = { sort, limit: '100' }
      if (query.trim().length >= 3) params.q = query.trim()
      const body = await api<{ rows?: Row[]; totals?: Totals }>('/api/admin/players', { params })
      setRows(body.rows ?? [])
      setTotals(body.totals ?? null)
    } catch (e) {
      setRows([])
      setTotals(null)
      setError(describeApiError(e, 'Could not load players.'))
    } finally {
      setLoading(false)
    }
  }, [sort, query])

  useEffect(() => {
    if (ready) void load()
  }, [ready, load])

  const openPlayer = useCallback(async (id: string) => {
    setOpenId(id)
    setDetail(null)
    setDetailBusy(true)
    try {
      setDetail(await api<Detail>('/api/admin/players', { params: { id } }))
    } catch (e) {
      setError(describeApiError(e, 'Could not load that player.'))
    } finally {
      setDetailBusy(false)
    }
  }, [])

  const runAction = useCallback(
    async (payload: Record<string, unknown>) => {
      setActBusy(true)
      setActNote(null)
      try {
        await api('/api/admin/actions', { method: 'POST', body: payload })
        setActNote({ kind: 'ok', text: 'Done.' })
        setAdjustOpen(false)
        setAdjustPx('')
        setAdjustReason('')
        if (openId) await openPlayer(openId)
      } catch (e) {
        setActNote({ kind: 'bad', text: describeApiError(e, 'That action failed.') })
      } finally {
        setActBusy(false)
      }
    },
    [openId, openPlayer],
  )

  const flagged = useMemo(() => rows.filter((r) => r.risk >= 20 && !r.suspended).length, [rows])

  // Cosmetic gate. The real one is requireAdmin() on every request.
  if (ready && profile && !profile.is_admin) {
    return (
      <div className="mx-auto w-full max-w-[420px] px-4 py-16 text-center">
        <IconShield size={28} className="mx-auto mb-2 text-slate-600" />
        <p className="text-[14px] font-bold text-white">Admins only</p>
        <p className="mt-1 text-[11.5px] text-slate-500">This account does not have admin access.</p>
        <button type="button" onClick={onHome} className="btn-primary mt-3 !px-4 !py-2 !text-[12px]">
          Back to games
        </button>
      </div>
    )
  }

  // ------------------------------------------------------------ drill-down --
  if (openId) {
    return (
      <div className="mx-auto w-full max-w-[720px] px-4 py-8">
        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setOpenId(null); setDetail(null) }}
            aria-label="Back to players"
            className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-slate-300 transition hover:bg-white/10"
          >
            <IconChevronLeft size={17} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-bold text-white">
              {detail?.profile.username ?? 'Loading…'}
            </h1>
            <p className="text-[10.5px] text-slate-500">
              {detail ? `Joined ${new Date(detail.profile.created_at).toLocaleDateString()} · day ${detail.profile.age_days}` : 'One moment'}
            </p>
          </div>
        </div>

        {detailBusy && <p className="py-8 text-center text-[12px] text-slate-500">Loading…</p>}

        {detail && (
          <>
            {!detail.reconciled && (
              <div className="mb-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-200">
                The wallet does not match the newest ledger row. Something changed a balance without
                recording it — check the ledger below before trusting this figure.
              </div>
            )}

            <div className="mb-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {[
                { k: 'Balance', v: `UGX ${money(detail.wallet?.balance_px ?? 0)}` },
                { k: 'Wagered', v: `UGX ${money(detail.wallet?.wagered_px ?? 0)}` },
                { k: 'Cashed out', v: `UGX ${money(detail.wallet?.cashed_out_px ?? 0)}` },
                { k: 'Daily claims', v: String(detail.daily_claims) },
              ].map((s) => (
                <div key={s.k} className="panel px-2.5 py-2">
                  <p className="text-[9.5px] uppercase tracking-wider text-slate-500">{s.k}</p>
                  <p className="num text-[12.5px] font-bold text-white">{s.v}</p>
                </div>
              ))}
            </div>

            <div className="panel mb-2 px-3 py-2.5">
              <p className="label">Account</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10.5px]">
                <dt className="text-slate-500">Player id</dt>
                <dd className="num break-all text-slate-300">{detail.profile.id}</dd>
                <dt className="text-slate-500">Country</dt>
                <dd className="text-slate-300">{detail.profile.country || '—'}</dd>
                <dt className="text-slate-500">Phone</dt>
                <dd className="num text-slate-300">
                  {detail.profile.phone || '—'}
                  {detail.profile.phone && (
                    <span className={`ml-1.5 ${detail.profile.phone_verified ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {detail.profile.phone_verified ? 'verified' : 'unverified'}
                    </span>
                  )}
                </dd>
                <dt className="text-slate-500">Status</dt>
                <dd className={detail.profile.suspended ? 'text-rose-300' : 'text-emerald-300'}>
                  {detail.profile.suspended ? 'suspended' : 'active'}
                  {detail.profile.is_admin && <span className="ml-1.5 text-violet-300">· admin</span>}
                </dd>
              </dl>
            </div>

            {/* ------------------------------------------------ controls --- */}
            <div className="panel mb-2 px-3 py-2.5">
              <p className="text-[12px] font-bold text-white">Controls</p>
              <p className="mb-2 text-[9.5px] leading-relaxed text-slate-500">
                Every action is recorded against your account. Balance changes also write a ledger row.
              </p>

              {actNote && (
                <p
                  className={`mb-2 rounded-lg border px-2 py-1.5 text-[10.5px] ${
                    actNote.kind === 'ok'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                      : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                  }`}
                >
                  {actNote.text}
                </p>
              )}

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setAdjustOpen((v) => !v)}
                  className="btn-ghost !py-1.5 !text-[10.5px]"
                >
                  Adjust balance
                </button>
                <button
                  type="button"
                  disabled={actBusy}
                  onClick={() =>
                    void runAction({
                      action: detail.profile.suspended ? 'unsuspend' : 'suspend',
                      userId: detail.profile.id,
                      reason: 'set from the players screen',
                    })
                  }
                  className="btn-ghost !py-1.5 !text-[10.5px] disabled:opacity-40"
                >
                  {detail.profile.suspended ? 'Un-suspend' : 'Suspend'}
                </button>
                <button
                  type="button"
                  disabled={actBusy}
                  onClick={() =>
                    void runAction({
                      action: detail.profile.is_admin ? 'revoke_admin' : 'grant_admin',
                      userId: detail.profile.id,
                    })
                  }
                  className="btn-ghost !py-1.5 !text-[10.5px] disabled:opacity-40"
                >
                  {detail.profile.is_admin ? 'Revoke admin' : 'Make admin'}
                </button>
              </div>

              {adjustOpen && (
                <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2">
                  <p className="text-[10.5px] text-slate-300">
                    Credit or debit this wallet. A negative number takes UGX away.
                  </p>
                  <div className="mt-1.5 flex gap-1.5">
                    <input
                      value={adjustPx}
                      onChange={(e) => setAdjustPx(e.target.value)}
                      inputMode="numeric"
                      placeholder="UGX, e.g. 5000 or -5000"
                      className="field !py-1.5 !text-[11px]"
                    />
                  </div>
                  <input
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    placeholder="Reason (required, at least 8 characters)"
                    className="field mt-1.5 !py-1.5 !text-[11px]"
                  />
                  <button
                    type="button"
                    disabled={actBusy || adjustReason.trim().length < 8 || !Number.isFinite(Number(adjustPx)) || Number(adjustPx) === 0}
                    onClick={() =>
                      void runAction({
                        action: 'adjust',
                        userId: detail.profile.id,
                        deltaPx: Math.trunc(Number(adjustPx)),
                        reason: adjustReason.trim(),
                      })
                    }
                    className="btn-primary mt-1.5 w-full !py-1.5 !text-[10.5px] disabled:opacity-40"
                  >
                    {actBusy ? 'Applying…' : 'Apply adjustment'}
                  </button>
                </div>
              )}
            </div>

            <div className="panel mb-2 overflow-hidden">
              <div className="border-b border-white/[0.06] px-3 py-2">
                <p className="text-[12px] font-bold text-white">Recent activity</p>
                <p className="text-[9.5px] text-slate-500">Newest 100 entries. Every balance change must appear here.</p>
              </div>
              {detail.ledger.length === 0 && (
                <p className="px-3 py-6 text-center text-[11px] text-slate-500">No activity yet.</p>
              )}
              <div className="divide-y divide-white/[0.04]">
                {detail.ledger.map((l) => (
                  <div key={l.id} className="flex items-center gap-2 px-3 py-1.5">
                    <span className={`w-[86px] shrink-0 text-[10px] font-bold ${KIND_TONE[l.kind] ?? 'text-slate-400'}`}>
                      {l.kind}
                    </span>
                    <span className={`num w-[78px] shrink-0 text-[11px] font-bold ${l.delta_px >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {l.delta_px >= 0 ? '+' : ''}{money(l.delta_px)}
                    </span>
                    <span className="num min-w-0 flex-1 truncate text-[10px] text-slate-500">
                      {l.ref || '—'}
                    </span>
                    <span className="num shrink-0 text-[10px] text-slate-500">{money(l.balance_after)}</span>
                    <span className="w-[52px] shrink-0 text-right text-[9.5px] text-slate-600">{ago(l.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel overflow-hidden">
              <div className="border-b border-white/[0.06] px-3 py-2">
                <p className="text-[12px] font-bold text-white">Withdrawals</p>
              </div>
              {detail.cashouts.length === 0 && (
                <p className="px-3 py-6 text-center text-[11px] text-slate-500">Never withdrawn.</p>
              )}
              <div className="divide-y divide-white/[0.04]">
                {detail.cashouts.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="text-[10px] uppercase text-slate-400">{c.kind}</span>
                    <span className="num text-[11px] font-bold text-white">{money(c.ugx)} UGX</span>
                    <span className="num text-[10px] text-slate-500">(UGX {money(c.amount_px)})</span>
                    <span className={`ml-auto text-[10px] font-bold ${c.status === 'paid' ? 'text-emerald-300' : c.status === 'failed' ? 'text-rose-300' : 'text-amber-300'}`}>
                      {c.status}
                    </span>
                    <span className="w-[52px] shrink-0 text-right text-[9.5px] text-slate-600">{ago(c.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>

            <p className="mt-4 text-center text-[9.5px] leading-relaxed text-slate-600">
              Read-only. Balances change only through game settlement and the audited
              parked-payment release.
            </p>
          </>
        )}
      </div>
    )
  }

  // ----------------------------------------------------------------- table --
  return (
    <div className="mx-auto w-full max-w-[860px] px-4 py-8">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onHome}
          aria-label="Back to games"
          className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-slate-300 transition hover:bg-white/10"
        >
          <IconChevronLeft size={17} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] font-bold text-white">Players</h1>
          <p className="text-[10.5px] text-slate-500">Who is on the platform and what they are doing</p>
        </div>
        <button type="button" onClick={() => void load()} className="btn-ghost !px-3 !py-1.5 !text-[11px]">
          Refresh
        </button>
      </div>

      {totals && (
        <div className="mb-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {[
            { k: 'Players', v: String(totals.players) },
            { k: 'UGX in wallets', v: money(totals.px_in_circulation) },
            { k: 'UGX wagered', v: money(totals.px_wagered) },
            { k: 'Claimed today', v: String(totals.claims_today) },
          ].map((s) => (
            <div key={s.k} className="panel px-2.5 py-2">
              <p className="text-[9.5px] uppercase tracking-wider text-slate-500">{s.k}</p>
              <p className="num text-[13px] font-bold text-white">{s.v}</p>
            </div>
          ))}
        </div>
      )}

      {flagged > 0 && (
        <p className="mb-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-2 text-[11px] text-amber-200">
          {flagged} account{flagged > 1 ? 's' : ''} received credit without much wagering behind
          {flagged > 1 ? ' them' : ' it'} — sorted under “Worth a look”. A signal, not a verdict.
        </p>
      )}

      <div className="mb-2 flex items-center gap-1.5">
        <IconSearch size={13} className="shrink-0 text-slate-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a username (3+ characters)"
          className="field !py-1.5 !text-[11px]"
        />
      </div>

      <div className="mb-2 flex gap-1">
        {SORTS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSort(s.id)}
            className={`flex-1 rounded-lg border py-1.5 text-[10.5px] font-bold transition ${
              sort === s.id
                ? 'border-neon-lime bg-neon-lime/15 text-neon-lime'
                : 'border-white/10 bg-white/[0.02] text-slate-400'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-200">
          <IconShield size={13} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && <p className="py-8 text-center text-[12px] text-slate-500">Loading…</p>}

      {!loading && !error && rows.length === 0 && (
        <div className="panel px-3 py-8 text-center">
          <p className="text-[13px] font-bold text-white">No players found</p>
          <p className="mt-1 text-[11px] text-slate-500">
            {query.trim().length >= 3 ? 'Nothing matches that search.' : 'Nobody has signed up yet.'}
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => void openPlayer(r.id)}
            className="panel flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-white/[0.04]"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[12.5px] font-bold text-white">{r.username}</span>
                {r.is_admin && (
                  <span className="shrink-0 rounded bg-violet-500/20 px-1 text-[8.5px] font-bold uppercase text-violet-300">admin</span>
                )}
                {r.suspended && (
                  <span className="shrink-0 rounded bg-rose-500/20 px-1 text-[8.5px] font-bold uppercase text-rose-300">suspended</span>
                )}
                {r.risk >= 20 && (
                  <span className="shrink-0 rounded bg-amber-400/20 px-1 text-[8.5px] font-bold uppercase text-amber-300">watch</span>
                )}
              </div>
              <p className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <IconClock size={9} />
                day {r.age_days} · {r.daily_claims} claims · {r.country || 'UG'}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="num text-[11.5px] font-bold text-white">UGX {money(r.balance_px)}</p>
              <p className="num text-[9.5px] text-slate-500">wagered {money(r.wagered_px)}</p>
            </div>
          </button>
        ))}
      </div>

      <p className="mt-4 text-center text-[9.5px] leading-relaxed text-slate-600">
        Read-only. Open a player to see the ledger that produced their balance.
      </p>
    </div>
  )
}
