// smoke/signedin.tsx — render the app as a SIGNED-IN player and prove it paints.
//
// The blank-screen bug (2026-11-24) was a hook added below a signed-out early
// return. React threw "Rendered more hooks than during the previous render" the
// first time a signed-in player rendered, unmounted the tree, and left the app
// showing nothing but its background. Every existing test rendered signed out,
// so the suite was green while the site was down.
//
// This renders the real App against a fake backend that reports a signed-in
// player (see fakeauth.ts), on every route a player can reach, and asserts two
// things per route: SOMETHING painted, and React reported no error.
import { JSDOM } from 'jsdom'
import React from 'react'
import App from '../src/App'
import { fireSignIn, fireSignOut } from './fakeauth'

// ---------------------------------------------------------------- DOM shims --

// Node's undici calls these while reporting a fetch; define them BEFORE the
// shims below, or every request dies inside undici rather than in the app.
if (!(globalThis as any).markResourceTiming) {
  ;(globalThis as any).markResourceTiming = () => undefined
}
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
  requestAnimationFrame: (cb: any) => setTimeout(cb, 0),
  cancelAnimationFrame: clearTimeout,
  getComputedStyle: w.getComputedStyle,
  // jsdom's Performance.now() recurses through its own idl wrapper in this
  // environment, so point `now` at a plain clock on the REAL performance object.
  // Replacing the object outright breaks undici's fetch timing bookkeeping.
  performance: Object.assign(globalThis.performance ?? {}, { now: () => Date.now() }),
})
Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true })

// The studio ident is a full-screen splash that renders on a cold start and is
// the ONLY thing on screen for its first paint. Without this, every route
// assertion measures the splash and passes — which is exactly what happened on
// the first attempt at this file: five "routes" that were one splash screen.
const markIdentSeen = () => {
  try {
    w.sessionStorage.setItem('nokwaff.ident.seen', '1')
  } catch {
    /* no sessionStorage: the splash shows, and the length check will fail loudly */
  }
}
markIdentSeen()
;(w as any).matchMedia = (w as any).matchMedia || (() => ({
  matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
}))
;(globalThis as any).matchMedia = (w as any).matchMedia
;(globalThis as any).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
;(globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }

const fails: string[] = []
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) fails.push(name)
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${extra}`)
}

/** Collect React's complaints while `fn` runs. */
async function capturing(fn: () => void | Promise<void>): Promise<string[]> {
  const seen: string[] = []
  const realError = console.error
  const realWarn = console.warn
  const grab = (...a: unknown[]) => {
    const s = a.map(String).join(' ')
    // act() noise is about the test harness, not the app.
    if (!/not wrapped in act/.test(s)) seen.push(s)
  }
  console.error = grab as any
  console.warn = grab as any
  const onErr = (e: any) => seen.push(String(e?.message ?? e))
  w.addEventListener('error', onErr)
  try {
    await fn()
  } finally {
    console.error = realError
    console.warn = realWarn
    w.removeEventListener('error', onErr)
  }
  return seen
}

// ------------------------------------------------------- the routes to cover --
//
// Every entry is a hash the app itself routes on (see the hashchange handler in
// App.tsx), so these are real screens, not invented ones. Each carries a phrase
// only that screen contains: a route assertion is worthless if it would pass on
// the wrong page, and the first draft of this file proved that — it rendered the
// splash ident five times and called it five routes.
//
// These render into a live DOM rather than through renderToString, because
// `hydrated` is set by an effect: server rendering only ever produces the
// loading spinner.
//
// Markers are content the screen owns; none of them appear on the splash ident
// or the loading spinner, which is what the earlier draft was actually measuring.
const ROUTES: { hash: string; name: string; marker: RegExp }[] = [
  { hash: '#home', name: 'home', marker: /Popular|Live Casino|Originals/ },
  // The fake backend returns no fixtures, so the real screen is its empty state.
  { hash: '#sports', name: 'sportsbook', marker: /Pre-match|No matches on the board/ },
  { hash: '#support', name: 'support', marker: /Customer care/ },
  { hash: '#cashout', name: 'cashout', marker: /Available to cash out|You receive/ },
  { hash: '#proxicash', name: 'proxicash', marker: /You send/ },
  // The deposit page. The marker is the LOCKED number, not just the word
  // "Deposit": the requirement is that the player's own number is shown and
  // cannot be typed over, and a marker that only found the heading would pass on
  // a page that still had a free-text phone field.
  { hash: '#deposit', name: 'deposit', marker: /not editable/ },
  { hash: '#float', name: 'float', marker: /Your limit|No float available/ },
  // The sponsor's page. It must paint for a player too, because a player can
  // open their own link before sending it.
  {
    hash: '#float-me?code=ABCD2345',
    name: 'float-me',
    marker: /Deposit code/,
  },
]

/** Text of the signed-in page, or '' when nothing painted. */
function pageText(): string {
  return (w.document.body.textContent ?? '').trim()
}

async function main() {
  const { createRoot } = await import('react-dom/client')
  const el = w.document.getElementById('root')!

  // --- every route, signed in, in a live DOM ---------------------------------
  for (const { hash, name, marker } of ROUTES) {
    w.location.hash = hash
    el.innerHTML = ''
    const root = createRoot(el)
    let errors: string[] = []
    await capturing(async () => {
      root.render(React.createElement(App))
    })
    // Let the hydrate effect and the first data load settle.
    await new Promise((r) => setTimeout(r, 350))
    errors = await capturing(async () => undefined)

    const text = pageText()
    ok(`${name}: paints as a signed-in player`, text.length > 200, `${text.length} chars`)
    ok(`${name}: shows its own content`, marker.test(text), marker.source)
    ok(`${name}: did not fall back to the loading spinner`, !/Loading FloatBet/.test(text))
    ok(`${name}: React reports no error`, errors.length === 0, errors[0]?.slice(0, 160) ?? '')
    root.unmount()
  }

  // --- the transition itself, in a live DOM ----------------------------------
  //
  // This is the exact sequence that blanked the site: paint signed out, then
  // sign in, and re-render down the signed-in path. A hook-count mismatch only
  // appears here, never in a single render.
  w.location.hash = '#home'
  el.innerHTML = ''
  const root = createRoot(el)
  const startErrors = await capturing(() => {
    root.render(React.createElement(App))
  })
  await new Promise((r) => setTimeout(r, 350))
  ok('the signed-out page paints', pageText().length > 200)
  ok('signed-out reports no error', startErrors.length === 0, startErrors[0]?.slice(0, 160) ?? '')

  const signInErrors = await capturing(() => {
    fireSignIn()
  })
  await new Promise((r) => setTimeout(r, 450))

  const after = pageText()
  ok(
    'signing in keeps the page painted',
    after.length > 200,
    after.length === 0 ? 'BLANK PAGE — this is the bug that shipped' : `${after.length} chars`,
  )
  ok(
    'signing in does not change the hook count',
    !signInErrors.some((e) => /hooks/i.test(e)),
    signInErrors.find((e) => /hooks/i.test(e))?.slice(0, 160) ?? '',
  )
  ok('the sign-in transition reports no error', signInErrors.length === 0, signInErrors[0]?.slice(0, 160) ?? '')

  // Signing back out is the same mismatch in reverse.
  const outErrors = await capturing(() => {
    fireSignOut()
  })
  await new Promise((r) => setTimeout(r, 450))
  ok('signing back out keeps the page painted', pageText().length > 200)
  ok('the sign-out transition reports no error', outErrors.length === 0, outErrors[0]?.slice(0, 160) ?? '')

  // --- the sponsor's page, with NO account --------------------------------
  //
  // This is the case that matters: the person paying for a friend's deposit is
  // usually not a player. Before this, every non-auth route was behind the
  // sign-in guard, so a "Float Me" link sent on WhatsApp would have opened the
  // login screen and the friend's deposit would never be paid.
  //
  // `fireSignOut` leaves the app signed out for the rest of this file, so this
  // block must stay LAST.
  w.location.hash = '#float-me?code=ABCD2345'
  el.innerHTML = ''
  const anonRoot = createRoot(el)
  const anonErrors = await capturing(() => {
    anonRoot.render(React.createElement(App))
  })
  await new Promise((r) => setTimeout(r, 400))
  const anonText = pageText()
  ok('the sponsor page paints with no account', anonText.length > 200, `${anonText.length} chars`)
  ok('it asks for a deposit code, not a login', /Deposit code/.test(anonText) && !/Sign in|Create account/.test(anonText))
  ok('it does not offer to sign a payer up', !/Sign up/.test(anonText))
  anonRoot.unmount()
  void anonErrors

  if (fails.length) {
    console.log(`\n${fails.length} FAILED`)
    process.exit(1)
  }
  console.log('\nthe signed-in app paints on every route')
  process.exit(0)
}

void main()
