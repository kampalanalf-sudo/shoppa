import React, { useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { sfx } from '../lib/sound'
import { IconCheck, IconShield } from '../components/Icons'

/**
 * Set a new password.
 *
 * This is the landing page for a password-recovery link. Supabase's recovery
 * redirect signs the user in with a short-lived session and sends them to
 * `#reset-password`; without this page the link was a dead end, because
 * `resetPasswordForEmail` sent mail that could never actually change anything —
 * there was no `updateUser({ password })` call anywhere in the app.
 *
 * It is also reachable deliberately via `#reset-password` for a signed-in
 * player who just wants to change their password, so it checks the session
 * rather than assuming the recovery flow.
 */
export function SetPassword({ onDone }: { onDone?: () => void }) {
  const { updatePassword, user, configured, recoveryReady, recoveryError, clearRecovery } = useAuth()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Supabase enforces a minimum of 6 by default on this project, but a player's
  // password is the only thing between someone and their wallet: hold the line
  // at 8 here and say why rather than letting a 6-character secret through.
  const strength = useMemo(() => {
    if (!password) return 0
    let s = 0
    if (password.length >= 8) s++
    if (password.length >= 12) s++
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) s++
    if (/\d/.test(password)) s++
    if (/[^A-Za-z0-9]/.test(password)) s++
    return Math.min(4, s)
  }, [password])

  const longEnough = password.length >= 8
  const matches = password.length > 0 && password === confirm
  const canSubmit = longEnough && matches && !busy

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    sfx.click()
    try {
      await updatePassword(password)
      setDone(true)
      sfx.win()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const bar = ['bg-rose-500', 'bg-amber-400', 'bg-neon-lime', 'bg-emerald-400'][Math.max(0, strength - 1)]
  const barLabel = ['Too short', 'Weak', 'Good', 'Strong'][Math.max(0, strength - 1)]

  return (
    <div className="mx-auto w-full max-w-[420px] px-4 py-10">
      <div className="mb-6 text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">
          <IconShield size={12} className="text-neon-lime" />
          <span className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">
            Account security
          </span>
        </div>
        <h1 className="text-[24px] font-black leading-tight text-white">Set a new password</h1>
        <p className="mt-1 text-[12.5px] text-slate-500">
          {user?.email ? `For ${user.email}` : 'Choose a password you have not used elsewhere.'}
        </p>
      </div>

      {!configured && (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-[11.5px] text-amber-200">
          Accounts are not configured on this build, so there is nothing to update.
        </div>
      )}

      {(recoveryError || (!user && configured && !recoveryReady)) && (
        <div className="mb-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2.5 text-[11.5px] text-rose-200">
          <p className="font-bold">This reset link is no longer valid.</p>
          <p className="mt-0.5 leading-snug text-rose-200/75">
            {recoveryError || 'It has expired, or it was already used.'} Reset links are single-use
            and last one hour.
          </p>
          <button
            type="button"
            onClick={() => {
              clearRecovery()
              window.location.hash = 'auth'
            }}
            className="mt-2 font-bold underline decoration-rose-300/40 underline-offset-2"
          >
            Request a new link
          </button>
        </div>
      )}

      {done ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-3">
            <p className="flex items-center gap-2 text-[12.5px] font-bold text-emerald-200">
              <IconCheck size={14} /> Password updated
            </p>
            <p className="mt-1 text-[11.5px] leading-snug text-emerald-200/70">
              You are signed in on this device. Any other session stays signed in until it expires —
              sign out everywhere if you think someone else had access.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              clearRecovery()
              window.location.hash = 'home'
              onDone?.()
            }}
            className="btn-primary w-full !py-3 !text-[13px]"
          >
            Continue to FloatBet
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3.5">
          <div>
            <label className="label" htmlFor="new-password">New password</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field"
              placeholder="At least 8 characters"
            />
            {password.length > 0 && (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex h-1 flex-1 gap-1">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={`h-full flex-1 rounded-full transition-colors ${
                        i < strength ? bar : 'bg-white/10'
                      }`}
                    />
                  ))}
                </div>
                <span className="w-16 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {barLabel}
                </span>
              </div>
            )}
          </div>

          <div>
            <label className="label" htmlFor="confirm-password">Confirm password</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="field"
              placeholder="Type it again"
            />
            {confirm.length > 0 && !matches && (
              <p className="mt-1 text-[10.5px] text-rose-300">Those do not match.</p>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11.5px] text-rose-200">
              {error}
            </div>
          )}

          <button type="submit" disabled={!canSubmit} className="btn-primary w-full !py-3 !text-[13px]">
            {busy ? 'Updating…' : 'Update password'}
          </button>

          <p className="text-center text-[10px] leading-relaxed text-slate-600">
            We never email your password, and no one at FloatBet can see it.
          </p>
        </form>
      )}
    </div>
  )
}
