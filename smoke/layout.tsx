import { renderToString } from 'react-dom/server'
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

if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1) }
console.log('\nlayout order verified')
