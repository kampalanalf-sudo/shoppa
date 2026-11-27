import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { isBackendConfigured, supabase } from './supabase'
import { DAILY_BONUS_UGX } from './currency'

export type PlayerProfile = {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  phone: string | null
  phone_verified: boolean
  age_confirmed: boolean
  suspended: boolean
  /** Admin-only pages. The API re-checks this server-side on every call. */
  is_admin: boolean
}

export type Wallet = {
  user_id: string
  balance_px: number
  wagered_px: number
  won_px: number
  cashed_out_px: number
  gifted_out_px: number
  gifted_in_px: number
}

type AuthState = {
  configured: boolean
  ready: boolean
  session: Session | null
  user: User | null
  profile: PlayerProfile | null
  wallet: Wallet | null
  /** true when the player is mid-onboarding (needs a username or 18+ confirmation) */
  needsOnboarding: boolean
  signUpEmail: (email: string, password: string, username: string, dob: string) => Promise<void>
  signInEmail: (email: string, password: string) => Promise<void>
  signInGoogle: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  /**
   * Set a new password for the signed-in user. This is the second half of the
   * reset flow: the emailed link signs the user in, then this changes it.
   */
  updatePassword: (password: string) => Promise<void>
  /** True once a recovery link has been exchanged and a session exists. */
  recoveryReady: boolean
  /** Set when the link was expired, already used, or malformed. */
  recoveryError: string | null
  clearRecovery: () => void
  resendVerification: (email: string) => Promise<void>
  /** PX credited by today's login bonus, or 0 when already claimed. */
  dailyPxAwarded: number
  signOut: () => Promise<void>
  refreshWallet: () => Promise<void>
  updateProfile: (patch: Partial<Pick<PlayerProfile, 'username' | 'display_name' | 'phone' | 'age_confirmed'>>) => Promise<void>
  /** Request an OTP to the given phone number. */
  startPhoneVerification: (phone: string) => Promise<void>
  /** Confirm the OTP; marks the profile phone_verified. */
  confirmPhoneVerification: (phone: string, token: string) => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const [dailyPxAwarded, setDailyPxAwarded] = useState(0)

  /**
   * The daily login bonus, once per calendar day (Africa/Kampala). The amount
   * lives in `DAILY_BONUS_UGX` and is enforced server-side, so the only number
   * this file may show is the one the database actually returns.
   *
   * Deliberately best-effort. `claim_daily_px` raises 'already claimed today'
   * as its normal, expected outcome, so a failure here is not an error — if it
   * were, every player would see a red banner every day after the first. The
   * award is also entirely server-side: the client passes no amount, so a
   * tampered browser cannot name its own reward.
   *
   * WHAT IT RETURNS: the resulting balance, not the amount awarded. Reading it
   * as the award would have shown a player their whole balance as today's
   * bonus, so the credited amount comes from the constant the interface also
   * promises -- and `test:migration` pins that constant to the database's.
   */
  const claimDaily = useCallback(async (uid: string) => {
    if (!supabase) return
    const { data, error } = await supabase.rpc('claim_daily_px')
    if (error || typeof data !== 'number') {
      // Including 'already claimed today', which is the normal second visit.
      setDailyPxAwarded(0)
      return
    }
    // Success: the database credited the fixed daily amount.
    setDailyPxAwarded(DAILY_BONUS_UGX)
    void uid
  }, [])

  const loadProfile = useCallback(async (uid: string) => {
    if (!supabase) return
    // Claim first, then read the wallet, so the balance shown already includes
    // today's award rather than appearing to change under the player.
    await claimDaily(uid)
    const [{ data: p }, { data: w }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
      supabase.from('wallets').select('*').eq('user_id', uid).maybeSingle(),
    ])
    setProfile((p as PlayerProfile) || null)
    setWallet((w as Wallet) || null)
  }, [claimDaily])

  // boot: restore session, then keep it in sync
  useEffect(() => {
    if (!supabase) {
      setReady(true)
      return
    }
    let alive = true

    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      setReady(true)
      if (data.session?.user) void loadProfile(data.session.user.id)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (next?.user) void loadProfile(next.user.id)
      else {
        setProfile(null)
        setWallet(null)
      }
    })

    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  /**
   * Password recovery, explicitly.
   *
   * `detectSessionInUrl` handles a normal `?code=…` redirect, but this app
   * routes on the *hash*, and GoTrue appends its params to the redirect hash it
   * was given — so the recovery code and the error params both end up inside
   * `#reset-password…`, where the default parser never looks. Exchange them by
   * hand and report the outcome so the UI can say whether the link is good.
   */
  useEffect(() => {
    const client = supabase
    if (!client) return
    const hash = window.location.hash.replace(/^#/, '')
    if (!hash.startsWith('reset-password')) return

    const [head, ...rest] = hash.split('?')
    const params = new URLSearchParams(rest.join('?'))
    const frag = new URLSearchParams(head.split('&').slice(1).join('&'))
    const get = (k: string) => params.get(k) ?? frag.get(k)

    const errDesc = get('error_description') ?? get('error')
    if (errDesc) {
      setRecoveryError(decodeURIComponent(errDesc.replace(/\+/g, ' ')))
      return
    }

    const code = get('code')
    const tokenHash = get('token_hash')
    const accessToken = get('access_token')
    const refreshToken = get('refresh_token')

    void (async () => {
      try {
        if (code) {
          const { error } = await client.auth.exchangeCodeForSession(code)
          if (error) throw new Error(error.message)
        } else if (tokenHash) {
          const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
          if (error) throw new Error(error.message)
        } else if (accessToken && refreshToken) {
          const { error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          if (error) throw new Error(error.message)
        }
        setRecoveryReady(true)
      } catch (err) {
        setRecoveryError((err as Error).message)
      } finally {
        // Consume the tokens: leaving them in the address bar means the link
        // stays reusable from history, a shared screenshot, or a proxy log.
        window.history.replaceState(null, '', `${window.location.pathname}#reset-password`)
      }
    })()
  }, [])

  // live wallet: subscribe to our own row so gifts and wins show up instantly
  useEffect(() => {
    const client = supabase
    if (!client || !session?.user) return
    const uid = session.user.id
    const channel = client
      .channel(`wallet-${uid}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'wallets', filter: `user_id=eq.${uid}` },
        (payload) => setWallet(payload.new as Wallet),
      )
      .subscribe()
    return () => {
      void client.removeChannel(channel)
    }
  }, [session?.user])

  /**
   * Where this browser actually is.
   *
   * Two sites serve this build — the Vercel deployment and GitHub Pages — and
   * Supabase has a single `site_url` (currently Vercel). Sending an absolute
   * redirect, which is what the SDK does when handed a full URL, would bounce a
   * player who signed up on Pages over to Vercel mid-flow. A *relative* path
   * stays on whichever origin the request came from, and the allow-list already
   * covers both.
   */
  const here = (hash: string) => `${window.location.pathname}${hash}`

  const signUpEmail = useCallback(
    async (email: string, password: string, username: string, dob: string) => {
      if (!supabase) throw new Error('Backend is not configured.')
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          // the handle_new_user() trigger reads these to seed the profile
          data: { username: username.trim(), date_of_birth: dob },
          emailRedirectTo: here('#verified'),
        },
      })
      if (error) throw new Error(error.message)
    },
    [],
  )

  const signInEmail = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error('Backend is not configured.')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw new Error(error.message)
  }, [])

  const signInGoogle = useCallback(async () => {
    if (!supabase) throw new Error('Backend is not configured.')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // relative: stay on the origin the player is actually on
      redirectTo: here(''),
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    if (error) throw new Error(error.message)
  }, [])

  const resetPassword = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Backend is not configured.')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: here('#reset-password'),
    })
    if (error) throw new Error(error.message)
  }, [])

  const clearRecovery = useCallback(() => {
    setRecoveryReady(false)
    setRecoveryError(null)
  }, [])

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) throw new Error('Backend is not configured.')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw new Error(error.message)
  }, [])

  const resendVerification = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Backend is not configured.')
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: here('#verified') },
    })
    if (error) throw new Error(error.message)
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    await supabase.auth.signOut()
  }, [])

  const refreshWallet = useCallback(async () => {
    if (!supabase || !session?.user) return
    const { data } = await supabase.from('wallets').select('*').eq('user_id', session.user.id).maybeSingle()
    if (data) setWallet(data as Wallet)
  }, [session?.user])

  const updateProfile = useCallback(
    async (patch: Partial<Pick<PlayerProfile, 'username' | 'display_name' | 'phone' | 'age_confirmed'>>) => {
      if (!supabase || !session?.user) throw new Error('Please sign in again.')
      const { data, error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', session.user.id)
        .select()
        .maybeSingle()
      if (error) {
        throw new Error(
          error.code === '23505' ? 'That username is already taken.' : error.message,
        )
      }
      if (data) setProfile(data as PlayerProfile)
    },
    [session?.user],
  )

  const startPhoneVerification = useCallback(async (phone: string) => {
    if (!supabase) throw new Error('Backend is not configured.')
    const { error } = await supabase.auth.signInWithOtp({ phone })
    if (error) throw new Error(error.message)
  }, [])

  const confirmPhoneVerification = useCallback(
    async (phone: string, token: string) => {
      if (!supabase || !session?.user) throw new Error('Please sign in again.')
      const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' })
      if (error) throw new Error(error.message)
      // the OTP verified, so record it on the profile for cashout gating
      const { data } = await supabase
        .from('profiles')
        .update({ phone, phone_verified: true })
        .eq('id', session.user.id)
        .select()
        .maybeSingle()
      if (data) setProfile(data as PlayerProfile)
    },
    [session?.user],
  )

  const needsOnboarding = Boolean(
    profile && (!profile.age_confirmed || !profile.username || profile.username.startsWith('player')),
  )

  const value = useMemo<AuthState>(
    () => ({
      configured: isBackendConfigured,
      ready,
      session,
      user: session?.user ?? null,
      profile,
      wallet,
      needsOnboarding,
      signUpEmail,
      signInEmail,
      signInGoogle,
      resetPassword,
      updatePassword,
      recoveryReady,
      recoveryError,
      clearRecovery,
      resendVerification,
      dailyPxAwarded,
      signOut,
      refreshWallet,
      updateProfile,
      startPhoneVerification,
      confirmPhoneVerification,
    }),
    [
      ready, session, profile, wallet, needsOnboarding, signUpEmail, signInEmail, signInGoogle,
      resetPassword, updatePassword, recoveryReady, recoveryError, clearRecovery, resendVerification, signOut, refreshWallet, updateProfile,
      startPhoneVerification, confirmPhoneVerification, dailyPxAwarded,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
