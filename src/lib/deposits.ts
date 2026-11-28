// src/lib/deposits.ts
//
// The deposit screen's data, and the Float credit product.
//
// TWO THINGS LIVE HERE, AND THEY ARE DIFFERENT
//
//   1. Deposits. The player tops up from a number that is THEIR OWN and is not
//      editable on the top-up page. A number that could be retyped on that page
//      is a number that can be pointed at someone else's wallet by accident, and
//      the whole point of the screen is that the money lands in the account that
//      is signed in.
//
//   2. "Float Me". The same deposit, paid for by a different phone: the player
//      generates a code, and sends it to whoever is willing to pay. That route is
//      public on the server (`gift`), because the payer usually has no account.
//
//   3. Float (the loan). Money lent to the player, credited to the gaming wallet,
//      repaid in three instalments inside 24 hours, with a 6%-per-day levy after
//      that. Every number here comes from a database function; nothing on this
//      side decides a limit, an instalment or a fee.
import { api } from './api'
import { supabase } from './supabase'
import { SUPABASE_ANON_KEY, SUPABASE_FUNCTIONS_URL } from './backend'

// -------------------------------------------------------------- deposits -----

export type DepositRequest = {
  id: string
  code: string
  amount: number
  currency: string
  status: 'pending' | 'paid' | 'expired' | 'cancelled'
  expires_at: string
  created_at?: string
}

/** Ask someone else to pay. One live request at a time, enforced in the database. */
export async function createDepositRequest(amount: number): Promise<DepositRequest> {
  if (!supabase) throw new Error('Backend is not configured.')
  const { data, error } = await supabase.rpc('create_deposit_request', {
    p_amount: Math.round(amount),
    p_currency: 'UGX',
  })
  if (error) throw new Error(friendly(error.message))
  return data as DepositRequest
}

/**
 * The live request, if there is one, so a returning player sees the code they
 * already sent rather than being told they cannot make another.
 */
export async function currentDepositRequest(): Promise<DepositRequest | null> {
  if (!supabase) return null
  const { data } = await supabase
    .from('deposit_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
  const row = (data ?? [])[0] as DepositRequest | undefined
  if (!row) return null
  // Expiry is the database's clock, not the phone's.
  if (new Date(row.expires_at).getTime() <= Date.now()) return null
  return row
}

export async function cancelDepositRequest(code: string): Promise<void> {
  if (!supabase) throw new Error('Backend is not configured.')
  const { error } = await supabase.rpc('cancel_deposit_request', { p_code: code })
  if (error) throw new Error(friendly(error.message))
}

/** The public lookup the sponsor's page uses before it charges anyone. */
export type GiftLookup =
  | { found: false; error?: string }
  | {
      found: true
      code: string
      amount: number
      currency: string
      status: 'pending' | 'paid' | 'expired' | 'cancelled'
      expires_at: string
    }

export async function lookupDepositCode(code: string): Promise<GiftLookup> {
  const res = await fetch(
    `${SUPABASE_FUNCTIONS_URL}/gift?op=lookup&code=${encodeURIComponent(code.trim().toUpperCase())}`,
    { headers: { apikey: SUPABASE_ANON_KEY } },
  )
  const body = await res.json().catch(() => ({}))
  if (!res.ok && !body?.found) {
    return { found: false, error: body?.error || 'Could not check that code right now.' }
  }
  return body as GiftLookup
}

/** Charge the payer's own phone for someone else's deposit. */
export async function payDepositCode(code: string, phone: string): Promise<{
  reference: string
  status: string
  amount: number
  currency: string
  message: string
}> {
  const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/gift?op=pay`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ code, phone }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || 'That payment could not be started.')
  return body
}

/** Link a friend can open. Hash-routed, so it works on the static deploy. */
export const giftLink = (code: string) =>
  `${window.location.origin}${window.location.pathname}#float-me?code=${code}`

// ------------------------------------------------------------------ float ----

export type FloatInstallment = { n: number; due_at: string; amount: number; paid: number }

export type FloatOffer = {
  eligible: boolean
  limit: number
  reason?: string | null
  levy_rate?: number
  installments?: number
  window_hours?: number
  outstanding?: number
}

export type FloatState =
  | { open: false; balance: number; offer: FloatOffer }
  | {
      open: true
      float: string
      principal: number
      owed: number
      repaid: number
      outstanding: number
      levy_due: number
      levy_rate: number
      due_at: string
      overdue: boolean
      balance: number
      installments: FloatInstallment[]
    }

export async function floatState(): Promise<FloatState> {
  if (!supabase) throw new Error('Backend is not configured.')
  const { data, error } = await supabase.rpc('float_state')
  if (error) throw new Error(friendly(error.message))
  return data as FloatState
}

export async function requestFloat(amount: number): Promise<{
  float: string
  principal: number
  owed: number
  balance: number
  due_at: string
  installments: FloatInstallment[]
}> {
  if (!supabase) throw new Error('Backend is not configured.')
  const { data, error } = await supabase.rpc('request_float', { p_amount: Math.round(amount) })
  if (error) throw new Error(friendly(error.message))
  return data
}

export async function repayFloat(amount: number): Promise<{
  paid: number
  balance: number
  repaid: number
  owed: number
  outstanding: number
  status: 'active' | 'settled'
}> {
  if (!supabase) throw new Error('Backend is not configured.')
  const { data, error } = await supabase.rpc('repay_float', { p_amount: Math.round(amount) })
  if (error) throw new Error(friendly(error.message))
  return data
}

/**
 * Database errors are written for a person — "you already have a deposit request
 * open" is exactly what the player needs to read. Only the ones that are not are
 * replaced, so a Postgres internal never reaches the screen.
 */
function friendly(message: string): string {
  const m = (message || '').replace(/^.*?ERROR:\s*/i, '').trim()
  if (!m) return 'That did not work. Please try again.'
  if (/violates row-level security|permission denied|JWT|not authenticated/i.test(m)) {
    return 'Please sign in again — your session has expired.'
  }
  return m
}
