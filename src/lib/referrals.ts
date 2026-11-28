// src/lib/referrals.ts
//
// The referral screen's data.
//
// Every number here comes from `referral_state()`. Nothing on this side computes
// a rate, a profit or a reward: the percentage paid is the row in
// `referral_settings`, and the money a reward is a share of is computed from the
// referred player's own deposits, withdrawals and balance on the server.
import { supabase } from './supabase'

export type ReferralReward = {
  referred: string
  deposit_n: number
  /** cumulative house profit on this friend at the time of the reward */
  profit_px: number
  /** the profit this particular reward was a share of */
  marginal_px: number
  reward_px: number
  created_at: string
}

export type ReferralFriend = {
  username: string
  /** how many of their first five deposits have already paid you */
  rewards: number
  earned_px: number
}

export type ReferralState = {
  code: string
  rate: number
  deposits_covered: number
  /** the player who invited you, if anyone did */
  referred_by: string | null
  invited: number
  rewards_paid: number
  earned_px: number
  rewards: ReferralReward[]
  friends: ReferralFriend[]
}

export async function referralState(): Promise<ReferralState> {
  if (!supabase) throw new Error('Backend is not configured.')
  const { data, error } = await supabase.rpc('referral_state')
  if (error) throw new Error(friendly(error.message))
  return data as ReferralState
}

/** Attach a code to the signed-in account. One per account, before any deposit. */
export async function claimReferral(code: string): Promise<{
  referrer: string
  code: string
  rate: number
  deposits_covered: number
}> {
  if (!supabase) throw new Error('Backend is not configured.')
  const { data, error } = await supabase.rpc('claim_referral', {
    p_code: code.trim().toUpperCase(),
  })
  if (error) throw new Error(friendly(error.message))
  return data
}

/** The link to send. Hash-routed so it works on the static deploy. */
export const referralLink = (code: string) => {
  if (!code) return ''
  return `${window.location.origin}${window.location.pathname}#join?code=${code}`
}

function friendly(message: string): string {
  const m = (message || '').replace(/^.*?ERROR:\s*/i, '').trim()
  if (!m) return 'That did not work. Please try again.'
  if (/permission denied|JWT|not authenticated|row-level security/i.test(m)) {
    return 'Please sign in again — your session has expired.'
  }
  return m
}
