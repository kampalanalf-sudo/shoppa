import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

// deploy.ts -- guards the Vercel function budget.
//
// This is the check that was missing when the project died three deploys in a
// row. The Hobby plan allows 12 Serverless Functions per deployment; production
// had 16. Vercel does not fail the build -- the build succeeds, the deployment
// fails at `patchBuild`, and the live site quietly keeps serving the previous
// commit. CI was green every time.
//
// So: count the functions, and make sure every rewrite in vercel.json points at
// a router that actually exists.
// Same convention as the other smoke suites: run from the repo root.
const root = resolve(process.cwd())
const fails: string[] = []
const ok = (n: string, c: boolean, e = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${e}`) }

const HOBBY_LIMIT = 12

/** Every .ts under api/ except _lib/ is a deployed function. */
function functions(dir = join(root, 'api'), out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '_lib') continue
      functions(full, out)
    } else if (name.endsWith('.ts')) {
      out.push(full.slice(root.length + 1).split('\\').join('/'))
    }
  }
  return out
}

const fns = functions().sort()
console.log(`\nserverless functions: ${fns.length}\n${fns.map((f) => `  ${f}`).join('\n')}\n`)

ok(`under the Hobby limit of ${HOBBY_LIMIT}`, fns.length <= HOBBY_LIMIT, `(${fns.length})`)
// Warn while there is still room to think, rather than at the cliff edge.
ok('leaves headroom for one more endpoint', fns.length < HOBBY_LIMIT, `(${fns.length} of ${HOBBY_LIMIT})`)

const cfg = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))
const rewrites: { source: string; destination: string }[] = cfg.rewrites ?? []
ok('vercel.json still parses and declares rewrites', rewrites.length > 0)

// A rewrite whose destination is a deleted file is a 404 on a payment route.
const missing = rewrites.filter((r) => {
  const dest = r.destination.split('?')[0].replace(/^\//, '')
  return !fns.includes(`${dest}.ts`)
})
ok('every rewrite destination is a real function', missing.length === 0,
  missing.length ? `(${missing.map((m) => m.destination).join(', ')})` : '')

// A rewrite whose source is also a file is shadowed/dead weight -- and means an
// old endpoint survived a consolidation and is silently inflating the count.
const shadowed = rewrites.filter((r) => fns.includes(`${r.source.replace(/^\//, '')}.ts`))
ok('no rewrite is shadowed by a real file', shadowed.length === 0,
  shadowed.length ? `(${shadowed.map((m) => m.source).join(', ')})` : '')

// Both routers must actually dispatch the operations the rewrites assume.
const pay = readFileSync(join(root, 'api/pay.ts'), 'utf8')
for (const op of ['collect', 'disburse', 'status', 'claim']) {
  ok(`api/pay.ts dispatches ?op=${op}`, new RegExp(`op === '${op}'`).test(pay))
}
const ops = readFileSync(join(root, 'api/admin/ops.ts'), 'utf8')
for (const op of ['health', 'cashouts', 'audit', 'players', 'lookup', 'actions']) {
  ok(`api/admin/ops.ts dispatches ?op=${op}`, new RegExp(`op === '${op}'`).test(ops))
}

// The cron must point at a function that still exists, or settlement stops.
for (const cron of cfg.crons ?? []) {
  const dest = cron.path.replace(/^\//, '')
  ok(`cron ${cron.path} resolves to a function`, fns.includes(`${dest}.ts`))
}

if (fails.length) { console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
console.log('\ndeploy: inside the function budget, every rewrite lands on a live router')
