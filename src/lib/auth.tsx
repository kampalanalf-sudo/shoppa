import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { isBackendConfigured, supabase } from './supabase'

export type PlayerProfile = {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  phone: string | null
  phone_verified: boolean
  age_confirmed: boolean
  suspended: boolean
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
  resendVerification: (email: string) => Promise<void>
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

  const loadProfile = useCallback(async (uid: string) => {
    if (!supabase) return
    const [{ data: p }, { data: w }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
      supabase.from('wallets').select('*').eq('user_id', uid).maybeSingle(),
    ])
    setProfile((p as PlayerProfile) || null)
    setWallet((w as Wallet) || null)
  }, [])

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

  const signUpEmail = useCallback(
    async (email: string, password: string, username: string, dob: string) => {
      if (!supabase) throw new Error('Backend is not configured.')
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          // the handle_new_user() trigger reads these to seed the profile
          data: { username: username.trim(), date_of_birth: dob },
          emailRedirectTo: `${window.location.origin}${window.location.pathname}#verified`,
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
        redirectTo: `${window.location.origin}${window.location.pathname}`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    if (error) throw new Error(error.message)
  }, [])

  const resetPassword = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Backend is not configured.')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}${window.location.pathname}#reset-password`,
    })
    if (error) throw new Error(error.message)
  }, [])

  const resendVerification = useCallback(async (email: string) => {
    if (!supabase) throw new Error('Backend is not configured.')
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}#verified` },
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
      resendVerification,
      signOut,
      refreshWallet,
      updateProfile,
      startPhoneVerification,
      confirmPhoneVerification,
    }),
    [
      ready, session, profile, wallet, needsOnboarding, signUpEmail, signInEmail, signInGoogle,
      resetPassword, resendVerification, signOut, refreshWallet, updateProfile,
      startPhoneVerification, confirmPhoneVerification,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
