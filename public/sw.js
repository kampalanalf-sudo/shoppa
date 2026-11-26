/* public/sw.js — FloatBet service worker
 *
 * Caching policy, and the reasoning behind it:
 *
 *   NEVER cache, never replay from cache:
 *     /api/*            money. A stale or replayed payment response is worse
 *                       than a network error, so these bypass the SW entirely.
 *     Supabase REST/auth/websocket   same reason.
 *     any request with an Authorization header
 *     any non-GET request
 *
 *   Cache-first:  hashed build assets (/assets/*), icons, art. These are
 *                 content-addressed, so a stale hit is impossible.
 *   Network-first with cache fallback: the HTML shell, so a new deploy is
 *                 picked up immediately but the app still opens offline.
 *
 * A service worker sits in front of every request the app makes, so the rule is
 * simple: if it can move money, it does not go through the cache.
 */

// Bump this whenever anything in SHELL or public/icons changes. The shell and
// the icons are cache-first, so without a bump an installed PWA keeps serving
// the old file forever. v2 = the die replaced the old logo tile.
// v3 = the worker now announces itself (see below). That announcement is the
// only way an already-installed app learns a new build exists, and it was
// missing: `pwa.ts` listened for an UPDATED message that nothing ever sent, so
// the "Update available — Reload now" sheet could never appear and a device
// with a cached shell stayed on its old build indefinitely.
// v4 = art stops being cache-first. See the note on isImmutable below: it is
// the reason a repainted character kept showing the old portrait.
const VERSION = 'v4'
const SHELL_CACHE = `floatbet-shell-${VERSION}`
const ASSET_CACHE = `floatbet-assets-${VERSION}`

const SHELL = [
  '/', '/index.html', '/manifest.webmanifest', '/favicon.svg',
  // The launcher / tab icons. Cached so an installed app still has its own
  // icon offline; listed here so a VERSION bump refreshes them too.
  '/icons/icon-192.png', '/icons/icon-512.png',
  '/icons/maskable-192.png', '/icons/maskable-512.png',
  '/icons/apple-touch-icon-180.png',
]

// Anything matching these is treated as live data and never cached.
const NEVER_CACHE = [
  /\/api\//,
  /supabase\.co/,
  /\/auth\/v1\//,
  /\/rest\/v1\//,
  /\/realtime\/v1\//,
  /\/storage\/v1\//,
]

/**
 * Is this URL content-addressed?
 *
 * Only Vite's build output is. `/assets/index-COYT_uqb.js` cannot change without
 * its name changing, so a cached copy can never be stale.
 *
 * Art is NOT content-addressed. `/art/bluemountain/jkaz.webp` keeps its name
 * when the portrait is redrawn, and the previous rule — "any .webp is an
 * asset, therefore cache-first" — pinned every returning player to the old
 * portrait forever, with no version bump able to reach them. That is why a
 * repainted character showed no change at all.
 *
 * So the test is the directory, not the extension.
 */
const isImmutable = (url) =>
  url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')

// Art, fonts and anything else unhashed: network-first, cache as an offline
// fallback. One conditional request per file on launch is cheap next to showing
// players stale artwork.
const isMedia = (url) => /\.(?:js|css|woff2?|ttf|png|jpe?g|webp|avif|svg|ico)$/i.test(url.pathname)

/**
 * A new worker is installed. If an older one is already controlling pages, this
 * is an update and those pages need to be told — they are running old code and
 * have no other way to find out.
 */
self.addEventListener('install', (event) => {
  const firstInstall = !self.registration.active

  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // A missing entry must not abort the install; the shell is a nicety.
      .then((cache) => Promise.allSettled(SHELL.map((p) => cache.add(p))))
      .then(() => self.skipWaiting())
      .then(() => {
        if (firstInstall) return
        return self.clients
          .matchAll({ type: 'window', includeUncontrolled: true })
          .then((clients) => clients.forEach((c) => c.postMessage({ type: 'UPDATED' })))
      }),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('floatbet-') && k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim())
      // The new worker owns the page now. Tell it, so a page that loaded old
      // code offers a reload instead of running a mix of old and new files.
      .then(() =>
        self.clients
          .matchAll({ type: 'window', includeUncontrolled: true })
          .then((clients) => clients.forEach((c) => c.postMessage({ type: 'UPDATED' }))),
      ),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only GET is ever cacheable.
  if (request.method !== 'GET') return

  // Never touch a request that carries a credential.
  if (request.headers.has('Authorization')) return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }

  // Money and auth: hand straight to the network, never cached, never replayed.
  if (NEVER_CACHE.some((re) => re.test(url.href))) return

  // Cross-origin (fonts, CDN): let the browser deal with it.
  if (url.origin !== self.location.origin) return

  // Content-addressed build output: cache-first, never revalidated.
  if (isImmutable(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(ASSET_CACHE).then((c) => c.put(request, copy))
            }
            return res
          }),
      ),
    )
    return
  }

  // Unhashed media (art, fonts): network-first, so a redrawn portrait appears
  // on the next launch, with the cached copy for offline.
  if (isMedia(url)) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(ASSET_CACHE).then((c) => c.put(request, copy))
          }
          return res
        })
        .catch(async () => {
          const cached = await caches.match(request)
          return cached || Response.error()
        }),
    )
    return
  }

  // Navigation / shell: network-first so a deploy lands immediately, with the
  // cached shell as the offline fallback.
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(SHELL_CACHE).then((c) => c.put('/index.html', copy))
          }
          return res
        })
        .catch(async () => {
          const cached = await caches.match('/index.html')
          if (cached) return cached
          return new Response(
            '<!doctype html><meta name="viewport" content="width=device-width"><body style="background:#08090f;color:#e6e8ef;font-family:system-ui;padding:2rem;text-align:center"><h1 style="font-size:1.1rem">You are offline</h1><p style="color:#8b90a0;font-size:.85rem">FloatBet needs a connection to load. Payments are never made offline.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          )
        }),
    )
  }
})

// Let the page ask a waiting worker to take over immediately after an update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})
