import { readFileSync, existsSync } from 'node:fs'

const fails: string[] = []
const ok = (n: string, c: boolean, e = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${e}`) }

const sw = readFileSync('public/sw.js', 'utf8')
const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'))
const html = readFileSync('index.html', 'utf8')

// ---------------------------------------------------------------- manifest --
ok('manifest: has a name and short_name', Boolean(manifest.name && manifest.short_name))
ok('manifest: standalone display', manifest.display === 'standalone')
ok('manifest: has a start_url and scope', Boolean(manifest.start_url && manifest.scope))
ok('manifest: theme + background colours set',
  manifest.theme_color === '#08090f' && manifest.background_color === '#08090f')

const icons = manifest.icons ?? []
ok('manifest: has a 192 and 512 "any" icon',
  icons.some((i: any) => i.purpose === 'any' && i.sizes === '192x192') &&
  icons.some((i: any) => i.purpose === 'any' && i.sizes === '512x512'))
ok('manifest: has a maskable icon at 512 (Android adaptive)',
  icons.some((i: any) => i.purpose === 'maskable' && i.sizes === '512x512'))

const missing = icons
  .map((i: any) => i.src.replace(/^\//, 'public/'))
  .filter((p: string) => !existsSync(p))
ok('manifest: every declared icon file exists', missing.length === 0, missing.join(', '))

// --------------------------------------------------------- service worker ---
ok('sw: refuses non-GET outright', /request\.method !== 'GET'\) return/.test(sw))
ok('sw: refuses any request carrying an Authorization header',
  /request\.headers\.has\('Authorization'\)\) return/.test(sw))

// The money rule, tested by behaviour rather than by grepping the source: pull
// the real NEVER_CACHE list out of the worker and run it against real URLs.
const start = sw.indexOf('const NEVER_CACHE')
const end = sw.indexOf(']', start)
const neverBlock = sw.slice(start, end)
const patterns = [...neverBlock.matchAll(/\/((?:\\.|[^/\\])+)\//g)].map((m) => new RegExp(m[1]))
ok('sw: found the never-cache list', patterns.length >= 4, `found ${patterns.length}`)

const isNever = (u: string) => patterns.some((re) => re.test(u))

const mustNever = [
  ['the collect route', 'https://shoppa-sigma.vercel.app/api/collect'],
  ['the store webhook', 'https://shoppa-sigma.vercel.app/api/webhooks/dgateway-store'],
  ['the admin queue', 'https://shoppa-sigma.vercel.app/api/admin/parked'],
  ['the claim route', 'https://shoppa-sigma.vercel.app/api/topup/claim'],
  ['supabase REST', 'https://dtroufrfavmjldtlprpn.supabase.co/rest/v1/wallets'],
  ['supabase auth', 'https://dtroufrfavmjldtlprpn.supabase.co/auth/v1/token'],
  ['supabase realtime', 'wss://dtroufrfavmjldtlprpn.supabase.co/realtime/v1/websocket'],
] as const
for (const [label, url] of mustNever) {
  ok(`sw: never caches ${label}`, isNever(url), url)
}

// ...and it must not over-block, or the app loses its offline shell.
ok('sw: still caches the shell', !isNever('https://shoppa-sigma.vercel.app/index.html'))
ok('sw: still caches hashed assets', !isNever('https://shoppa-sigma.vercel.app/assets/index-DWR88W--.js'))
ok('sw: still caches the manifest', !isNever('https://shoppa-sigma.vercel.app/manifest.webmanifest'))

ok('sw: deletes caches from older versions on activate', /k !== SHELL_CACHE && k !== ASSET_CACHE/.test(sw))
ok('sw: offline fallback says it cannot take payments', /Payments are never made offline/.test(sw))
ok('sw: hashed assets are cache-first', /isAsset\(url\)/.test(sw) && /caches\.match\(request\)/.test(sw))
ok('sw: HTML is network-first so deploys land', /request\.mode === 'navigate'/.test(sw))

// --------------------------------------------------------------- the shell --
ok('index.html: links the manifest', html.includes('rel="manifest"'))
ok('index.html: has an apple-touch-icon', html.includes('apple-touch-icon'))
ok('index.html: declares the standalone web-app capability',
  html.includes('apple-mobile-web-app-capable') && html.includes('mobile-web-app-capable'))
ok('index.html: theme-color matches the app background', html.includes('content="#08090f"'))
ok('index.html: viewport covers the notch', html.includes('viewport-fit=cover'))

// ------------------------------------------------------------ registration --
const pwa = readFileSync('src/lib/pwa.ts', 'utf8')
ok('pwa: does not register the SW in dev', /if \(!import\.meta\.env\.PROD\) return/.test(pwa))
ok('pwa: never auto-reloads on update (explicit user action only)',
  !/serviceWorker\.addEventListener\('(?:updatefound|controllerchange)',\s*\(\)\s*=>\s*\{?\s*window\.location\.reload/.test(pwa))

// ------------------------------------------------------------ site identity ====
// This repo has shipped the wrong production URL in its docs twice: it cited
// `shoppa-ten.vercel.app`, which belongs to someone else's project, and then
// pointed at a Vercel project called `proxicore-visor` that was actually this
// app under a misleading name. Both cost real time. Pin the truth here.
const SITE = 'shoppa-sigma.vercel.app'
const docs = ['docs/GO-LIVE.md', 'docs/PAYMENTS.md', 'docs/PRODUCTION.md', '.env.example']
  .map((f) => readFileSync(f, 'utf8'))
const cfg = readFileSync('capacitor.config.ts', 'utf8')
ok('the production URL is the project domain, not a borrowed one',
  docs.every((d) => d.includes(SITE)) && cfg.includes(SITE))
// shoppa-ten was never ours. Allow it only in prose explaining that fact.
// Allow the mention only where it is being explained as a mistake. The prose
// wraps, so scan by paragraph rather than by line.
ok('no document tells you to use shoppa-ten.vercel.app',
  docs.every((d) => (d.match(/[^\n]*(?:\n[^\n]*){0,3}shoppa-ten[^\n]*(?:\n[^\n]*){0,3}/g) ?? [])
    .every((block) => /never ours|was not ours|belongs to another|belonged/.test(block))))
// The project was renamed; the old name must not appear as an instruction.
ok('the Vercel helper refuses any project other than shoppa',
  readFileSync('scripts/set-vercel-env.sh', 'utf8')
    .includes('!= "shoppa"'))

if (fails.length) { console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
console.log('\nall PWA checks passed')
