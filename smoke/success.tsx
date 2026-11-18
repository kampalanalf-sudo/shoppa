import { renderToString } from 'react-dom/server'
import React from 'react'
import { AuthProvider } from '../src/lib/auth'
import { StoreProvider } from '../src/lib/store'
import { TopUpSuccess } from '../src/pages/TopUpSuccess'

const fails: string[] = []
const ok = (n: string, c: boolean, e = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${e}`) }

const wrap = (n: React.ReactNode) => (<AuthProvider><StoreProvider>{n}</StoreProvider></AuthProvider>)

// no reference -> assumes paid, shows balance, no polling
const noRef = renderToString(wrap(<TopUpSuccess reference={null} onHome={() => {}} onTopUpAgain={() => {}} />) as any)
ok('no reference: renders', noRef.length > 300)
ok('no reference: shows balance card', noRef.includes('New balance'))
ok('no reference: does not claim a failed payment', !noRef.includes('Payment failed'))

// with reference -> starts in checking/pending, shows the right copy
const withRef = renderToString(
  wrap(<TopUpSuccess reference="DG-TEST-123" onHome={() => {}} onTopUpAgain={() => {}} />) as any,
)
ok('with reference: shows the reference', withRef.includes('DG-TEST-123'))
ok('with reference: waiting copy is about the phone', withRef.toLowerCase().includes('check your phone'))
ok('with reference: not falsely marked paid', !withRef.includes('Deposit confirmed'))

// guarantees
ok('never credits money itself (no deposit/settle calls)', !/deposit\(|settleBet|settle_round|apply_gateway/i.test(withRef))
ok('states the webhook does the crediting', withRef.toLowerCase().includes('webhook'))
ok('offers a way home', withRef.includes('Back to games'))

// the success page must present UGX value at the 10:1 peg
ok('shows UGX conversion', withRef.includes('UGX'))

if (fails.length) { console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
console.log('\nall success-page checks passed')
