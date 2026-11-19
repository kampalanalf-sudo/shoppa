import { renderToString } from 'react-dom/server'
import React from 'react'
import { PlayBar } from '../src/components/PlayBar'
import { StoreProvider } from '../src/lib/store'
import { AuthProvider } from '../src/lib/auth'
import { Auth } from '../src/pages/Auth'
import { Cashout } from '../src/pages/Cashout'
import { Onboarding } from '../src/pages/Onboarding'
import { pxToUgx, ugxToPx, PX_PER_UGX, ASSETS, quote } from '../src/lib/proxicash'

const fails: string[] = []
const ok = (name: string, cond: boolean) => { if (!cond) fails.push(name); console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`) }

// --- peg maths ---
ok('PX_PER_UGX is 10', PX_PER_UGX === 10)
ok('10,000 PX = 1,000 UGX', pxToUgx(10000) === 1000)
ok('1,000 UGX = 10,000 PX', ugxToPx(1000) === 10000)
ok('round-trip holds', pxToUgx(ugxToPx(5000)) === 5000)
ok('PX quote at 10:1', Math.round(quote('PX', 100000).gross) === 10000)

// --- render without a backend ---
const wrap = (n: React.ReactNode) => (
  <AuthProvider><StoreProvider>{n}</StoreProvider></AuthProvider>
)
const renders: [string, React.ReactNode][] = [
  ['PlayBar', wrap(<PlayBar bet={1000} onBet={() => {}} onSpin={() => {}} lastWin={2} />)],
  ['Auth', wrap(<Auth />)],
  ['Cashout', wrap(<Cashout onBack={() => {}} />)],
  ['Onboarding', wrap(<Onboarding onDone={() => {}} />)],
]
for (const [name, el] of renders) {
  try {
    const html = renderToString(el as any)
    ok(`${name} renders (${html.length} bytes)`, html.length > 200)
  } catch (e) {
    ok(`${name} renders`, false)
    console.log('   ', (e as Error).message)
  }
}

// PlayBar must surface balance + last win + bet + autoplay
const bar = renderToString(wrap(<PlayBar bet={1000} onBet={() => {}} onSpin={() => {}} lastWin={2} onAuto={() => {}} />) as any)
for (const label of ['Balance', 'Last win', 'Bet', 'Auto', 'Spin']) {
  ok(`PlayBar shows "${label}"`, bar.includes(label))
}
// 10,000 PX at 10:1 must show 1,000 UGX in the hint
ok('PlayBar shows UGX conversion', bar.includes('1,000 UGX'))

// --- auth screen requirements ---
const authHtml = renderToString(wrap(<Auth />) as any)
ok('Auth has Google button', authHtml.includes('Continue with Google'))
ok('Auth has sign-in', authHtml.includes('Sign in'))
ok('Auth has create account', authHtml.includes('Create an account'))
ok('Auth signin copy present', authHtml.includes('Sign in to play'))
ok('Auth has email + password fields', authHtml.includes('type="email"') && authHtml.includes('type="password"'))
// It used to also render a "Backend is not configured" banner, and the live
// site shipped in exactly that state: auth compiled out, nothing on screen
// admitting it. The backend location is now part of the source, so the banner
// must be absent and the form must be live.
ok('Auth is not sitting in the unconfigured state', !authHtml.includes('not configured'))
// `disabled` is correct while busy; it must just never be hard-wired on
// (the old markup could render `disabled=""` when unconfigured and look live).
ok('Auth buttons are not hard-disabled',
  !/\sdisabled(=""|>)/.test(authHtml) || /disabled=\"\"/.test(authHtml) === false)

if (fails.length) { console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
console.log('\nall new-UI checks passed')
