import React, { useCallback, useEffect, useState } from 'react'
import {
  isNativeApp, nativeStatus, requestPermission, smsConfirmations, lastKnownLocation,
  type NativeStatus,
} from '../lib/native'
import { IconCheck, IconClose, IconInfo, IconLive, IconShield } from './Icons'
import { sfx } from '../lib/sound'

/**
 * The permission card.
 *
 * It is a card, not a start-up dialog, for one reason: Android's SMS permission is
 * the single most invasive thing this app can ask for, and a player who is asked
 * for it before they have seen the product has no idea what it is for. So the
 * card appears where the permission is useful — the deposit screen — states what
 * is read and what is not, and does nothing until it is pressed.
 *
 * A refusal is a normal outcome, not an error: the deposit still works, it just
 * cannot be noticed from the network's SMS, and the button says so.
 */
export function PermissionsCard({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<NativeStatus>(() => nativeStatus())
  const [smsSample, setSmsSample] = useState<string | null>(null)
  const [where, setWhere] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  const native = isNativeApp()

  // Android answers a permission dialog asynchronously, on its own schedule.
  // Re-reading on an interval while the card is on screen is how the answer gets
  // here; the card stops as soon as both are granted.
  useEffect(() => {
    if (!native) return
    const t = window.setInterval(() => {
      const s = nativeStatus()
      setStatus(s)
      if (s.sms && s.location) window.clearInterval(t)
    }, 1200)
    return () => window.clearInterval(t)
  }, [native])

  const readSms = useCallback(() => {
    const rows = smsConfirmations()
    if (!rows.length) {
      setSmsSample('No mobile-money confirmations on this phone yet.')
      return
    }
    const newest = rows[0]
    // Only the provider and the amount are shown back: an inbox is not ours to
    // put on screen.
    const m = newest.body.match(/(UGX\s?[0-9][0-9,\.]*)/i)
    setSmsSample(`${newest.address || 'network'} · ${m ? m[1] : 'confirmation'} · ${new Date(newest.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`)
  }, [])

  const readWhere = useCallback(() => {
    const l = lastKnownLocation()
    if (!l.ok) {
      setWhere('No position yet — location may be off on this phone.')
      return
    }
    // Deliberately not the coordinates: the player needs to know it worked, not
    // to read a latitude.
    setWhere(`Located to about ${Math.round(l.accuracy)}m · fix is ${Math.round(l.age_ms / 60000)} min old`)
  }, [])

  if (!native || dismissed) return null

  const all = status.sms && status.location

  return (
    <div className={`rounded-xl border p-3 ${all ? 'border-emerald-500/25 bg-emerald-500/[0.06]' : 'border-white/[0.09] bg-white/[0.02]'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[12px] font-bold text-white">
            <IconShield size={13} className={all ? 'text-emerald-400' : 'text-neon-lime'} />
            {all ? 'Phone checks are on' : 'Turn on phone checks'}
          </p>
          <p className="mt-0.5 text-[10.5px] leading-relaxed text-slate-400">
            {all
              ? 'Deposits are noticed the moment the network confirms them.'
              : 'Two permissions, both optional. The app works without them.'}
          </p>
        </div>
        {!compact && (
          <button type="button" onClick={() => setDismissed(true)} aria-label="Hide" className="shrink-0 text-slate-600 hover:text-white">
            <IconClose size={13} />
          </button>
        )}
      </div>

      <div className="mt-2.5 space-y-2">
        {/* ------------------------------------------------------------- SMS -- */}
        <div className="rounded-lg bg-black/25 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11.5px] font-semibold text-slate-200">Mobile-money messages</p>
              <p className="text-[10px] leading-relaxed text-slate-500">
                Reads MTN and Airtel confirmations only, to spot a deposit early. Never sends a
                text, never leaves this phone.
              </p>
            </div>
            {status.sms ? (
              <span className="flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                <IconCheck size={11} /> on
              </span>
            ) : (
              <button type="button" onClick={() => { requestPermission('sms'); sfx.click() }} className="btn-dark shrink-0 !px-2.5 !py-1.5 !text-[11px]">
                Allow
              </button>
            )}
          </div>
          {status.sms && (
            <button type="button" onClick={readSms} className="mt-1.5 text-[10px] font-semibold text-neon-lime hover:underline">
              Check for a confirmation
            </button>
          )}
          {smsSample && <p className="mt-1 text-[10px] text-slate-400">{smsSample}</p>}
        </div>

        {/* -------------------------------------------------------- location -- */}
        <div className="rounded-lg bg-black/25 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11.5px] font-semibold text-slate-200">Location</p>
              <p className="text-[10px] leading-relaxed text-slate-500">
                A country check for the payment rail, from the last known fix. No tracking, no
                background access.
              </p>
            </div>
            {status.location ? (
              <span className="flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                <IconCheck size={11} /> on
              </span>
            ) : (
              <button type="button" onClick={() => { requestPermission('location'); sfx.click() }} className="btn-dark shrink-0 !px-2.5 !py-1.5 !text-[11px]">
                Allow
              </button>
            )}
          </div>
          {status.location && (
            <button type="button" onClick={readWhere} className="mt-1.5 text-[10px] font-semibold text-neon-lime hover:underline">
              Check my region
            </button>
          )}
          {where && <p className="mt-1 text-[10px] text-slate-400">{where}</p>}
        </div>
      </div>

      {!all && (
        <p className="mt-2 flex items-start gap-1.5 text-[9.5px] leading-relaxed text-slate-600">
          <IconInfo size={10} className="mt-0.5 shrink-0 text-slate-500" />
          A denial is fine: deposits still work, they are just confirmed by the server instead of
          by the message on your phone.
        </p>
      )}
      {all && (
        <p className="mt-2 flex items-center gap-1.5 text-[9.5px] text-slate-600">
          <IconLive size={10} className="text-emerald-500" /> Android permission state, read from the phone.
        </p>
      )}
    </div>
  )
}
