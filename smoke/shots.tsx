// smoke/shots.tsx — render the REAL app to static HTML for visual review.
//
// Not a test. The user's standing rule is to see the actual result, not a claim
// that it works, and there is no browser in this sandbox.
//
// The store hydrates inside a useEffect, and react-dom/server never runs
// effects — so server-rendering produces the DEFAULTS, which is exactly the
// wrong thing to show. This mounts the real app in jsdom with a seeded
// localStorage instead, lets the effects run, then serialises the DOM. What you
// see is what a browser paints.
import { writeFileSync, readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

const css = readFileSync('/tmp/tw.css', 'utf8')

// ------------------------------------------------------------------ DOM ---

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://floatbet.space/',
  pretendToBeVisual: true,
})
const w = dom.window
if (!(globalThis as any).markResourceTiming) (globalThis as any).markResourceTiming = () => undefined
// `navigator` is a getter-only property on the Node global, so it is defined
// rather than assigned.
Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true })
Object.assign(globalThis as any, {
  window: w,
  document: w.document,
  localStorage: w.localStorage,
  sessionStorage: w.sessionStorage,
  HTMLElement: w.HTMLElement,
  Element: w.Element,
  Node: w.Node,
  Text: w.Text,
  Event: w.Event,
  CustomEvent: w.CustomEvent,
  MutationObserver: w.MutationObserver,
  getComputedStyle: w.getComputedStyle.bind(w),
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as any,
  cancelAnimationFrame: (id: any) => clearTimeout(id),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  IS_REACT_ACT_ENVIRONMENT: true,
})
;(globalThis as any).fetch = async () =>
  new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })

// ------------------------------------------------------------------ app ---

const mod = await import('../src/App')
const App = mod.default
const { StoreProvider } = await import('../src/lib/store')
const { AuthProvider } = await import('../src/lib/auth')

const REAL = {
  balance: 25000, mode: 'real',
  free: { credits: 1000000, bets: [], stats: {} },
  bets: [], stats: {}, username: 'player',
}
const FREE = {
  balance: 25000, mode: 'free',
  free: { credits: 1000000, bets: [], stats: {} },
  bets: [], stats: {}, username: 'player',
}

async function snapshot(seed: Record<string, unknown>, hash = ''): Promise<string> {
  w.localStorage.clear()
  w.localStorage.setItem('floatbet.v2', JSON.stringify(seed))
  // Skip the boot studio ident, which covers the app for ~2.5s. It is the same
  // component in both states, so leaving it in would hide the thing being shown.
  try { w.sessionStorage.setItem('nokwaff.ident.seen', '1') } catch { /* ignore */ }
  w.location.hash = hash
  const host = w.document.getElementById('root')!
  host.innerHTML = ''
  const root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(AuthProvider, null, React.createElement(StoreProvider, null, React.createElement(App))))
  })
  // Drive a real sign-in so the shell renders rather than the sign-in gate.
  const { fireSignIn } = await import('./fakeauth')
  await act(async () => { fireSignIn(); await new Promise((r) => setTimeout(r, 400)) })
  // Effects (hydrate, hash routing) settle on timers, not promises.
  await act(async () => { await new Promise((r) => setTimeout(r, 250)) })
  const html = host.innerHTML
  await act(async () => { root.unmount() })
  return html
}

const real = await snapshot(REAL, '#/')
const free = await snapshot(FREE, '#/')

const shell = (body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style>
<style>body{background:#08090f;margin:0}.label{font:700 10px/1.6 system-ui;letter-spacing:.18em;color:#8b8f9c;background:#12141c;padding:6px 12px;border-top:1px solid #22262f;border-bottom:1px solid #22262f}</style>
</head><body>
<div class="label">REAL MONEY MODE — real balance 25,000</div>${real}
<div class="label">FREE PLAY MODE — 1,000,000 practice credits, real balance still 25,000</div>${free}
</body></html>`

writeFileSync('currency-preview.html', shell(''))
console.log('real bytes', real.length, 'free bytes', free.length)
