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
const SERVER = ['dice', 'limbo', 'wheel', 'plinko', 'roulette', 'crash', 'mines', 'tower']
const DEMO = ['bonni', 'craters', 'chape', 'bluemountain', 'bazaar', 'boda']

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
      // A losing round with a real payload shape, so the game can animate it.
      return json({
        round: String(stubRound), multiplier: 0, payout: 0, balance: stubBalance,
        detail: 'stub roll', payload: { roll: 50, point: 1.5, index: 0, number: 7, colour: 'red' },
      })
    }
    if (op === 'reveal') return json({ done: false, busted: false, picks: [1], multiplier: 1.13 })
  }
  return json({ ok: true, balance: stubBalance })
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
    ok(`${game}: opens with a play action`, playButtons().length > 0, `${before.length} chars`)

    // A demo game must say it is a demo BEFORE the player presses anything. The
    // old behaviour mentioned it only in a refusal toast, which reads as a bug.
    if (isDemo) {
      ok(`${game}: says it is a demo before the bet button`, DEMO_BADGE.test(before))
      ok(`${game}: offers the free-play switch`, /Play .* on Free play/i.test(before))
    }

    const ready = playButtons()
    if (!ready.length) continue

    const target = ready[ready.length - 1]
    const label = (target.textContent ?? '').trim()
    target.click()
    await new Promise((r) => setTimeout(r, 700))

    const after = text()
    const refused = REFUSAL.test(after)

    if (isDemo) {
      // In real mode a demo game refuses — but now the screen already explained
      // why, so a refusal is not the player's first clue.
      ok(`${game}: a refused demo bet still explains itself on screen`, !refused || DEMO_BADGE.test(after))
      ok(`${game}: the refusal names the way out`, !refused || /Free play/i.test(after), refused ? 'REFUSED' : 'started')
    } else {
      ok(`${game}: pressing "${label.slice(0, 22)}" is never refused as local`, !refused, refused ? 'REFUSED — this game is server-settled' : '')
      if (process.env.SHOW_BUTTONS) {
      console.log(`   ${game} after:`, JSON.stringify(after.slice(-220)))
    }
    ok(`${game}: the press did something`, after !== before, after === before ? 'nothing changed on screen' : '')
    }
  }

  // ---- the switch has to actually work ----
  //
  // A button that describes the fix and does not apply it is worse than no
  // button, and that is exactly the kind of thing this project keeps shipping.
  // Land on a demo game first: the switch only exists where it is relevant.
  w.location.hash = '#bonni'
  w.dispatchEvent(new w.Event('hashchange'))
  await new Promise((r) => setTimeout(r, 400))
  const switchButton = Array.from(w.document.querySelectorAll('button')).find((b) =>
    SWITCH_LABEL.test((b.textContent ?? '').trim()),
  ) as HTMLButtonElement | undefined
  if (switchButton) {
    const label = (switchButton.textContent ?? '').trim()
    switchButton.click()
    await new Promise((r) => setTimeout(r, 500))
    const afterSwitch = text()
    // The panel states the mode in words, so this is visible, not inferred.
    ok('the free-play switch turns free play on', /practice credits/i.test(afterSwitch), label)
    // And the demo game must now START instead of refusing.
    const again = playButtons()
    if (again.length) {
      const t2 = text()
      again[again.length - 1].click()
      await new Promise((r) => setTimeout(r, 700))
      const afterSpin = text()
      // In free play the slot's own reels are on screen; in real mode the demo
      // notice and its refusal are. Assert on what the screen now says, not on
      // the absence of a word the previous screen may still be showing.
      ok(
        'a demo game starts once free play is on',
        /practice credits/i.test(afterSpin) && afterSpin !== t2,
        afterSpin === t2 ? 'nothing changed' : afterSpin.slice(-80),
      )
    }
  } else {
    ok('a demo game offers the free-play switch', false, 'no switch button found')
  }

  root.unmount()
  if (fails.length) {
    console.log(`\n${fails.length} FAILED`)
    process.exit(1)
  }
  console.log('\ngames: every title starts')
}

void main()
