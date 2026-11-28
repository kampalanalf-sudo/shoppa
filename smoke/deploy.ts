import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

// deploy.ts -- guards the deploy topology.
//
// WHAT THIS USED TO DO, AND WHY IT CHANGED
//
// This suite counted Serverless Functions under `api/` and checked that every
// `vercel.json` rewrite landed on one of them. That mattered while the app was
// served by Vercel: the Hobby plan allows 12 functions, production had 16, and
// Vercel did not fail the build — it failed at `patchBuild` and production
// quietly kept serving the previous commit. CI was green every time.
//
// With the ZENGAPAY migration the `api/` tree is gone. It was a second, parallel
// copy of the payment and admin logic that the browser never called (the client
// resolves every path to a Supabase Edge Function in src/lib/backend.ts). Its
// only remaining effect was that it could drift from the code that actually
// runs — and it had: its webhook still signed the raw body, which is not how
// ZENGAPAY signs anything.
//
// So the invariants worth guarding are now different, and stricter:
//
//   1. No payment logic lives outside supabase/functions. One implementation.
//   2. Vercel hosts a static SPA only — no serverless functions to blow a budget.
//   3. Every function the deploy workflow uploads is a real directory.
//   4. No edge bundle imports a shared module that does not exist.
//
// Same convention as the other smoke suites: run from the repo root.
const root = resolve(process.cwd())
const fails: string[] = []
const ok = (n: string, c: boolean, e = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${e}`) }

// ------------------------------------------------ 1. one implementation ----

ok('the legacy api/ tree is gone', !existsSync(join(root, 'api')))

// Any .ts outside supabase/functions that references the provider is a second
// implementation waiting to drift. `src/` is allowed to mention it in comments,
// so this looks for an actual client call shape, not the word.
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) {
      // `.dist` is generated: scripts/build-edge-functions.mjs inlines the shared
      // modules into supabase/.dist/, so those files necessarily contain the
      // token name and are not source. Guarding them proves nothing.
      if (['node_modules', 'dist', '.dist', '.git', 'smoke'].includes(e)) continue
      walk(full, out)
    } else if (/\.(ts|tsx|mjs|js)$/.test(e)) out.push(full)
  }
  return out
}

const strayCallers = walk(root).filter((f) => {
  if (f.includes(`${join('supabase', 'functions')}`)) return false
  const src = readFileSync(f, 'utf8')
  return /Bearer\s+\$\{?\s*(?:secrets\.)?apiToken|ZENGAPAY_API_TOKEN\s*[,)]/.test(src) && !f.includes('smoke')
})
ok('nothing outside supabase/functions reads the API token',
  strayCallers.length === 0, strayCallers.map((f) => f.replace(root, '')).join(', '))

// ---------------------------------------------- 2. no serverless budget ----

const cfg = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))
ok('vercel.json still parses', Boolean(cfg))
ok('vercel.json declares no serverless functions',
  !cfg.functions || Object.keys(cfg.functions).length === 0)
ok('no rewrite points at /api', !(cfg.rewrites ?? []).some((r: any) => String(r.destination).startsWith('/api')))
// A static SPA needs its catch-all, or a deep link 404s at the hosting layer.
ok('a catch-all rewrite serves the SPA', (cfg.rewrites ?? []).some((r: any) => String(r.destination) === '/index.html'))

// ------------------------------------------ 3. functions are real dirs ----

const FN_DIR = join(root, 'supabase/functions')
const dirs = readdirSync(FN_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== '_shared')
  .map((d) => d.name)
ok('there are functions to deploy', dirs.length > 0, `(${dirs.length})`)

for (const required of ['pay', 'play', 'admin-ops', 'webhooks-zengapay', 'webhooks-zengapay-store']) {
  ok(`${required} is a real function directory`, dirs.includes(required))
}
ok('no dgateway function survives', !dirs.some((d) => /dgateway/i.test(d)))

// A function directory without index.ts is skipped by the bundler with only a
// warning, so the deploy goes green and the route 404s.
const missingEntry = dirs.filter((d) => !existsSync(join(FN_DIR, d, 'index.ts')))
ok('every function directory has an index.ts', missingEntry.length === 0, missingEntry.join(', '))

// --------------------------------------------- 4. shared modules resolve ----

const shared = readdirSync(join(FN_DIR, '_shared')).filter((f) => f.endsWith('.ts'))
ok('the zengapay module is present', shared.includes('zengapay.ts'))
ok('the dgateway module is gone', !shared.includes('dgateway.ts'))

// The bundler inlines each `../_shared/x` import into the function file. If one
// is missed, the uploaded function keeps a relative import that Deno cannot
// resolve: the deploy goes green and the route answers 500. The bundler throws
// on this itself, so this reads its own output rather than trusting it.
const DIST = join(root, 'supabase/.dist')
if (existsSync(DIST)) {
  const leftover = readdirSync(DIST)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => /from\s*'\.\.?\//.test(readFileSync(join(DIST, f), 'utf8').replace(/^\/\/.*$/gm, '')))
  ok('no bundle keeps a relative import after flattening', leftover.length === 0, leftover.join(', '))

  // The money paths must actually carry the shared client with them.
  const wh = readFileSync(join(DIST, 'webhooks-zengapay.ts'), 'utf8')
  ok('the webhook bundle contains the ZENGAPAY signature check', wh.includes('x-zengapay-signature'))
  ok('the webhook bundle contains the signed-string builder', /transactionReference\}\$\{String\(data\.msisdn\)/.test(wh) || wh.includes('webhookSignedPayload'))
} else {
  ok('supabase/.dist exists (run the bundler first)', false)
}

if (fails.length) { console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
console.log('\ndeploy: one implementation, no function budget, every edge function real')
