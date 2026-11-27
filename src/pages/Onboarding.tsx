import React, { useState } from 'react'
import { useAuth } from '../lib/auth'
import { money } from '../lib/format'
import { sfx } from '../lib/sound'
import { IconCheck, IconShield } from '../components/Icons'

/**
 * Blocks play until the player has a real handle and has confirmed 18+.
 * Both are required by the database before any cashout will be accepted.
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { profile, wallet, updateProfile, startPhoneVerification, confirmPhoneVerification } = useAuth()

  const [username, setUsername] = useState(
    profile && !profile.username.startsWith('player') ? profile.username : '',
  )
  const [age, setAge] = useState(profile?.age_confirmed ?? false)
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'otp' | 'done'>(profile?.phone_verified ? 'done' : 'otp')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const usernameOk = /^[a-zA-Z0-9_]{3,18}$/.test(username)

  const saveBasics = async () => {
    setBusy(true)
    setError(null)
    try {
      await updateProfile({ username, age_confirmed: age })
      sfx.win()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const sendCode = async () => {
    setBusy(true)
    setError(null)
    try {
      await startPhoneVerification(phone)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    setBusy(true)
    setError(null)
    try {
      await confirmPhoneVerification(phone, code)
      sfx.bigwin()
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[440px] px-4 py-10">
      <div className="mb-4 text-center">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-neon-lime/30 bg-neon-lime/10 px-3 py-1">
          <span className="text-[10px] font-black uppercase tracking-[.16em] text-neon-lime">
            UGX {money(wallet?.balance_px ?? 0)} granted
          </span>
        </div>
        <h1 className="text-[22px] font-black text-white">Finish setting up</h1>
        <p className="mt-1 text-[12px] text-slate-500">
          Two quick steps before you can play and cash out.
        </p>
      </div>

      {/* step 1 */}
      <div className="panel mb-2.5 p-3.5">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[.16em] text-slate-500">1 · Your handle</p>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
          placeholder="Choose a username"
          className="field mb-1.5"
        />
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2">
          <input
            type="checkbox"
            checked={age}
            onChange={(e) => setAge(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[#c6f24e]"
          />
          <span className="text-[11px] leading-relaxed text-slate-300">
            I confirm I am <b className="text-white">18 or older</b> and accept the fair-play and
            responsible-gambling rules.
          </span>
        </label>
        <button
          type="button"
          onClick={() => void saveBasics()}
          disabled={busy || !usernameOk || !age}
          className="btn-primary mt-2 w-full !py-2.5 !text-[12.5px]"
        >
          Save
        </button>
      </div>

      {/* step 2 */}
      <div className="panel p-3.5">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[.16em] text-slate-500">
          2 · Verify your phone <span className="normal-case text-slate-600">(needed to cash out)</span>
        </p>
        {stage === 'done' ? (
          <p className="flex items-center gap-1.5 text-[12px] font-bold text-emerald-300">
            <IconCheck size={13} /> Phone verified
          </p>
        ) : (
          <>
            <div className="mb-1.5 flex gap-1.5">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="07XX XXX XXX"
                inputMode="tel"
                className="field flex-1"
              />
              <button type="button" onClick={() => void sendCode()} disabled={busy} className="btn-ghost shrink-0 !px-3 !text-[11.5px]">
                Send code
              </button>
            </div>
            <div className="mb-2 flex gap-1.5">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6-digit code"
                inputMode="numeric"
                className="field num flex-1"
              />
              <button type="button" onClick={() => void verify()} disabled={busy || code.length < 6} className="btn-primary shrink-0 !px-4 !text-[12px]">
                Verify
              </button>
            </div>
          </>
        )}
        <p className="flex items-start gap-1.5 text-[9.5px] leading-relaxed text-slate-600">
          <IconShield size={11} className="mt-0.5 shrink-0" />
          We never show your number publicly. It is only used for payout and account recovery.
        </p>
      </div>

      {error && (
        <div className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11.5px] text-rose-200">{error}</div>
      )}

      <button type="button" onClick={onDone} className="mt-3 w-full text-[11px] font-semibold text-slate-500 hover:text-slate-300">
        Continue to the games
      </button>
    </div>
  )
}
