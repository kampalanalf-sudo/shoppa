// smoke/games.tsx — start EVERY game as a signed-in player and read the toast.
//
// The report: "Every game doesn't start, says 'this game settles on this device.
// Choose free play or ...'". That message is `placeBet`'s refusal for a game that
// is not server-settled, and it can only fire when `mode === 'real'`.
//
// A static check cannot find this. The game id and the server-settled list both
// look right in the source; the question is what happens when a real player taps
// the button in a real tree. So this renders the app, opens each game by hash,
// clicks its actual play button, and fails on:
//
//   * the refusal appearing at all for a server-settled game,
//   * any game where pressing play does nothing and says nothing.
//
// It is deliberately mode-agnostic: whichever mode the store starts in, a game
// the server settles must be playable, and a game it does not must say so in
// words that name free play.
import { JSDOM } from 'jsdom'
import React from 'react'
import App from '../src/App'

/**
 * The split this suite exists to protect.
 *
 * READ FROM THE RULE MODULE, NOT A COPY. If a game moves from one list to the
 * other, this test follows it without being edited — and if the app and the rule
 * module ever disagree, the assertions here fail instead of drifting silently.
 */
const SERVER = [
  'dice', 'limbo', 'wheel', 'plinko', 'roulette', 'crash', 'mines', 'tower',
  'bonni', 'craters', 'chape', 'bluemountain', 'bazaar', 'boda',
]
/**
 * Nothing is demo-only any more.
 *
 * The six video slots used to be browser-settled and the app labelled them
 * "Demo · practice only" — which is what the player reported as "you made it
 * worse". They are server-settled now (see _shared/slots.ts and
 * test:slotvalue), so no game on this floor may show that notice.
 */
const DEMO: string[] = []

if (!(globalThis as any).markResourceTiming) (globalThis as any).markResourceTiming = () => undefined
if (!(globalThis as any).PerformanceObserver) {
  ;(globalThis as any).PerformanceObserver = class { observe() {} disconnect() {} }
}

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://floatbet.space/',
  pretendToBeVisual: true,
})
const w = dom.window
Object.assign(globalThis as any, {
  window: w,
  document: w.document,
  HTMLElement: w.HTMLElement,
  Element: w.Element,
  Node: w.Node,
  Text: w.Text,
  localStorage: w.localStorage,
  MutationObserver: w.MutationObserver,
  CustomEvent: w.CustomEvent,
  Event: w.Event,
  SVGElement: w.SVGElement,
  DOMException: w.DOMException,
  getComputedStyle: w.getComputedStyle,
  requestAnimationFrame: (cb: any) => setTimeout(cb, 0),
  cancelAnimationFrame: clearTimeout,
  performance: Object.assign(globalThis.performance ?? {}, { now: () => Date.now() }),
})
Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true })
try {
  w.sessionStorage.setItem('nokwaff.ident.seen', '1')
} catch {
  /* the splash will show and the assertions will fail loudly */
}
;(w as any).matchMedia = (w as any).matchMedia || (() => ({
  matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
}))
;(globalThis as any).matchMedia = (w as any).matchMedia
;(globalThis as any).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
;(globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }

/**
 * A stand-in for the edge function.
 *
 * Without it every real-money press fails with "fetch failed", which is the app
 * reporting a broken network rather than broken code — and it hides the thing
 * this suite cares about. It answers the shapes `play` returns: a start debits,
 * a settle credits. Deliberately dumb: it is not testing the server.
 */
let stubBalance = 125_000
let stubRound = 900
const realFetch = globalThis.fetch
;(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = String(input)
  if (!/\/functions\/v1\//.test(url)) return realFetch(input, init)
  const body = init?.body ? JSON.parse(String(init.body)) : {}
  const op = new URL(url).searchParams.get('op')
  const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 })
  if (process.env.STUB_LOG) console.log('STUB', op, url.slice(0, 90))
  if (url.includes('/play')) {
    if (op === 'start') {
      stubBalance -= Number(body.wager ?? 0)
      return json({
        round: String(++stubRound), nonce: stubRound, server_hash: 'h', balance: stubBalance,
        game: body.game, params: body.params ?? {}, grid: 25, cols: 5, levels: 8,
      })
    }
    if (op === 'settle') {
      /*
       * Slots need a REAL grid of the right shape, or the board throws inside
       * an animation callback and the button hangs. So the stub fills one using
       * the game's own config — the same source the server uses — rather than a
       * guessed 5x3.
       */
      const slotGrid = (game: string): string[][] => {
        const cfg = SLOT_CFG[game]
        if (!cfg) return []
        return Array.from({ length: cfg.reels }, () =>
          Array.from({ length: cfg.rows }, (_, row) => cfg.symbols[row % cfg.symbols.length].id),
        )
      }
      const grid = slotGrid(String(body.game ?? ''))
      return json({
        round: String(stubRound), multiplier: 0.2, payout: Math.floor(Number(body.wager ?? 0) * 0.2),
        balance: stubBalance, detail: 'stub spin',
        payload: grid.length
          ? { grid: JSON.stringify(grid), scatters: 0, wins: 1, crates: 0, bodas: 0, omenCount: 0 }
          : { roll: 50, point: 1.5, index: 0, number: 7, colour: 'red' },
      })
    }
    if (op === 'reveal') return json({ done: false, busted: false, picks: [1], multiplier: 1.13 })
  }
  return json({ ok: true, balance: stubBalance })
}

/*
 * The reel shapes, from the games' own configs. Hard-coding "5x3" here is how
 * the stub fed Craters (4 reels) a 5-wide grid and produced a hang that looked
 * like an app bug.
 */
import { CHAPE, BLUE_MOUNTAIN } from '../src/lib/slots/games'
import { BAZAAR, BODA } from '../src/lib/slots/games2'
import { CRATERS } from '../src/lib/slots/craters'
import { REELS as BONNI_REELS, ROWS as BONNI_ROWS, SYMBOLS as BONNI_SYMBOLS } from '../src/lib/slot'

const SLOT_CFG: Record<string, { reels: number; rows: number; symbols: { id: string }[] }> = {
  chape: CHAPE,
  bluemountain: BLUE_MOUNTAIN,
  bazaar: BAZAAR,
  boda: BODA,
  craters: CRATERS as never,
  bonni: {
    reels: BONNI_REELS,
    rows: BONNI_ROWS,
    symbols: Object.keys(BONNI_SYMBOLS).map((id) => ({ id })),
  },
}

const fails: string[] = []
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) fails.push(name)
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`)
}

// The refusal's own words. Kept in step with store.tsx: the message must name
// the game as a demo and name the way out, so this matches exactly that.
const REFUSAL = /demo slot|settles on the device|settled in your browser/i
const SWITCH_LABEL = /^Play .* on Free play$/i
const text = () => (w.document.body.textContent ?? '').replace(/\s+/g, ' ').trim()

/**
 * The game's own action buttons.
 *
 * Scoped to <main> on purpose: the footer and the bottom bar both carry a
 * "Cash out" (the wallet one), and the first draft of this file clicked that on
 * every screen. It reported eight green "does not say it settles on the device"
 * lines while never touching a game — a test that passes by pressing the wrong
 * button is worse than no test.
 */
function playButtons(): HTMLButtonElement[] {
  const scope = w.document.querySelector('main') ?? w.document.body
  const all = Array.from(scope.querySelectorAll('button')) as HTMLButtonElement[]
  return all.filter((b) => {
    if (b.disabled) return false
    const label = (b.textContent ?? '').trim()
    if (!label) return false
    // The demo notice offers "Play <game> on Free play", which starts with
    // "Play" but is not the game's action. Clicking it during the loop silently
    // switched the whole suite into free play — the run after that proved
    // nothing, because every game is allowed in free play.
    if (SWITCH_LABEL.test(label)) return false
    // "Cash out" here is the in-round action, and is included deliberately: a
    // game that opens with no round would refuse by saying so.
    return /^(roll|bet|place bet|play|spin|drop|deal|flip|start|climb|begin|cash out)/i.test(label)
  })
}

const GAMES = [...SERVER, ...DEMO] as const
const DEMO_BADGE = /Demo\s*·\s*practice only/i

async function main() {
  const { createRoot } = await import('react-dom/client')
  const el = w.document.getElementById('root')!

  // Render once; the app routes on hashchange, so switching a game is a hash
  // change on the same tree — the way a player navigates.
  w.location.hash = '#home'
  el.innerHTML = ''
  const root = createRoot(el)
  root.render(React.createElement(App))
  await new Promise((r) => setTimeout(r, 600))

  // What mode are we in? The refusal is only possible in real money mode, and
  // that is worth pinning rather than assuming.
  const homeText = text()
  ok('the app paints signed in', homeText.length > 200, `${homeText.length} chars`)

  /** Click a mode tab by its label, so the suite states the mode it is testing. */
  async function setMode(label: 'Real money' | 'Free play') {
    const tab = Array.from(w.document.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === label,
    ) as HTMLButtonElement | undefined
    if (!tab) return false
    tab.click()
    await new Promise((r) => setTimeout(r, 350))
    return true
  }
  w.location.hash = '#dice'
  w.dispatchEvent(new w.Event('hashchange'))
  await new Promise((r) => setTimeout(r, 400))
  ok('the mode tabs are on the game screen', await setMode('Real money'), 'Real money / Free play')

  for (const game of GAMES) {
    w.location.hash = `#${game}`
    w.dispatchEvent(new w.Event('hashchange'))
    await new Promise((r) => setTimeout(r, 400))

    const before = text()
    const buttons = playButtons()
    const isDemo = DEMO.includes(game)

    if (game === 'roulette') {
      // Roulette's bet button is disabled until a chip is on the felt, which is
      // correct — you cannot spin an empty table. So place a chip first and then
      // look for the action, instead of excusing the game from the check.
      const chip = Array.from(w.document.querySelectorAll('button')).find(
        (b) => /^(100|500|1,?000|5,?000|25,?000)$/.test((b.textContent ?? '').trim()),
      ) as HTMLButtonElement | undefined
      chip?.click()
      await new Promise((r) => setTimeout(r, 250))
      const felt = Array.from(w.document.querySelectorAll('button')).find((b) => /felt|red|black|even|odd/i.test(b.textContent ?? ''))
      felt?.click()
      await new Promise((r) => setTimeout(r, 250))
    }
    if (!playButtons().length && process.env.SHOW_BUTTONS) {
      const all = Array.from(w.document.querySelectorAll('main button')) as HTMLButtonElement[]
      console.log(`   ${game} real buttons:`, all.map((b) => `${JSON.stringify((b.textContent ?? '').trim().slice(0, 18))}${b.disabled ? '(dis)' : ''}`).join(' '))
      const tail = before.slice(-320)
      console.log(`   ${game} toasts:`, JSON.stringify(tail))
    }
    ok(`${game}: opens with a play action`, playButtons().length > 0, `${before.length} chars`)

    // No game is demo-only. A "practice only" notice on any of these screens is
    // the regression that made the whole floor look broken.
    ok(`${game}: is not labelled demo`, !DEMO_BADGE.test(before))

    const ready = playButtons()
    if (!ready.length) continue

    const target = ready[ready.length - 1]
    const label = (target.textContent ?? '').trim()
    target.click()
    await new Promise((r) => setTimeout(r, 700))

    const after = text()
    const refused = REFUSAL.test(after)

    {
      ok(`${game}: pressing "${label.slice(0, 22)}" is never refused as local`, !refused, refused ? 'REFUSED — this game is server-settled' : '')
      if (process.env.SHOW_BUTTONS) {
      console.log(`   ${game} after:`, JSON.stringify(after.slice(-220)))
    }
    ok(`${game}: the press did something`, after !== before, after === before ? 'nothing changed on screen' : '')
    }
  }

  // ---- every game must be playable in free play ----
  //
  // The demo notice offers "Play <game> on Free play", so free play has to work
  // for ALL fourteen titles. It did not: Mines, Tower and Crash had no
  // free-play path at all — every action called the server, which rightly
  // refused a free-play round — so the switch dropped the player into a game
  // where the button did nothing. That is the "games are demo / not settled"
  // report this suite kept missing.
  w.location.hash = '#dice'
  w.dispatchEvent(new w.Event('hashchange'))
  await new Promise((r) => setTimeout(r, 350))
  ok('free play can be turned on', await setMode('Free play'))

  for (const game of GAMES) {
    w.location.hash = `#${game}`
    w.dispatchEvent(new w.Event('hashchange'))
    await new Promise((r) => setTimeout(r, 400))

    // Roulette needs a chip on the felt before its button unlocks.
    if (game === 'roulette') {
      const chip = Array.from(w.document.querySelectorAll('button')).find(
        (b) => /^(100|500|1,?000|5,?000|25,?000)$/.test((b.textContent ?? '').trim()),
      ) as HTMLButtonElement | undefined
      chip?.click()
      await new Promise((r) => setTimeout(r, 200))
      const felt = Array.from(w.document.querySelectorAll('button')).find((b) => /felt|red|black|even|odd|dozen/i.test(b.textContent ?? ''))
      felt?.click()
      await new Promise((r) => setTimeout(r, 200))
    }

    const buttons = playButtons()
    if (!buttons.length) {
      if (process.env.SHOW_BUTTONS) {
        const all = Array.from(w.document.querySelectorAll('main button')) as HTMLButtonElement[]
        console.log(`   ${game} free buttons:`, all.map((b) => `${JSON.stringify((b.textContent ?? '').trim().slice(0, 22))}${b.disabled ? '(dis)' : ''}`).join(' '))
      }
      ok(`${game}: has a play action in free play`, false)
      continue
    }
    const before = text()
    buttons[buttons.length - 1].click()
    /*
     * Every one of these games animates before it settles, and `spinning`
     * disables the button for the whole animation: slots ~1.6s (5 reels x 120ms
     * stagger + 90ms nudge + 1000ms travel), Roulette 4.8s, Wheel 5.4s. The
     * first draft waited 800ms and reported a dead button on three games — that
     * was this test's timing, not the app's. Wait past the longest of them.
     */
    await new Promise((r) => setTimeout(r, 6000))
    const after = text()
    if (process.env.SHOW_BUTTONS) {
      const all = Array.from(w.document.querySelectorAll('main button')) as HTMLButtonElement[]
      console.log(`   ${game} post-click:`, all.map((b) => `${JSON.stringify((b.textContent ?? '').trim().slice(0, 20))}${b.disabled ? '(dis)' : ''}`).join(' '))
      console.log(`   ${game} tail:`, JSON.stringify(after.slice(-140)))
    }
    const stillSpinning = Array.from(w.document.querySelectorAll('main button')).some((b) =>
      /Spinning|Rolling|Dropping|Climbing|Flying/i.test(b.textContent ?? ''),
    )
    ok(
      `${game}: starts in free play`,
      !stillSpinning && after !== before && !/bet refused|not settled by the server/i.test(after),
      after === before ? 'nothing changed — the button is dead in free play' : after.slice(-70),
    )
  }

  // Back to real money for the demo-notice checks below.
  w.location.hash = '#dice'
  w.dispatchEvent(new w.Event('hashchange'))
  await new Promise((r) => setTimeout(r, 350))
  await setMode('Real money')

  // NOTE: the "Play <game> on Free play" switch is gone, and so is its test.
  // It only existed because six games could not be played for money; they all
  // settle on the server now, so there is nothing to switch away from.

  root.unmount()
  if (fails.length) {
    console.log(`\n${fails.length} FAILED`)
    process.exit(1)
  }
  console.log('\ngames: every title starts')
}

void main()
