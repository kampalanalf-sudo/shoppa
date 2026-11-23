import React, { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { money } from '../lib/format'
import { api, describeApiError } from '../lib/api'
import { IconChevronLeft, IconShield, IconCheck, IconClock, IconLive } from '../components/Icons'

/**
 * The admin console: health, withdrawals, and the audit trail in one place.
 *
 * A note on why the destructive controls look the way they do.
 *
 * Adjusting a balance and settling a payout are irreversible in the sense that
 * matters — the money has moved. So neither is a single tap: the adjustment
 * needs a typed reason before the button enables, and every settle asks for a
 * confirmation that names the amount and the player. That is not friction for
 * its own sake; it is the two seconds that stops a mis-click becoming a payout
 * to the wrong person.
 *
 * Everything here is also recorded server-side in admin_actions, so the UI
 * being convenient never means the action being untraceable.
 */

type Check = { key: string; label: string; state: 'ok' | 'warn' | 'bad'; detail: string }

type Cashout = {
  id: string
  user_id: string
  kind: string
  amount_px: number
  ugx: number
  phone: string | null
  rail: string | null
  asset: string | null
  status: string
  failure_reason: string | null
  created_at: string
}

type AuditRow = {
  id: number
  action: string
  admin_name: string
  target_name: string | null
  detail: Record<string, unknown> | null
  created_at: string
}

type Tab = 'health' | 'cashouts' | 'audit'

const ago = (iso: string): string => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

const DOT: Record<Check['state'], string> = {
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  bad: 'bg-rose-400',
}

export function AdminConsole({ onHome }: { onHome: () => void }) {
  const { profile, ready } = useAuth()
  const [tab, setTab] = useState<Tab>('health')

  const [checks, setChecks] = useState<Check[]>([])
  const [healthBusy, setHealthBusy] = useState(true)

  const [cashouts, setCashouts] = useState<Cashout[]>([])
  const [players, setPlayers] = useState<Record<string, { username: string; phone_verified: boolean }>>({})
  const [totals, setTotals] = useState<{ count: number; ugx_due: number; oldest_hours: number } | null>(null)
  const [cashBusy, setCashBusy] = useState(false)
  const [cashStatus, setCashStatus] = useState('requested')

  const [audit, setAudit] = useState<AuditRow[]>([])
  const [auditBusy, setAuditBusy] = useState(false)

  const [note, setNote] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [confirm, setConfirm] = useState<{ co: Cashout; action: 'paid' | 'failed' } | null>(null)
  const [reason, setReason] = useState('')

  const loadHealth = useCallback(async () => {
    setHealthBusy(true)
    try {
      const body = await api<{ checks?: Check[] }>('/api/admin/health')
      setChecks(body.checks ?? [])
      setNote(null)
    } catch (e) {
      setChecks([])
      setNote({ kind: 'bad', text: describeApiError(e, 'Could not run the health checks.') })
    } finally {
      setHealthBusy(false)
    }
  }, [])

  const loadCashouts = useCallback(async () => {
    setCashBusy(true)
    try {
      const body = await api<{
        rows?: Cashout[]
        players?: Record<string, { username: string; phone_verified: boolean }>
        totals?: { count: number; ugx_due: number; oldest_hours: number }
      }>('/api/admin/cashouts', { params: { status: cashStatus } })
      setCashouts(body.rows ?? [])
      setPlayers(body.players ?? {})
      setTotals(body.totals ?? null)
      setNote(null)
    } catch (e) {
      setCashouts([])
      setPlayers({})
      setTotals(null)
      setNote({ kind: 'bad', text: describeApiError(e, 'Could not load the withdrawal queue.') })
    } finally {
      setCashBusy(false)
    }
  }, [cashStatus])

  const loadAudit = useCallback(async () => {
    setAuditBusy(true)
    try {
      const body = await api<{ rows?: AuditRow[] }>('/api/admin/audit', { params: { limit: '150' } })
      setAudit(body.rows ?? [])
      setNote(null)
    } catch (e) {
      setAudit([])
      setNote({ kind: 'bad', text: describeApiError(e, 'Could not load the action log.') })
    } finally {
      setAuditBusy(false)
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    if (tab === 'health') void loadHealth()
    if (tab === 'cashouts') void loadCashouts()
    if (tab === 'audit') void loadAudit()
  }, [ready, tab, loadHealth, loadCashouts, loadAudit])

  const settle = useCallback(
    async (co: Cashout, action: 'paid' | 'failed' | 'cancelled') => {
      setNote(null)
      try {
        await api('/api/admin/actions', {
          method: 'POST',
          body: {
            action: 'settle_cashout',
            cashoutId: co.id,
            status: action,
            reason: reason.trim() || undefined,
          },
        })
        setNote({
          kind: 'ok',
          text:
            action === 'paid'
              ? `Paid ${money(co.ugx)} UGX to ${players[co.user_id]?.username ?? 'the player'}.`
              : `Cancelled — ${money(co.amount_px)} PX returned to the player's wallet.`,
        })
      } catch (e) {
        setNote({ kind: 'bad', text: describeApiError(e, 'That did not go through.') })
      }
      setConfirm(null)
      setReason('')
      void loadCashouts()
    },
    [players, reason, loadCashouts],
  )

  if (ready && profile && !profile.is_admin) {
    return (
      <div className="mx-auto w-full max-w-[420px] px-4 py-16 text-center">
        <IconShield size={28} className="mx-auto mb-2 text-slate-600" />
        <p className="text-[14px] font-bold text-white">Admins only</p>
        <button type="button" onClick={onHome} className="btn-primary mt-3 !px-4 !py-2 !text-[12px]">
          Back to games
        </button>
      </div>
    )
  }

  const worst = checks.some((c) => c.state === 'bad')
    ? 'bad'
    : checks.some((c) => c.state === 'warn')
      ? 'warn'
      : 'ok'

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-8">
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
          <h1 className="text-[15px] font-bold text-white">Admin console</h1>
          <p className="flex items-center gap-1.5 text-[10.5px] text-slate-500">
            <span className={`h-1.5 w-1.5 rounded-full ${DOT[worst]}`} />
            {tab === 'health'
              ? checks.length
                ? `${checks.filter((c) => c.state !== 'ok').length} of ${checks.length} need attention`
                : 'checking…'
              : `signed in as ${profile?.username ?? '—'}`}
          </p>
        </div>
      </div>

      <div className="mb-2 flex gap-1">
        {(
          [
            ['health', 'Health'],
            ['cashouts', 'Withdrawals'],
            ['audit', 'Audit'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 rounded-lg border py-1.5 text-[11px] font-bold transition ${
              tab === id
                ? 'border-neon-lime bg-neon-lime/15 text-neon-lime'
                : 'border-white/10 bg-white/[0.02] text-slate-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {note && (
        <p
          className={`mb-2 rounded-lg border px-2.5 py-2 text-[11px] ${
            note.kind === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
          }`}
        >
          {note.text}
        </p>
      )}

      {/* ------------------------------------------------------ health --- */}
      {tab === 'health' && (
        <div className="space-y-1.5">
          {healthBusy && <p className="py-8 text-center text-[12px] text-slate-500">Checking…</p>}
          {!healthBusy && checks.length === 0 && (
            <div className="panel px-3 py-4 text-center">
              <p className="text-[12px] font-bold text-white">No checks came back</p>
              <p className="mt-1 text-[10.5px] leading-relaxed text-slate-400">
                {note?.text ??
                  'The health route returned nothing. This is usually a deployed-function problem, not the database.'}
              </p>
            </div>
          )}
          {checks.map((c) => (
            <div key={c.key} className="panel flex items-start gap-2 px-3 py-2">
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${DOT[c.state]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-bold text-white">{c.label}</p>
                <p className="text-[10.5px] leading-relaxed text-slate-400">{c.detail}</p>
              </div>
              {c.state === 'ok' ? (
                <IconCheck size={13} className="mt-0.5 shrink-0 text-emerald-400" />
              ) : (
                <IconClock size={13} className="mt-0.5 shrink-0 text-amber-400" />
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => void loadHealth()}
            className="btn-ghost mt-2 w-full !py-1.5 !text-[11px]"
          >
            Re-check
          </button>
        </div>
      )}

      {/* --------------------------------------------------- cashouts --- */}
      {tab === 'cashouts' && (
        <>
          <div className="mb-2 flex gap-1">
            {['requested', 'pending_provider', 'paid', 'failed'].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setCashStatus(s)}
                className={`flex-1 rounded-lg border py-1.5 text-[10px] font-bold capitalize transition ${
                  cashStatus === s
                    ? 'border-neon-lime bg-neon-lime/15 text-neon-lime'
                    : 'border-white/10 bg-white/[0.02] text-slate-400'
                }`}
              >
                {s.replace('_', ' ')}
              </button>
            ))}
          </div>

          {totals && totals.count > 0 && (
            <p className="mb-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-2.5 py-1.5 text-[10.5px] text-amber-200">
              {totals.count} to pay · {money(totals.ugx_due)} UGX outstanding
              {totals.oldest_hours > 24 && ` · oldest ${Math.floor(totals.oldest_hours / 24)}d old`}
            </p>
          )}

          {cashBusy && <p className="py-8 text-center text-[12px] text-slate-500">Loading…</p>}

          {!cashBusy && cashouts.length === 0 && (
            <div className="panel px-3 py-8 text-center">
              <p className="text-[13px] font-bold text-white">Nothing in this queue</p>
              <p className="mt-1 text-[11px] text-slate-500">
                {cashStatus === 'requested'
                  ? 'No player has asked for a withdrawal yet.'
                  : `No ${cashStatus.replace('_', ' ')} withdrawals.`}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            {cashouts.map((co) => {
              const p = players[co.user_id]
              const open = co.status === 'requested' || co.status === 'pending_provider'
              return (
                <div key={co.id} className="panel px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5">
                        <span className="num text-[13px] font-bold text-white">{money(co.ugx)} UGX</span>
                        <span className="num text-[10px] text-slate-500">
                          {money(co.amount_px)} PX
                        </span>
                        <span className="rounded bg-white/10 px-1 text-[8.5px] font-bold uppercase text-slate-300">
                          {co.kind}
                        </span>
                      </p>
                      <p className="truncate text-[10.5px] text-slate-500">
                        {p?.username ?? co.user_id.slice(0, 8)}
                        {co.phone && ` · ${co.phone}`}
                        {co.rail && ` · ${co.rail}`}
                        {co.asset && ` · ${co.asset}`}
                        {p && !p.phone_verified && (
                          <span className="ml-1 text-amber-400">· phone unverified</span>
                        )}
                      </p>
                    </div>
                    <span className="shrink-0 text-[9.5px] text-slate-600">{ago(co.created_at)}</span>
                  </div>

                  {co.failure_reason && (
                    <p className="mt-1 text-[10px] text-rose-300">{co.failure_reason}</p>
                  )}

                  {open && !confirm && (
                    <div className="mt-2 flex gap-1.5">
                      {co.kind === 'momo' && (
                        <button
                          type="button"
                          onClick={() => { setConfirm({ co, action: 'paid' }); setReason('') }}
                          className="btn-primary flex-1 !py-1.5 !text-[10.5px]"
                        >
                          Pay {money(co.ugx)} UGX via MoMo
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { setConfirm({ co, action: 'failed' }); setReason('') }}
                        className="btn-ghost flex-1 !py-1.5 !text-[10.5px]"
                      >
                        Reject &amp; refund
                      </button>
                    </div>
                  )}

                  {open && confirm?.co.id === co.id && (
                    <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2">
                      <p className="text-[10.5px] leading-relaxed text-slate-300">
                        {confirm.action === 'paid'
                          ? `Send ${money(co.ugx)} UGX to ${co.phone} on ${co.rail} now? This calls the payment provider and cannot be undone from here.`
                          : `Refuse this withdrawal and return ${money(co.amount_px)} PX to ${p?.username ?? 'the player'}?`}
                      </p>
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder={confirm.action === 'paid' ? 'Note (optional)' : 'Why (shown to nobody, kept in the log)'}
                        className="field mt-1.5 !py-1.5 !text-[11px]"
                      />
                      <div className="mt-1.5 flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => void settle(co, confirm.action)}
                          className={`flex-1 !py-1.5 !text-[10.5px] ${confirm.action === 'paid' ? 'btn-primary' : 'btn-ghost'}`}
                        >
                          {confirm.action === 'paid' ? 'Yes, send it' : 'Yes, refund it'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirm(null)}
                          className="btn-ghost !py-1.5 !text-[10.5px]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ------------------------------------------------------ audit --- */}
      {tab === 'audit' && (
        <>
          {auditBusy && <p className="py-8 text-center text-[12px] text-slate-500">Loading…</p>}
          {!auditBusy && audit.length === 0 && (
            <div className="panel px-3 py-8 text-center">
              <p className="text-[13px] font-bold text-white">Nothing recorded yet</p>
              <p className="mt-1 text-[11px] text-slate-500">
                Every adjustment, suspension and payout decision appears here.
              </p>
            </div>
          )}
          <div className="space-y-1">
            {audit.map((a) => {
              const delta = a.detail?.delta_px
              return (
                <div key={a.id} className="panel flex items-center gap-2 px-3 py-1.5">
                  <IconLive size={11} className="shrink-0 text-slate-600" />
                  <span className="w-[104px] shrink-0 truncate text-[10.5px] font-bold text-violet-300">
                    {a.action}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[10.5px] text-slate-300">
                    {a.admin_name} → {a.target_name ?? '—'}
                    {typeof delta === 'number' && (
                      <span className={delta >= 0 ? ' text-emerald-400' : ' text-rose-400'}>
                        {' '}
                        {delta >= 0 ? '+' : ''}
                        {money(delta)} PX
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-[9.5px] text-slate-600">{ago(a.created_at)}</span>
                </div>
              )
            })}
          </div>
          {audit.length > 0 && (
            <p className="mt-3 text-center text-[9.5px] text-slate-600">
              Append-only. Written by the database, not by this page.
            </p>
          )}
        </>
      )}
    </div>
  )
}
