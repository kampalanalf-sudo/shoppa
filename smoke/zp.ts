// smoke/zp.ts
//
// Pure-function checks for the ZENGAPAY client: phone normalisation, amounts,
// status mapping, and the webhook signed-string.
//
// These run against the REAL shared module the edge functions bundle, not a
// copy, so a change here is a change in production.
import {
  normalizePhone, isWholeAmount, normalizeStatus, webhookSignedPayload, webhookReference, webhookDirection,
} from '../supabase/functions/_shared/zengapay.ts'

let fail = 0
const check = (name: string, cond: boolean, extra = '') => {
  if (!cond) fail++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${extra}`)
}

// ------------------------------------------------------------- phone ------
//
// THE RULE INVERTED. The old provider wanted the leading 0 preserved; ZENGAPAY
// wants digits only, international, no `+`. Every case below is a real input
// shape from the top-up form.
const phones: [string, string | null][] = [
  ['0771234567', '256771234567'],
  ['0771 234 567', '256771234567'],
  ['0771-234-567', '256771234567'],
  ['+256771234567', '256771234567'],
  ['256771234567', '256771234567'],
  ['0751234567', '256751234567'],
  ['0781234567', '256781234567'],
  ['0701234567', '256701234567'],
  ['077123456', null], // short
  ['07712345678', null], // long
  ['12345', null],
  ['', null],
  ['0971234567', null], // not a mobile prefix
  ['+254712345678', null], // Kenya: we pay UGX wallets only
  ['+255671234567', null],
  ['+250781234567', null],
]
for (const [input, want] of phones) {
  const got = normalizePhone(input)
  check(`phone "${input}" -> ${got} (want ${want})`, got === want)
}

check('phone: never emits a plus', normalizePhone('+256771234567')!.indexOf('+') === -1)
check('phone: never keeps a leading 0', normalizePhone('0771234567')!.startsWith('0') === false)
check('phone: always starts with the country code', normalizePhone('0771234567')!.startsWith('256'))

// ------------------------------------------------------------ amounts -----

for (const [v, want] of [[5000, true], [0, false], [-1, false], [10.5, false], ['5000', false]] as [any, boolean][]) {
  check(`amount ${JSON.stringify(v)} valid=${isWholeAmount(v)}`, isWholeAmount(v) === want)
}

// ----------------------------------------------------------- statuses -----
//
// Only SUCCEEDED fulfils. INDETERMINATE is NOT failed: refunding a payment that
// actually succeeded, or crediting one that failed, are both worse than waiting.
const statuses: [string, string][] = [
  ['SUCCEEDED', 'completed'],
  ['succeeded', 'completed'],
  ['FAILED', 'failed'],
  ['DECLINED', 'failed'],
  ['CANCELLED', 'failed'],
  ['PENDING', 'pending'],
  ['INDETERMINATE', 'pending'],
  ['', 'pending'],
]
for (const [v, want] of statuses) {
  const got = normalizeStatus(v)
  check(`status "${v}" -> ${got} (want ${want})`, got === want)
}

// -------------------------------------------------- webhook signed string --
//
// The signed string is transactionReference + msisdn + amount, concatenated
// with NO separator. This is the single highest-risk detail in the integration:
// signing the raw body — the obvious guess — fails every verification and means
// no top-up is ever credited.
const body = {
  event: 'collection.success',
  data: { transactionReference: '20570a12-c92b', msisdn: '256392003738', amount: '5000' },
}
check('signed string is the three fields, concatenated',
  webhookSignedPayload(body) === '20570a12-c92b2563920037385000')
check('signed string contains no separator',
  !/[^A-Za-z0-9-]/.test(webhookSignedPayload(body)!))
check('signed string is not the JSON body',
  webhookSignedPayload(body) !== JSON.stringify(body))

check('signed string is null when a field is missing',
  webhookSignedPayload({ data: { transactionReference: 'x', msisdn: '256' } }) === null)
check('signed string tolerates a flat payload',
  webhookSignedPayload({ transactionReference: 'R', msisdn: '256', amount: '1' }) === 'R2561')

check('reference is read from data', webhookReference(body) === '20570a12-c92b')
check('reference falls back to our external reference',
  webhookReference({ data: { transactionExternalReference: 'TOP-1' } }) === 'TOP-1')
check('reference is empty, never undefined, when absent', webhookReference({}) === '')

check('transfer events are payouts', webhookDirection({ event: 'transfer.success' }) === 'disburse')
check('collection events are top-ups', webhookDirection({ event: 'collection.success' }) === 'collect')
check('an unknown event defaults to collect', webhookDirection({ event: '' }) === 'collect')

console.log(fail ? `\n${fail} FAILED` : '\nall zengapay checks passed')
process.exit(fail ? 1 : 0)
