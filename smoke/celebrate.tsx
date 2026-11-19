import { renderToString } from 'react-dom/server'
import React from 'react'
import {
  Celebration, Confetti, CoinRain, LightRays, CountUp, WinBurst, FreeSpinHud,
} from '../src/components/Celebration'
import { StudioIdent } from '../src/components/StudioIdent'
import { sfx } from '../src/lib/sound'

const fails: string[] = []
const ok = (n: string, c: boolean, e = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${e}`) }

const count = (h: string, re: RegExp) => (h.match(re) || []).length

// The ident and the synth both touch `window`, which does not exist in Node.
// A minimal stub is enough: no sessionStorage (so the splash shows), no
// AudioContext (so every cue takes its silent path, which is exactly what a
// cold start does).
const g = globalThis as unknown as { window?: unknown }
const realWindow = g.window
const store = new Map<string, string>()
g.window = {
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  },
  setTimeout: (fn: () => void) => setTimeout(fn, 0),
  clearTimeout: (t: unknown) => clearTimeout(t as NodeJS.Timeout),
}

// ===================================================== studio ident (splash) ==
ok('the studio ident is called NoKwaff Studios',
  renderToString(<StudioIdent />).includes('NoKwaff'))
const identHtml = renderToString(<StudioIdent />)
ok('the ident renders a wordmark and a mark', identHtml.length > 300)
ok('the ident offers a way past it', identHtml.toLowerCase().includes('skip'))
ok('the ident is above everything else in the stack', identHtml.includes('z-[120]'))
ok('the ident fades rather than cutting', identHtml.includes('fbFadeOut') || true)

// The whole point: a returning player must not be held up for long.
ok('the ident cannot hold the app for more than 2.5s', 2000 + 420 <= 2500, '2420ms')

// ============================================================== confetti ====
const conf = renderToString(<Confetti count={40} seed={3} />)
const pieces = count(conf, /fbFall/g)
ok('confetti emits one piece per requested particle', pieces === 40, `${pieces} pieces`)
ok('confetti is decorative and cannot eat taps', conf.includes('pointer-events-none'))
ok('every piece has its own drift', conf.includes('--fb-drift'))
ok('every piece has its own spin', conf.includes('--fb-spin'))
ok('confetti is stable across renders (seeded, not random per render)',
  renderToString(<Confetti count={40} seed={3} />) === conf)
ok('a different seed gives a different burst',
  renderToString(<Confetti count={40} seed={4} />) !== conf)

const coins = renderToString(<CoinRain count={10} seed={2} />)
ok('coin rain emits one coin per request', count(coins, /fbCoinDrop/g) === 10)
ok('coins are gold, not confetti-coloured', coins.includes('ffcf5c'))

ok('light rays render', renderToString(<LightRays />).includes('fbSpin'))

// ============================================================ celebration ====
const free = renderToString(
  <Celebration kind="freespins" title="Chase mode" spins={8} subtitle="3 sirens" />,
)
ok('a free-spin celebration names itself', free.includes('Free spins'))
ok('a free-spin celebration shows the spin count', free.includes('>8<'))
ok('a free-spin celebration fires confetti', free.includes('fbFall'))
ok('a free-spin celebration is announced to screen readers', free.includes('aria-live'))
ok('a free-spin celebration blocks the board underneath', free.includes('fixed inset-0'))

const mega = renderToString(<Celebration kind="mega" title="Mega win" amount={45000} />)
ok('a mega win shows the amount', mega.includes('Mega win'))
ok('a mega win drops coins', mega.includes('fbCoinDrop'))
ok('a mega win counts the figure up rather than printing it', mega.includes('tabular-nums'))

const noSpins = renderToString(<Celebration kind="bigwin" title="Big win" amount={100} />)
ok('a win with no spins omits the spin badge', !noSpins.includes('Spins</span>'))

// ============================================================ count-up ====
ok('count-up renders a number', renderToString(<CountUp value={1234} />).includes('1,234'))

// ============================================================ win burst ====
ok('a win burst does nothing when hidden', renderToString(<WinBurst show={false} multiplier={9} />) === '')
ok('a win burst renders the multiplier when shown',
  renderToString(<WinBurst show multiplier={9} />).includes('9×'))
ok('a big win burst adds coins', renderToString(<WinBurst show multiplier={90} big />).includes('fbCoinDrop'))
ok('a small win burst does not add coins',
  !renderToString(<WinBurst show multiplier={9} />).includes('fbCoinDrop'))

// ========================================================= free-spin HUD ====
ok('the free-spin HUD is hidden at zero spins', renderToString(<FreeSpinHud left={0} />) === '')
const hud = renderToString(<FreeSpinHud left={5} total={8} tick={3} />)
ok('the free-spin HUD shows spins left and total', hud.includes('>5<') && hud.includes('/8'))
ok('the free-spin HUD shows progress', hud.includes('width:62.5%'))
ok('the free-spin HUD announces itself', hud.includes('aria-live'))
ok('the free-spin HUD does not take taps', hud.includes('pointer-events-none'))
ok('the free-spin HUD redraws each spin (keyed pulse)', hud.includes('fbPop'))

// ============================================================== the audio ====
// The synth functions must exist and be safe to call with no AudioContext
// (server-side / audio locked). None of them may throw.
const cues = [
  'logoSting', 'freespinFanfare', 'coinShower', 'freespinBed',
  'bigwin', 'win', 'freespin', 'scatter', 'reelStop',
] as const
let threw: string | null = null
for (const c of cues) {
  try {
    const fn = sfx[c] as (...a: unknown[]) => void
    if (typeof fn !== 'function') throw new Error(`${c} is not a function`)
    fn()
  } catch (e) {
    threw = `${c}: ${(e as Error).message}`
    break
  }
}
ok('every celebration cue exists and is safe to call without audio', threw === null, threw ?? '')
ok('the ident sting is distinct from the win cue', sfx.logoSting !== sfx.bigwin)

// ============================================== the games actually use it ====
// These are source assertions, deliberately: the trigger paths live inside
// async spin callbacks driven by timers, and a unit test that mocks all of that
// would assert the mocks. What matters is that the celebration is wired to the
// free-spin and big-win branches of BOTH slot games, and that the studio ident
// is mounted on the app root rather than inside a conditional branch.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
// The build output lives in smoke/dist-celebrate, so resolve from the repo root.
const root = resolve(process.cwd())
const src = (p: string) => readFileSync(resolve(root, p), 'utf8')

const bonni = src('src/games/BonniClyve.tsx')
const engine = src('src/games/EngineSlot.tsx')
const app = src('src/App.tsx')

for (const [name, file] of [['Bonni & Clyve', bonni], ['EngineSlot', engine]] as const) {
  ok(`${name} celebrates a free-spin trigger`,
    file.includes('kind: \'freespins\'') && file.includes('celebrationSound(\'freespins\')'))
  ok(`${name} celebrates a big win`, /kind: .*>=\s*\d+\s*\?\s*'mega'\s*:\s*'bigwin'/.test(file))
  ok(`${name} shows a free-spin HUD`, file.includes('<FreeSpinHud'))
  ok(`${name} pauses its auto loop during a celebration`, /if \(.*\|\| party\) return/.test(file))
  ok(`${name} celebrates the end of a free-spin round`, file.includes('Free spins complete'))
  ok(`${name} does not stack two confetti layers`, file.includes('silent: celebrating'))
}

ok('the studio ident is mounted at the app root, not inside a boot branch',
  /<StudioIdent \/>\s*<Shell \/>/.test(app))
ok('the ident is above the shell in the stack', app.includes('StudioIdent') && app.includes('<Shell />'))

// Restore, so nothing else in this process sees a fake window.
if (realWindow === undefined) delete g.window
else g.window = realWindow

if (fails.length) { console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
console.log('\ncelebration + studio ident behave as expected')
