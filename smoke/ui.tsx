import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { PlayBar } from '../src/components/PlayBar'
import { StoreProvider } from '../src/lib/store'
import { AuthProvider } from '../src/lib/auth'
import { Auth } from '../src/pages/Auth'
import { Cashout } from '../src/pages/Cashout'
import { Onboarding } from '../src/pages/Onboarding'
import { Support } from '../src/pages/Support'
import { SupportBubble } from '../src/components/SupportBubble'
import { pxToUgx, ugxToPx, PX_PER_UGX, ASSETS, quote } from '../src/lib/proxicash'

const fails: string[] = []
const ok = (name: string, cond: boolean) => { if (!cond) fails.push(name); console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`) }

// --- peg maths ---
ok('PX_PER_UGX is 100', PX_PER_UGX === 100)
ok('100,000 PX = 1,000 UGX', pxToUgx(100000) === 1000)
ok('1,000 UGX = 100,000 PX', ugxToPx(1000) === 100000)
ok('round-trip holds', pxToUgx(ugxToPx(5000)) === 5000)
ok('PX quote at 100:1', Math.round(quote('PX', 400000).gross) === 4000)
// The daily login bonus is the number that makes the peg legible. If these two
// drift apart, the app is promising a reward it does not pay.
ok('a daily bonus is worth a round UGX figure', pxToUgx(15000) === 150)

// --- render without a backend ---
const wrap = (n: React.ReactNode) => (
  <AuthProvider><StoreProvider>{n}</StoreProvider></AuthProvider>
)
const renders: [string, React.ReactNode][] = [
  ['PlayBar', wrap(<PlayBar bet={1000} onBet={() => {}} onSpin={() => {}} lastWin={2} />)],
  ['Auth', wrap(<Auth />)],
  ['Cashout', wrap(<Cashout onBack={() => {}} />)],
  ['Onboarding', wrap(<Onboarding onDone={() => {}} />)],
  // Customer care. Rendered signed-out on purpose: an unauthenticated player
  // must still get a usable screen, not a crash or a blank panel. The empty
  // state, the disclosure that the agents are automated, and the "never share a
  // code" warning are all in that first paint.
  ['Support', wrap(<Support onHome={() => {}} />)],
]
// The screen must tell the player the agents are automated, and must warn about
// one-time codes. Both are promises the app makes in its own words, so they are
// checked in the rendered output rather than in the source.
try {
  const html = renderToString(wrap(<Support onHome={() => {}} />) as any)
  ok('Support says the agents are automated', /automated agents/i.test(html))
  ok('Support warns never to share a one-time code', /one-time code/i.test(html))
  // The empty state is behind `!booting`, and SSR runs no effects, so the first
  // paint is the "Starting…" state. Asserting the suggestions here would be
  // asserting something this render cannot produce — so the starting point is
  // checked in the source, and the always-rendered copy above is checked here.
  const supportSrc = readFileSync(join(process.cwd(), 'src/pages/Support.tsx'), 'utf8')
  ok('Support offers a starting point', /What can we help with/.test(supportSrc) && /SUGGESTIONS/.test(supportSrc))
  ok('Support shows a loading state before it has a thread', /Starting…/.test(html))

  // Signed out, the floating bubble must render NOTHING. A "Help" button over
  // the sign-in screen would be a door to a room the visitor cannot enter.
  const bubbleHtml = renderToString(wrap(<SupportBubble onOpen={() => {}} />) as any)
  ok('SupportBubble renders nothing when signed out', bubbleHtml.length === 0)
  ok('Support exposes the transcript to screen readers', /aria-live/.test(html) || /role="log"/.test(html))
} catch (e) {
  ok('Support renders for inspection', false)
  console.log('   ', (e as Error).message)
}

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
// The PlayBar quotes stake size in UGX at the live peg, not a hardcoded ratio.
ok('PlayBar shows UGX conversion', /\d[\d,]* UGX/.test(bar))

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
