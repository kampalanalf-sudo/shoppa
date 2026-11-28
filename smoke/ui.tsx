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
import { ASSETS, ASSET_IDS, quote } from '../src/lib/proxicash'
import { MIN_BET, MAX_BET, FREE_PLAY_START, DAILY_BONUS_UGX } from '../src/lib/currency'

const fails: string[] = []
const ok = (name: string, cond: boolean) => { if (!cond) fails.push(name); console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`) }

// --- one currency, no peg ---
//
// PX is gone. The thing worth asserting is that nothing claims to convert
// between a coin and fiat any more: a leftover conversion is how a "UGX 1,000"
// screen quietly shows 10,000.
ok('there is no PX asset', !(ASSET_IDS as string[]).includes('PX'))
ok('every asset is crypto', ASSET_IDS.every((id) => ASSETS[id].kind === 'crypto'))
ok('no asset is pegged to the shilling', ASSET_IDS.every((id) => ASSETS[id].ugxRate > 1))
ok('a crypto quote is in UGX', Math.round(quote('USDT', 10).gross) === Math.round(10 * ASSETS.USDT.ugxRate))

// Bet bounds and the free-play float are the numbers a player sees promised.
ok('the minimum bet is whole shillings', Number.isInteger(MIN_BET) && MIN_BET === 100)
ok('the maximum bet is above the minimum', MAX_BET > MIN_BET)
ok('free play starts with a usable float', FREE_PLAY_START >= MIN_BET * 100)
ok('the daily bonus is a round UGX figure', Number.isInteger(DAILY_BONUS_UGX) && DAILY_BONUS_UGX > 0)

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
  ['Support', wrap(<Support onHome={() => {}} onSignIn={() => {}} />)],
]
// The screen must tell the player the agents are automated, and must warn about
// one-time codes. Both are promises the app makes in its own words, so they are
// checked in the rendered output rather than in the source.
try {
  const html = renderToString(wrap(<Support onHome={() => {}} onSignIn={() => {}} />) as any)
  ok('Support says the agents are automated', /automated agents/i.test(html))
  ok('Support warns never to share a one-time code', /one-time code/i.test(html))
  // The empty state is behind `!booting`, and SSR runs no effects, so the first
  // paint is the "Starting…" state. Asserting the suggestions here would be
  // asserting something this render cannot produce — so the starting point is
  // checked in the source, and the always-rendered copy above is checked here.
  const supportSrc = readFileSync(join(process.cwd(), 'src/pages/Support.tsx'), 'utf8')
  ok('Support offers a starting point', /What can we help with/.test(supportSrc) && /SUGGESTIONS/.test(supportSrc))
  ok('Support shows a loading state before it has a thread', /Starting…/.test(html))

  // Signed out, the floating bubble DOES render. The previous rule — hide it,
  // because a visitor cannot enter the room — was the wrong trade: someone who
  // cannot log in is the person most in need of help, and the Support page now
  // offers them a way in instead of a dead composer.
  const bubbleHtml = renderToString(wrap(<SupportBubble onOpen={() => {}} />) as any)
  ok('SupportBubble reaches a signed-out visitor', /Help/.test(bubbleHtml))

  // A signed-out visitor must be told why the composer will not send, and given
  // the one action that fixes it. Silence there reads as a broken app.
  ok('Support explains signing in is required to chat',
    /Sign in to chat with the agents/.test(html))
  // The button's label sits on its own line in the JSX, so the rendered HTML has
  // whitespace inside the tag. Assert the label, not the exact markup.
  ok('and offers a Sign in button', /<button[^>]*>\s*Sign in\s*<\/button>/.test(html))
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
// Every amount the PlayBar prints is labelled shillings — there is no second
// currency and no conversion left to be wrong.
ok('PlayBar labels its amounts UGX', /UGX [\d,]/.test(bar))
ok('PlayBar prints no PX amount', !/\bPX\b/.test(bar))

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
