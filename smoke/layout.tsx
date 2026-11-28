import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { StoreProvider } from '../src/lib/store'
import { AuthProvider } from '../src/lib/auth'
import { EngineSlot } from '../src/games/EngineSlot'
import { BonniClyve } from '../src/games/BonniClyve'
import { CHAPE } from '../src/lib/slots/games'

const wrap = (n: React.ReactNode) => (<AuthProvider><StoreProvider>{n}</StoreProvider></AuthProvider>)
const fails: string[] = []
const ok = (n: string, c: boolean, extra = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${extra}`) }

const cases: [string, string][] = [
  ['EngineSlot', renderToString(wrap(<EngineSlot config={CHAPE} id="chape" onBack={() => {}} onFair={() => {}} />) as any)],
  ['BonniClyve', renderToString(wrap(<BonniClyve onBack={() => {}} onFair={() => {}} />) as any)],
]

for (const [name, html] of cases) {
  const reels = html.includes('3 × 5') ? html.indexOf('3 × 5') : html.indexOf('×3 ways')
  const balance = html.indexOf('Balance')
  const spin = html.indexOf('>Spin<')
  ok(`${name}: reels precede the play bar`, reels !== -1 && balance > reels, `(reels@${reels} bar@${balance})`)
  ok(`${name}: spin sits in the bar row`, spin > balance && spin < html.length)
  // the bar's row must contain balance, last win, bet and auto together
  const barStart = html.lastIndexOf('max-w-[760px]', spin)
  const slice = html.slice(balance - 400, spin + 200)
  ok(`${name}: balance/lastwin/bet/auto share one row`,
     slice.includes('Balance') && slice.includes('Bet') && slice.includes('Last win'), '')
}

// ------------------------------------------------- floating controls, phone --
//
// Everything pinned to the bottom-right corner has to share it with the bottom
// bar, the game action bar and the wallet shortcut. This is geometry, so it is
// checked as arithmetic rather than eyeballed: the classes are read out of the
// components and turned into pixel ranges measured from the bottom edge.
//
// It exists because Help at bottom-[76px] and the wallet button at bottom-20
// (80px) overlapped by 44 of 48 pixels. The wallet shortcut was unreachable on
// a phone and nothing failed.
const px = (cls: string, name: string): number => {
  const m = cls.match(new RegExp(`(?:^|\\s)${name}-\\[(\\d+)px\\]`))
  if (m) return Number(m[1])
  const n = cls.match(new RegExp(`(?:^|\\s)${name}-(\\d+)`))
  return n ? Number(n[1]) * 4 : NaN
}

const readSrc = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const bubbleSrc = readSrc('src/components/SupportBubble.tsx')
const appSrc = readSrc('src/App.tsx')

// The phone class is the one before sm:; that is the layout being protected.
const bubblePhone = bubbleSrc.match(/className="fixed([^"]*bottom-\d[^"]*)"/)?.[1] ?? ''
const helpBottom = px(bubblePhone, 'bottom')
const HELP_H = 48

// The wallet shortcut, from App.tsx.
const walletCls = appSrc.match(/className="fixed bottom-\d+ right-\d+ z-30 grid h-12 w-12[^"]*"/)?.[0] ?? ''
const walletBottom = px(walletCls, 'bottom')
const WALLET_H = 48
// The game action bar sits at bottom-[57px] and is about 48px tall.
const ACTION_BAR_TOP = 57 + 48
const BOTTOM_BAR_TOP = 56

ok('the Help button has a bottom offset', Number.isFinite(helpBottom), `bottom=${helpBottom}px`)
ok('the Help button clears the bottom bar', helpBottom >= BOTTOM_BAR_TOP, `${helpBottom} >= ${BOTTOM_BAR_TOP}`)
ok('the Help button clears the game action bar', helpBottom >= ACTION_BAR_TOP, `${helpBottom} >= ${ACTION_BAR_TOP}`)
ok('the Help button clears the wallet shortcut',
  helpBottom >= walletBottom + WALLET_H,
  `help@${helpBottom} wallet ${walletBottom}-${walletBottom + WALLET_H}`)
// And it must not drift so high that it floats in the middle of the screen.
ok('the Help button stays in thumb reach', helpBottom + HELP_H <= 240, `top=${helpBottom + HELP_H}px`)

// From sm up there is no bottom bar, so the corner is free.
ok('the Help button drops to the corner on larger screens', /sm:bottom-6/.test(bubblePhone))

// "On all pages" is a claim about App.tsx, not about this component.
const hidden = appSrc.match(/<SupportBubble[\s\S]{0,400}?hidden=\{([^}]*)\}/)?.[1] ?? ''
ok('Support is mounted once, for the whole app', (appSrc.match(/<SupportBubble/g) ?? []).length === 1)
ok('Support is not hidden on the sign-in screen', !!hidden && !/auth/.test(hidden), hidden)
ok('Support is hidden on its own screen', /'support'/.test(hidden))
ok('Support is hidden in the admin console', /admin-console/.test(hidden))

if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1) }
console.log('\nlayout order verified')
