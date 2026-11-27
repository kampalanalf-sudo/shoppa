import React, { useState } from 'react'
import { useAuth } from '../lib/auth'
import { sfx } from '../lib/sound'
import { IconShield } from '../components/Icons'
import { Logo, Wordmark } from '../components/Chrome'

type Mode = 'signin' | 'signup' | 'reset'

function GoogleMark() {
  // Official four-colour G. Inline SVG so it never depends on a font.
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

export function Auth({ onDone }: { onDone?: () => void }) {
  const {
    signInEmail, signUpEmail, signInGoogle, resetPassword, configured,
  } = useAuth()

  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [dob, setDob] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const ageOk = (() => {
    if (!dob) return false
    const d = new Date(dob)
    if (Number.isNaN(d.getTime())) return false
    const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000)
    return age >= 18 && age < 120
  })()

  const usernameOk = /^[a-zA-Z0-9_]{3,18}$/.test(username)
  const passwordOk = password.length >= 8

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    sfx.click()
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'reset') {
      void run(async () => {
        await resetPassword(email)
        setNotice('If that address has an account, a reset link is on its way.')
      })
      return
    }
    if (mode === 'signup') {
      if (!usernameOk) return setError('Pick a username: 3–18 letters, numbers or underscores.')
      if (!passwordOk) return setError('Use at least 8 characters for your password.')
      if (!ageOk) return setError('You must be 18 or older to open an account.')
      void run(async () => {
        await signUpEmail(email, password, username, dob)
        setNotice('Check your inbox to verify your email, then sign in.')
        setMode('signin')
      })
      return
    }
    void run(async () => {
      await signInEmail(email, password)
      onDone?.()
    })
  }

  return (
    <div className="mx-auto w-full max-w-[420px] px-4 py-10">
      <div className="mb-6 text-center">
        {/* The brand, large, on the screen every new player sees first. It was
            absent here entirely -- the header sits above, but on a phone the
            sign-in card is what fills the viewport, so this is the only place
            the mark can make a first impression at a readable size. */}
        <div className="mb-5 flex items-center justify-center gap-3.5">
          <Logo size={64} />
          <Wordmark size="lg" />
        </div>
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">
          <IconShield size={12} className="text-neon-lime" />
          <span className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">Secure sign-in</span>
        </div>
        <h1 className="text-[24px] font-black leading-tight text-white">
          {mode === 'signup' ? 'Create your account' : mode === 'reset' ? 'Reset your password' : 'Welcome back'}
        </h1>
        <p className="mt-1 text-[12.5px] text-slate-500">
          {mode === 'signup'
            ? 'New players get UGX 1,000 free. Log in daily for more.'
            : mode === 'reset'
              ? 'We will email you a link to set a new password.'
              : 'Sign in to play, chat and cash out.'}
        </p>
      </div>

      {!configured && (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-[11.5px] text-amber-200">
          Accounts are not configured on this build. Set <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> to enable sign-in.
        </div>
      )}

      <button
        type="button"
        onClick={() =>
          void run(async () => {
            // This redirects the browser away, so `onDone` never runs on a
            // success path. Reaching the line after it means the redirect was
            // refused — a blocked popup, a provider that is not enabled, or an
            // origin missing from the redirect allow-list.
            await signInGoogle()
            setNotice('Redirecting to Google… if nothing happens, allow pop-ups for this site.')
          })
        }
        disabled={busy || !configured}
        className="mb-3 flex w-full items-center justify-center gap-2.5 rounded-xl border border-white/15 bg-white px-4 py-3 text-[13px] font-bold text-[#1f1f1f] transition hover:bg-white/90 disabled:opacity-50"
      >
        <GoogleMark />
        {busy ? 'Opening Google…' : 'Continue with Google'}
      </button>

      {/* the reset flow this form starts has to be finishable */}
      {mode === 'reset' && notice && (
        <button
          type="button"
          onClick={() => {
            // The email has landed; the link opens #reset-password. Offer the
            // local jump so a player on this device can set it immediately.
            window.location.hash = 'reset-password'
          }}
          className="btn-ghost mb-3 w-full !py-2.5 !text-[12px]"
        >
          Already opened the link? Set a new password
        </button>
      )}

      <div className="mb-3 flex items-center gap-3">
        <span className="h-px flex-1 bg-white/10" />
        <span className="text-[10px] font-bold uppercase tracking-[.16em] text-slate-600">or use email</span>
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <form onSubmit={submit} className="space-y-2.5">
        {mode === 'signup' && (
          <div>
            <label className="label" htmlFor="username">Username</label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
              placeholder="e.g. KampalaKid"
              autoComplete="username"
              className="field"
            />
            {username && !usernameOk && (
              <p className="mt-1 text-[10.5px] text-rose-300">3–18 characters: letters, numbers, underscore.</p>
            )}
          </div>
        )}

        <div>
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className="field"
          />
        </div>

        {mode !== 'reset' && (
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              className="field"
            />
          </div>
        )}

        {mode === 'signup' && (
          <div>
            <label className="label" htmlFor="dob">Date of birth</label>
            <input
              id="dob"
              type="date"
              required
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              className="field"
            />
            {dob && !ageOk && (
              <p className="mt-1 text-[10.5px] text-rose-300">You must be 18 or older to play.</p>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11.5px] text-rose-200">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-[11.5px] text-emerald-200">
            {notice}
          </div>
        )}

        <button type="submit" disabled={busy || !configured} className="btn-primary w-full !py-3 !text-[13px]">
          {busy
            ? 'Please wait…'
            : mode === 'signup'
              ? 'Create account'
              : mode === 'reset'
                ? 'Send reset link'
                : 'Sign in'}
        </button>
      </form>

      <div className="mt-3 flex items-center justify-between text-[11.5px]">
        {mode === 'signin' ? (
          <>
            <button type="button" onClick={() => { setMode('signup'); setError(null) }} className="font-bold text-neon-lime hover:underline">
              Create an account
            </button>
            <button type="button" onClick={() => { setMode('reset'); setError(null) }} className="text-slate-500 hover:text-slate-300">
              Forgot password?
            </button>
          </>
        ) : (
          <button type="button" onClick={() => { setMode('signin'); setError(null) }} className="font-bold text-neon-lime hover:underline">
            Back to sign in
          </button>
        )}
      </div>

      <p className="mt-6 text-center text-[10px] leading-relaxed text-slate-600">
        By creating an account you confirm you are 18 or older and accept the fair-play and
        responsible-gambling rules. Play responsibly — never stake more than you can afford to lose.
      </p>
    </div>
  )
}
