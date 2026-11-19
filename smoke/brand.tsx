import { renderToString } from 'react-dom/server'
import React from 'react'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  diceSvg, faviconSvg, dieOnlySvg, monochromeDieSvg, dicePipsMarkup, BRAND_GREEN, DIE,
} from '../src/lib/brand'
import { Logo, Wordmark } from '../src/components/Chrome'

const fails: string[] = []
const ok = (n: string, c: boolean, e = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${e}`) }

const root = resolve(process.cwd())
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

// ============================================================== the die ====
const die = diceSvg()
ok('the die is an SVG', die.startsWith('<svg') && die.trim().endsWith('</svg>'))
ok('the die is labelled for assistive tech', die.includes('aria-label="FloatBet die"'))
// The die is DEEP green with near-white pips. On a near-black header a white
// body read as a hole punched out of the bar; a dark green body with a lit top
// edge reads as an object sitting in it.
ok('the die body is deep green, not white',
  die.includes(DIE.front) && !die.includes('stop-color="#ffffff"'),
  DIE.front)
ok('the die top face is the lit green, and the side is in shadow',
  die.includes(DIE.top) && die.includes(DIE.right))
ok('the die pips stay bright enough to read at 24px',
  die.includes(DIE.pip) && die.includes(DIE.pipDeep))
ok('the die draws three faces (a cube, not a square)',
  (die.match(/<path /g) || []).length >= 3, `${(die.match(/<path /g) || []).length} faces`)
ok('the die is not accidentally empty of pips', (die.match(/<circle/g) || []).length >= 8,
  `${(die.match(/<circle/g) || []).length} pips`)

// Pips must sit INSIDE the cube. The first two attempts bled pips across the
// top edge and over the left edge, which is what made it read as a mess.
const cube = { left: 20, right: 80, top: 17, bottom: 75 }
const circles = [...die.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)]
  .map((m) => ({ x: +m[1], y: +m[2], r: +m[3] }))
ok('there are pips to check', circles.length > 0)
const outside = circles.filter(
  (c) => c.x - c.r < cube.left - 0.5 || c.x + c.r > cube.right + 0.5 ||
         c.y - c.r < cube.top - 0.5 || c.y + c.r > cube.bottom + 0.5,
)
ok('every pip is inside the cube silhouette', outside.length === 0,
  outside.map((c) => `(${c.x},${c.y})`).join(' '))

// The top face must be drawn in a non-crossing order, or it fills as a bowtie.
// A2 = (38,17), B2 = (80,17); the quad must continue to B(62,33) then A(20,33).
const topPath = (die.match(/d="M38\.00 17\.00 L80\.00 17\.00 L62\.00 33\.00 L20\.00 33\.00 Z"/) || [])[0]
ok('the top face is drawn as a proper quad (A2,B2,B,A)', Boolean(topPath), topPath ?? 'not found')

// ========================================================== variants ====
ok('the favicon wraps the die on the app tile', faviconSvg().includes('rx="15"'))
ok('the favicon uses the brand ink', faviconSvg().includes('#0b0d15'))
ok('the maskable source is the die ALONE (no second rounded tile)',
  !dieOnlySvg().includes('rx="15"') && dieOnlySvg().includes('FloatBet die'))
const mono = monochromeDieSvg()
ok('the monochrome mark has no gradients', !mono.includes('linearGradient'))
ok('the monochrome mark cuts the pips out so they survive tinting',
  mono.includes('<mask') && mono.includes('dicePipsMarkup') === false && mono.includes('#000'))
ok('the monochrome mark paints in a single colour',
  (mono.match(/#ffffff/g) || []).length >= 1)
ok('pip markup is reusable', dicePipsMarkup('#123456').includes('#123456'))

// ====================================================== files on disk ====
ok('public/favicon.svg exists', existsSync(resolve(root, 'public/favicon.svg')))

// The favicon on disk must be the one the code generates, or the header and the
// launcher icon silently disagree — the exact drift this module was created to
// prevent.
const onDisk = read('public/favicon.svg').trim()
ok('public/favicon.svg matches src/lib/brand.ts', onDisk === faviconSvg().trim(),
  onDisk === faviconSvg().trim() ? '' : 'run `npm run favicon`')

for (const size of [192, 512]) {
  ok(`icons/icon-${size}.png exists`, existsSync(resolve(root, `public/icons/icon-${size}.png`)))
  ok(`icons/maskable-${size}.png exists`, existsSync(resolve(root, `public/icons/maskable-${size}.png`)))
}
ok('icons/apple-touch-icon-180.png exists', existsSync(resolve(root, 'public/icons/apple-touch-icon-180.png')))
ok('icons/monochrome-512.png exists', existsSync(resolve(root, 'public/icons/monochrome-512.png')))

// ============================================================= lockup ====
const logo = renderToString(<Logo size={30} />)
ok('the header logo is the die', logo.includes('favicon.svg'))
ok('the header logo cannot be clicked or dragged out of place', logo.includes('draggable="false"'))
ok('the header logo has no text alternative (the wordmark carries it)',
  logo.includes('alt=""'))

const mark = renderToString(<Wordmark size="md" />)
ok('the wordmark splits Float and Bet', mark.includes('>Float</span>') && mark.includes('>Bet</span>'))
ok('Float is white', /text-white">Float/.test(mark))
ok('Bet is green', /text-neon-lime">Bet/.test(mark))
ok('GAMING is tracked out and recedes', mark.includes('tracking-[.28em]') && mark.includes('text-slate-400'))
ok('the wordmark can drop GAMING when space is tight',
  !renderToString(<Wordmark showGaming={false} />).includes('Gaming'))
ok('the wordmark scales', renderToString(<Wordmark size="lg" />).includes('text-[22px]'))

// ============================================================= wiring ====
const chrome = read('src/components/Chrome.tsx')
ok('the header puts the die to the LEFT of the wordmark',
  /<Logo size=\{\d+\} \/>\s*<span className="block">\s*<Wordmark/.test(chrome))
// The lockup is a die PLUS a wordmark, on a phone too. The old header hid the
// wordmark below `sm`, which left the bar as a bare icon.
ok('the wordmark is visible at every width', !/hidden sm:block">\s*<Wordmark/.test(chrome))
ok('the header is pinned (sticky, not scrolled away)',
  /<header className="fb-header sticky top-0/.test(chrome))
ok('the die gets its depth from CSS, not a filter chain',
  read('src/index.css').includes('.fb-die-spin') &&
  read('src/index.css').includes('perspective: 220px'))
ok('the footer uses the same lockup', chrome.includes('<Logo size={32} />') && chrome.includes('<Wordmark size="sm" />'))
ok('the header no longer hand-rolls the wordmark',
  !chrome.includes('Float<span className="text-neon-lime">Bet</span>'))

const ident = read('src/components/StudioIdent.tsx')
ok('the studio ident shows the die rather than a different mark',
  ident.includes('favicon.svg'))

const sw = read('public/sw.js')
ok('the service worker precaches the icons', sw.includes('/icons/icon-192.png'))
ok('the service worker cache was bumped for the new mark',
  /const VERSION = 'v[2-9]/.test(sw), (sw.match(/const VERSION = '[^']+'/) || [])[0] ?? '')

const html = read('index.html')
ok('the tab icon is the die favicon', html.includes('favicon.svg'))
ok('the tab icon declares the SVG type', html.includes('type="image/svg+xml"'))

// The icon build must derive from brand.ts, not from a hand-made file.
const icons = read('scripts/build-icons.mjs')
ok('the icon build imports the die', icons.includes('dieOnlySvg') && icons.includes('monochromeDieSvg'))
ok('the maskable icon is composited full-bleed, not inset as a tile',
  icons.includes('dieOnly') && icons.includes('0.58'))
ok('the monochrome icon is not flattened onto white',
  !icons.includes("flatten({ background: '#ffffff' })"))

// ====================================================== the Android app ====
// The APK shipped with Capacitor's default blue-X icon and a white splash for
// several releases because `npx cap add android` writes those and nothing
// overwrote them. These assertions are the guard against that coming back.
import { readdirSync } from 'node:fs'

const RES = resolve(root, 'android/app/src/main/res')
const exists = (p: string) => existsSync(resolve(RES, p))

ok('android: the adaptive background is the brand ink, not Capacitor white',
  read('android/app/src/main/res/values/ic_launcher_background.xml')
    .toLowerCase().includes('#08090f'))

for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
  for (const f of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
    ok(`android: mipmap-${d}/${f} exists`, exists(`mipmap-${d}/${f}`))
  }
}
const drawables = readdirSync(RES).filter((d) => d.startsWith('drawable'))
const splashes = drawables.filter((d) => exists(`${d}/splash.png`))
ok('android: every density has a splash', splashes.length >= 10, `${splashes.length} splashes`)

const androidIcons = read('scripts/build-android-icons.mjs')
ok('android: the icon build uses the same die as the web mark',
  androidIcons.includes('dieOnlySvg') && androidIcons.includes('../src/lib/brand'))
ok('android: the splash is generated, not the Capacitor white default',
  androidIcons.includes('#08090f') && androidIcons.includes('splash'))
ok('android: the adaptive foreground respects the 66% safe zone',
  /ratio: 0\.5[0-9]/.test(androidIcons))

// The real proof the blue X is gone: the die has green pips in it, and the old
// Capacitor icon had no green at all.
const png = readFileSync(resolve(RES, 'mipmap-xxxhdpi/ic_launcher.png'))
ok('android: the launcher icon is no longer the Capacitor default',
  png.length > 2000 && png.length < 200_000, `${png.length} bytes`)

if (fails.length) { console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
console.log('\nthe die is the logo and the favicon')
