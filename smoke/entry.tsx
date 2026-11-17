import { renderToString } from 'react-dom/server'
import App from '../src/App'
import { StoreProvider } from '../src/lib/store'
import { Home } from '../src/pages/Home'
import { ProxiCash } from '../src/pages/ProxiCash'
import { ASSETS, ASSET_IDS, quote, validPhone, railForPhone, normalisePhone } from '../src/lib/proxicash'
import { Plinko } from '../src/games/Plinko'
import { Crash } from '../src/games/Crash'
import { Mines } from '../src/games/Mines'
import { Dice } from '../src/games/Dice'
import { Limbo } from '../src/games/Limbo'
import { Wheel, WHEEL_RTP } from '../src/games/Wheel'
import { Tower } from '../src/games/Tower'
import { Roulette } from '../src/games/Roulette'
import { BonniClyve } from '../src/games/BonniClyve'
import { SYMBOLS, SYMBOL_POOL, buildGrid, resolve } from '../src/lib/slot'
import { Header, Footer, WinFlash, Toasts, ChatDock, BottomBar } from '../src/components/Chrome'
import { WalletModal, FairModal, HistoryModal, SearchModal, RewardsModal } from '../src/components/Modals'

const noop = () => {}
const games: [string, any][] = [
  ['plinko', Plinko], ['crash', Crash], ['mines', Mines], ['dice', Dice],
  ['limbo', Limbo], ['wheel', Wheel], ['tower', Tower], ['roulette', Roulette],
  ['bonni', BonniClyve],
]

let fails = 0
const run = (name: string, node: any) => {
  try {
    const html = renderToString(<StoreProvider>{node}</StoreProvider>)
    if (!html) throw new Error('empty output')
    console.log(`ok   ${name} (${html.length} bytes)`)
    return html
  } catch (e: any) {
    fails++
    console.log(`FAIL ${name}: ${e?.message}`)
    console.log((e?.stack ?? '').split('\n').slice(0, 5).join('\n'))
    return ''
  }
}

run('App', <App />)
run('Home', <Home onPlay={noop} onSearch={noop} onFair={noop} />)
run('ProxiCash', <ProxiCash onBack={noop} />)
for (const [id, C] of games) run(`Game:${id}`, <C onBack={noop} onFair={noop} />)
run('Chrome', <><Header view="home" onNavigate={noop} onSearch={noop} /><BottomBar view="home" onNavigate={noop} /><Footer /><WinFlash /><Toasts /><ChatDock /></>)
run('Modal:wallet', <WalletModal forceOpen />)
run('Modal:fair', <FairModal forceOpen />)
run('Modal:history', <HistoryModal forceOpen />)
run('Modal:search', <SearchModal open onClose={noop} onPick={noop} />)
run('Modal:rewards', <RewardsModal forceOpen />)

// invariants
const check = (name: string, cond: boolean, extra = '') => {
  if (!cond) { fails++; console.log(`FAIL invariant: ${name} ${extra}`) }
  else console.log(`ok   invariant: ${name} ${extra}`)
}
check('wheel RTP is 99%', Math.abs(WHEEL_RTP - 0.99) < 1e-9, `(${(WHEEL_RTP * 100).toFixed(2)}%)`)

// Bonni & Clyve slot math: 3x5 grid, every symbol resolvable, and the sim RTP
// must land inside the advertised 96.2% +- 0.6 band over 400k spins.
check('slot grid is 5 reels x 3 rows', (() => {
  let s = 0x51ed2701
  const rnd = () => { s = (s + 0x9e3779b9) | 0; let t = s ^ (s >>> 16); t = Math.imul(t, 0x21f0aaad); t = t ^ (t >>> 15); t = Math.imul(t, 0x735a2d97); return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296 }
  const g = buildGrid(Array.from({ length: 15 }, rnd))
  return g.length === 5 && g.every((c) => c.length === 3)
})())
check('slot paytable covers all 8 paying symbols', SYMBOL_POOL.filter((id) => SYMBOLS[id].pay).length === 8, `(${SYMBOL_POOL.length} ids)`)
// ProxiCash exchange invariants
check('proxicash quotes are net of both fees', (() => {
  const q = quote('USDT', 100)
  const expected = 100 * ASSETS.USDT.ugxRate - ASSETS.USDT.networkFee * ASSETS.USDT.ugxRate
  return Math.abs(q.net - expected * 0.99) < 1e-6
})())
check('proxicash net never exceeds gross', ASSET_IDS.every((id) => {
  const q = quote(id, ASSETS[id].min * 10)
  return q.net > 0 && q.net < q.gross
}))
check('proxicash phone validation', (() => {
  const good = ['0772123456', '0700123456', '+256772123456', '256772123456']
  const bad = ['12345', '0872123456', '07721234567']
  return good.every(validPhone) && bad.every((b) => !validPhone(b))
})(), `(${normalisePhone('+256772123456')})`)
check('proxicash rail detection', railForPhone('0772123456') === 'MTN' && railForPhone('0700123456') === 'Airtel')

check('slot RTP ~96.2%', (() => {
  let s = 0x51ed2701
  const rnd = () => { s = (s + 0x9e3779b9) | 0; let t = s ^ (s >>> 16); t = Math.imul(t, 0x21f0aaad); t = t ^ (t >>> 15); t = Math.imul(t, 0x735a2d97); return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296 }
  const N = 400000
  let sum = 0
  for (let i = 0; i < N; i++) sum += resolve(buildGrid(Array.from({ length: 15 }, rnd))).totalMultiplier
  const rtp = sum / N
  console.log(`     slot sim RTP = ${(rtp * 100).toFixed(2)}%`)
  return Math.abs(rtp - 0.962) < 0.006
})())

console.log(fails ? `\n${fails} FAILURES` : '\nall render + invariant checks passed')
process.exit(fails ? 1 : 0)
