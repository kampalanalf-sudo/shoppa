import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { money } from '../lib/format'
import { api, describeApiError } from '../lib/api'
import { IconChevronLeft, IconShield, IconSearch, IconClose } from '../components/Icons'

type ParkedRow = {
  id: string
  reference: string
  status: 'pending' | 'completed' | 'failed'
  amount: number
  currency: string
  quantity: number
  product_slug: string | null
  buyer_name: string | null
  buyer_email: string | null
  buyer_phone: string | null
  parked_reason: string | null
  matched_by: string | null
  user_id: string | null
  created_at: string
}

type Account = { id: string; username: string; display_name: string | null }

const REASON: Record<string, string> = {
  no_checkout_email: 'No email came back from the checkout',
  email_not_registered: 'Checkout email has no account',
  email_ambiguous: 'Several accounts share that email',
}

/**
 * Parked-payment queue.
 *
 * A store top-up lands here when DGateway confirmed the money but we could not
 * match it to exactly one account. An admin decides who it belongs to; nothing
 * on this page credits automatically.
 */
export function AdminParked({ onHome }: { onHome: () => void }) {
  const { profile, ready } = useAuth()

  const [rows, setRows] = useState<ParkedRow[]>([])
  const [status, setStatus] = useState<'pending' | 'completed' | 'failed'>('pending')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openRef, setOpenRef] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Account[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const body = await api<{ rows?: ParkedRow[] }>('/api/admin/parked', {
        params: { status, limit: '100' },
      })
      setRows(body.rows ?? [])
    } catch (e) {
      setRows([])
      setError(describeApiError(e, 'Could not load the queue.'))
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    if (ready) void load()
  }, [ready, load])

  const search = useCallback(async (q: string) => {
    setQuery(q)
    if (q.trim().length < 3) {
      setResults([])
      return
    }
    try {
      const body = await api<{ rows?: Account[] }>('/api/admin/lookup', { params: { q: q.trim() } })
      setResults(body.rows ?? [])
    } catch {
      // A failed lookup is not worth an error banner: the admin is mid-typing,
      // and the next keystroke retries.
      setResults([])
    }
  }, [])

  const act = useCallback(
    async (row: ParkedRow, action: 'release' | 'dismiss', userId?: string) => {
      setBusy(true)
      setNote(null)
      try {
        const body = await api<{ px?: number; balance?: number }>('/api/admin/parked', {
          method: 'POST',
          body: { reference: row.reference, action, userId },
        })
        setNote(
          action === 'release'
            ? `Released UGX ${money(body.px ?? 0)} — new balance UGX ${money(body.balance ?? 0)}.`
            : 'Dismissed. This payment will never be credited.',
        )
        setOpenRef(null)
        setQuery('')
        setResults([])
        await load()
      } catch (e) {
        setNote(describeApiError(e, 'That action failed.'))
      } finally {
        setBusy(false)
      }
    },
    [load],
  )

  const pendingCount = useMemo(() => rows.filter((r) => r.status === 'pending').length, [rows])

  // Cosmetic gate only. The real gate is requireAdmin() on every API call, so
  // hiding the page is a convenience, not a security control.
  if (ready && profile && !profile.is_admin) {
    return (
      <div className="mx-auto w-full max-w-[420px] px-4 py-16 text-center">
        <IconShield size={28} className="mx-auto mb-2 text-slate-600" />
        <p className="text-[14px] font-bold text-white">Admins only</p>
        <p className="mt-1 text-[11.5px] text-slate-500">
          This account does not have admin access.
        </p>
        <button type="button" onClick={onHome} className="btn-primary mt-3 !px-4 !py-2 !text-[12px]">
          Back to games
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-8">
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
          <h1 className="text-[15px] font-bold text-white">Parked payments</h1>
          <p className="text-[10.5px] text-slate-500">
            Money DGateway confirmed that we could not match to one account
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="btn-ghost !px-3 !py-1.5 !text-[11px]">
          Refresh
        </button>
      </div>

      <div className="mb-2 flex gap-1">
        {(['pending', 'completed', 'failed'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`flex-1 rounded-lg border py-1.5 text-[11px] font-bold capitalize transition ${
              status === s
                ? 'border-neon-lime bg-neon-lime/15 text-neon-lime'
                : 'border-white/10 bg-white/[0.02] text-slate-400'
            }`}
          >
            {s}
            {s === 'pending' && status === 'pending' && pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
        ))}
      </div>

      {note && (
        <p className="mb-2 rounded-lg border border-neon-cyan/30 bg-neon-cyan/10 px-2.5 py-2 text-[11px] text-neon-cyan">
          {note}
        </p>
      )}
      {error && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-200">
          <IconShield size={13} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && <p className="py-8 text-center text-[12px] text-slate-500">Loading…</p>}

      {!loading && !error && rows.length === 0 && (
        <div className="panel px-3 py-8 text-center">
          <p className="text-[13px] font-bold text-white">Nothing parked</p>
          <p className="mt-1 text-[11px] text-slate-500">
            Every {status} store payment has been accounted for.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        {rows.map((row) => {
          const open = openRef === row.reference
          const px = row.amount * 10 * row.quantity
          return (
            <div key={row.id} className="panel overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  setOpenRef(open ? null : row.reference)
                  setQuery('')
                  setResults([])
                  setNote(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="num text-[13px] font-bold text-white">
                      {money(row.amount)} {row.currency}
                    </span>
                    {row.quantity > 1 && (
                      <span className="rounded bg-white/10 px-1 text-[9px] font-bold text-slate-300">
                        ×{row.quantity}
                      </span>
                    )}
                    <span className="text-[10px] text-neon-lime">UGX {money(px)}</span>
                  </div>
                  <p className="truncate text-[10.5px] text-slate-500">
                    {row.buyer_email || 'no email'} · {row.product_slug || 'unknown product'}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                    row.status === 'pending'
                      ? 'bg-amber-400/15 text-amber-300'
                      : row.status === 'completed'
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-rose-500/15 text-rose-300'
                  }`}
                >
                  {row.status}
                </span>
              </button>

              {open && (
                <div className="border-t border-white/[0.07] px-3 py-2.5">
                  <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10.5px]">
                    <dt className="text-slate-500">Reference</dt>
                    <dd className="num break-all text-slate-300">{row.reference}</dd>
                    <dt className="text-slate-500">Why parked</dt>
                    <dd className="text-amber-300">
                      {REASON[row.parked_reason ?? ''] || row.parked_reason || '—'}
                    </dd>
                    {row.buyer_name && (
                      <>
                        <dt className="text-slate-500">Name</dt>
                        <dd className="text-slate-300">{row.buyer_name}</dd>
                      </>
                    )}
                    {row.buyer_phone && (
                      <>
                        <dt className="text-slate-500">Phone</dt>
                        <dd className="num text-slate-300">{row.buyer_phone}</dd>
                      </>
                    )}
                    <dt className="text-slate-500">Paid at</dt>
                    <dd className="text-slate-300">{new Date(row.created_at).toLocaleString()}</dd>
                  </dl>

                  {row.status === 'pending' && (
                    <>
                      <p className="label">Credit to which account?</p>
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <IconSearch size={13} className="shrink-0 text-slate-500" />
                        <input
                          value={query}
                          onChange={(e) => void search(e.target.value)}
                          placeholder="Search username to confirm the owner"
                          className="field !py-1.5 !text-[11px]"
                        />
                      </div>

                      {results.length > 0 && (
                        <div className="mb-1.5 space-y-1">
                          {results.map((a) => (
                            <div
                              key={a.id}
                              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1.5"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[11.5px] font-bold text-white">
                                  {a.username}
                                </p>
                                <p className="num truncate text-[9.5px] text-slate-500">{a.id}</p>
                              </div>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void act(row, 'release', a.id)}
                                className="btn-primary shrink-0 !px-2.5 !py-1 !text-[10.5px] disabled:opacity-40"
                              >
                                {busy ? '…' : `Release UGX ${money(px)}`}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void act(row, 'dismiss')}
                          className="btn-ghost flex-1 !py-1.5 !text-[10.5px] disabled:opacity-40"
                        >
                          <IconClose size={11} className="mr-1 inline" />
                          Dismiss — never credit
                        </button>
                      </div>
                      <p className="mt-1.5 text-[9.5px] leading-relaxed text-slate-600">
                        Releasing credits the player immediately and records you as the approver.
                        Only do it once you are satisfied the payer is that account.
                      </p>
                    </>
                  )}

                  {row.status !== 'pending' && (
                    <p className="text-[10.5px] text-slate-500">
                      {row.status === 'completed'
                        ? `Credited${row.matched_by ? ` (${row.matched_by})` : ''}${row.user_id ? ` to ${row.user_id.slice(0, 8)}…` : ''}`
                        : 'Never credited.'}
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="mt-4 text-center text-[9.5px] text-slate-600">
        Every release and dismissal is recorded with the admin who made it.
      </p>
    </div>
  )
}
