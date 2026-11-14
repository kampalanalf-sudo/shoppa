import { renderToString } from 'react-dom/server'
import App from '../src/App'
import { StoreProvider } from '../src/lib/store'
import { Home } from '../src/pages/Home'
import { Plinko } from '../src/games/Plinko'
import { Crash } from '../src/games/Crash'
import { Mines } from '../src/games/Mines'
import { Dice } from '../src/games/Dice'
import { Limbo } from '../src/games/Limbo'
import { Wheel, WHEEL_RTP } from '../src/games/Wheel'
import { Tower } from '../src/games/Tower'
import { Roulette } from '../src/games/Roulette'
import { Header, Footer, WinFlash, Toasts, ChatDock, BottomBar } from '../src/components/Chrome'
import { WalletModal, FairModal, HistoryModal, SearchModal, RewardsModal } from '../src/components/Modals'

const noop = () => {}
const games: [string, any][] = [
  ['plinko', Plinko], ['crash', Crash], ['mines', Mines], ['dice', Dice],
  ['limbo', Limbo], ['wheel', Wheel], ['tower', Tower], ['roulette', Roulette],
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

console.log(fails ? `\n${fails} FAILURES` : '\nall render + invariant checks passed')
process.exit(fails ? 1 : 0)
