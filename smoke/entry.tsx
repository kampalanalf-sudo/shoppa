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
import { EngineSlot } from '../src/games/EngineSlot'
import { CHAPE, BLUE_MOUNTAIN } from '../src/lib/slots/games'
import { BAZAAR, BODA } from '../src/lib/slots/games2'
import { simulate, resolve, buildGrid, countSymbol } from '../src/lib/slots/engine'
import { SYMBOLS, SYMBOL_POOL, buildGrid as bonniGrid, resolve as bonniResolve } from '../src/lib/slot'
import { Header, Footer, WinFlash, Toasts, ChatDock, BottomBar } from '../src/components/Chrome'
import { WalletModal, FairModal, HistoryModal, SearchModal, RewardsModal } from '../src/components/Modals'

const noop = () => {}
const games: [string, any][] = [
  ['plinko', Plinko], ['crash', Crash], ['mines', Mines], ['dice', Dice],
  ['limbo', Limbo], ['wheel', Wheel], ['tower', Tower], ['roulette', Roulette],
  ['bonni', BonniClyve],
]
const engineGames: [any, any][] = [
  ['chape', CHAPE], ['bluemountain', BLUE_MOUNTAIN], ['bazaar', BAZAAR], ['boda', BODA],
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
for (const [id, cfg] of engineGames) run(`Game:${id}`, <EngineSlot config={cfg} id={id} onBack={noop} onFair={noop} />)
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
  const g = bonniGrid(Array.from({ length: 15 }, rnd))
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

// engine slot invariants
for (const [id, cfg] of engineGames) {
  const r = simulate(cfg, 400000)
  check(`${id} RTP in band`, Math.abs(r.rtp - 0.962) < 0.02, `(${(r.rtp * 100).toFixed(2)}%)`)
  check(`${id} grid shape`, (() => {
    const g = buildGrid(cfg, Array.from({ length: cfg.reels * cfg.rows }, (_, i) => (i * 0.137) % 1))
    return g.length === cfg.reels && g.every((c) => c.length === cfg.rows)
  })())
}
// Build a grid of a fixed shape from a per-cell id function
const mk = (cfg: any, fn: (reel: number, row: number) => string) =>
  Array.from({ length: cfg.reels }, (_, r) =>
    Array.from({ length: cfg.rows }, (_, c) => ({ id: fn(r, c), reel: r, row: c })),
  )

check('Chape omen fines on 3+ Faith', (() => {
  const g = mk(CHAPE, (r) => (r < 3 ? 'faith' : 'bottle'))
  const o = resolve(CHAPE, g as any)
  return countSymbol(g as any, 'faith') === 9 && o.fine === CHAPE.omen!.fine && o.totalMultiplier === 0
})(), `(fine ${CHAPE.omen!.fine}×)`)

check('Blue Mountain: 3 Georgies trigger free spins', (() => {
  const g = mk(BLUE_MOUNTAIN, (r) => (r < 3 ? 'georgie' : 'cigar'))
  const o = resolve(BLUE_MOUNTAIN, g as any)
  return o.triggered && o.freeSpins === BLUE_MOUNTAIN.freeSpins
})(), `(${BLUE_MOUNTAIN.freeSpins} spins)`)

check('Chape wild substitutes for the Baron', (() => {
  const g = mk(CHAPE, (r) => (r === 4 ? 'stash' : 'baron'))
  const o = resolve(CHAPE, g as any)
  const w = o.wins.find((x) => x.symbol === 'baron')
  return !!w && w.reels === 5
})())

check('slot RTP ~96.2%', (() => {
  let s = 0x51ed2701
  const rnd = () => { s = (s + 0x9e3779b9) | 0; let t = s ^ (s >>> 16); t = Math.imul(t, 0x21f0aaad); t = t ^ (t >>> 15); t = Math.imul(t, 0x735a2d97); return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296 }
  const N = 400000
  let sum = 0
  for (let i = 0; i < N; i++) sum += bonniResolve(bonniGrid(Array.from({ length: 15 }, rnd))).totalMultiplier
  const rtp = sum / N
  console.log(`     slot sim RTP = ${(rtp * 100).toFixed(2)}%`)
  return Math.abs(rtp - 0.962) < 0.006
})())

console.log(fails ? `\n${fails} FAILURES` : '\nall render + invariant checks passed')
process.exit(fails ? 1 : 0)
