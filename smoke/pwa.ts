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
// ---- update delivery -------------------------------------------------------
//
// A cached shell is cache-first and the document is network-first, so a deploy
// lands on a fresh load. What it cannot do is reach an app that is already open:
// nothing re-reads the document, so without an announcement the device stays on
// its old build forever. That announcement was missing — `pwa.ts` listened for
// an UPDATED message that no worker ever sent, so the installed "Update
// available — Reload now" sheet could not appear.
ok('sw: announces UPDATED when an update installs', /postMessage\(\{ type: 'UPDATED' \}\)/.test(sw))
ok('sw: announces on install only when it is an update, not a first install',
  /firstInstall = !self\.registration\.active/.test(sw))
ok('sw: announces again once it takes control (activate)', (() => {
  const at = sw.indexOf("addEventListener('activate'")
  return at > -1 && sw.slice(at).includes("postMessage({ type: 'UPDATED' })")
})())
ok('sw: takes over immediately, so an update cannot sit waiting', /skipWaiting\(\)/.test(sw))

const pwaSrc = readFileSync('src/lib/pwa.ts', 'utf8')
ok('pwa: listens for the UPDATED message', pwaSrc.includes("e.data?.type === 'UPDATED'"))
ok('pwa: re-checks for an update when the app returns to the foreground',
  /visibilitychange/.test(pwaSrc) && /reg\.update\(\)/.test(pwaSrc))
ok('pwa: reloads when the new worker takes control', /controllerchange/.test(pwaSrc))
ok('pwa: applyUpdate does not reload before the worker activates', (() => {
  const at = pwaSrc.indexOf('export function applyUpdate')
  const body = pwaSrc.slice(at, at + 900)
  // The unconditional reload used to sit right after postMessage, racing the
  // activation. It must now be behind the `waiting` check.
  return body.indexOf('reg.waiting') > -1 && body.indexOf('postMessage') > body.indexOf('reg.waiting')
})())

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
ok('sw: content-addressed build assets are cache-first',
  /isImmutable\(url\)/.test(sw) && /caches\.match\(request\)/.test(sw))

// Art is NOT content-addressed: /art/bluemountain/jkaz.webp keeps its name when
// the portrait is redrawn. Caching it cache-first pinned every returning player
// to the old picture forever, which is why a repainted character showed no
// change at all. The rule is now about the directory, not the extension.
// The old rule judged immutability by extension ("anything .webp is a build
// asset"), which is what pinned players to old art. It must judge by directory.
ok('sw: immutability is decided by directory, not file extension', !/const isAsset/.test(sw))
ok('sw: immutability means /assets/ or /icons/ only',
  /pathname\.startsWith\('\/assets\/'\)/.test(sw) && /pathname\.startsWith\('\/icons\/'\)/.test(sw))
ok('sw: unhashed media is network-first so a redraw appears',
  /isMedia\(url\)/.test(sw) && /fetch\(request\)[\s\S]{0,200}caches\.open\(ASSET_CACHE\)/.test(sw))
ok('sw: unhashed media still has an offline fallback',
  /caches\.match\(request\)[\s\S]{0,80}Response\.error\(\)/.test(sw))
// A version bump is the only way to evict what older workers cached.
ok('sw: version was bumped past v3 to evict stale art', /const VERSION = 'v4'/.test(sw))
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
// ---- custom domain wiring -------------------------------------------------
// floatbet.space is served by GitHub Pages, so two things have to be true or
// the domain breaks in ways that look like an app bug: the CNAME has to ship
// inside dist/, and the build has to be root-relative because the manifest and
// the service worker use absolute paths.
const cname = readFileSync('public/CNAME', 'utf8').trim()
ok('public/CNAME names the production domain', cname === 'floatbet.space', cname)
ok('public/CNAME is a single line', cname.split('\n').length === 1)

const pagesFlow = readFileSync('.github/workflows/deploy-pages.yml', 'utf8')
ok('the Pages build uses a root base path', /BASE_PATH: '\/'/.test(pagesFlow))
ok('the Pages build does not use the /shoppa/ subpath',
  !/BASE_PATH: \$\{\{ format\('\/\{0\}\/'/.test(pagesFlow))
ok('the workflow fails if the CNAME does not reach dist/', /dist\/CNAME/.test(pagesFlow))
ok('the workflow fails on a subpath build', /shoppa\/assets/.test(pagesFlow))

// The manifest's paths are absolute, so they only resolve under a root deploy.
// If the base path and the manifest ever disagree the PWA 404s its own icons.
const manifestJson = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'))
ok('the manifest is root-relative',
  manifestJson.start_url.startsWith('/') && manifestJson.scope === '/')
ok('the manifest icons are root-relative',
  manifestJson.icons.every((i: { src: string }) => i.src.startsWith('/')))
ok('the service worker scope follows the build base',
  readFileSync('src/lib/pwa.ts', 'utf8').includes('scope: import.meta.env.BASE_URL'))

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
