// scripts/slot-value-check.mjs
//
// The server's slot payout must equal the board's, for every game, every spin.
//
// WHY THIS IS THE IMPORTANT ONE
//
// The six video slots used to be browser-settled, so they could not be played
// for money. Moving them to the server has one way to go badly wrong: the edge
// bundle gets its paytables from supabase/functions/_shared/slot-configs.ts,
// which is GENERATED from src/lib/slots/games*.ts. If generation is ever stale,
// or a pay table is edited on one side only, the reels show one number and the
// wallet receives another — the bug the wheel shipped with on its first pass.
//
// So this loads the emitted edge bundle AND the real browser modules, runs the
// same floats through both, and requires identical multipliers.
//
//   node scripts/slot-value-check.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import ts from '/home/user/shoppa/node_modules/typescript/lib/typescript.js'

const transpile = (src) => ts.transpileModule(src, { compilerOptions: { target: 99, module: 99 } }).outputText

// --- server side: the emitted edge bundle ---
let js = transpile(readFileSync('supabase/.dist/play.ts', 'utf8'))
  .replace('Deno.serve(', 'void ((x) => x)(')
  + '\nexport { resolveSlotSpin, slotFloats }\n'
writeFileSync('/tmp/P.mjs', js)
globalThis.Deno = { env: { get: () => '' }, serve: () => {} }
const server = await import('/tmp/P.mjs')

// --- browser side: the modules the board actually renders from ---
async function loadBrowser(file, names) {
  let src = readFileSync(file, 'utf8').split('\n').filter((l) => !l.startsWith('import ')).join('\n')
  src = src.replace(/\$\{ASSET_BASE\}/g, '/').replace(/^export /gm, '')
  src += `\nexport { ${names.join(', ')} };\n`
  const f = `/tmp/B${Math.random().toString(36).slice(2)}.mjs`
  writeFileSync(f, transpile(src))
  return import(f)
}
const g1 = await loadBrowser('src/lib/slots/games.ts', ['CHAPE', 'BLUE_MOUNTAIN'])
const g2 = await loadBrowser('src/lib/slots/games2.ts', ['BAZAAR', 'BODA'])
const eng = await loadBrowser('src/lib/slots/engine.ts', ['buildGrid', 'resolve'])
const cr = await loadBrowser('src/lib/slots/craters.ts', ['CRATERS', 'resolveCraters'])
const bon = await loadBrowser('src/lib/slot.ts', ['buildGrid', 'resolve'])

const floats = (n, seed) => Array.from({ length: n }, (_, i) => (((i * 37 + 11) * (seed + 1)) % 997) / 997)
let worst = 0, checked = 0, mismatches = []

const mapped = { chape: g1.CHAPE, bluemountain: g1.BLUE_MOUNTAIN, bazaar: g2.BAZAAR, boda: g2.BODA }

for (const id of ['bonni', 'craters', 'chape', 'bluemountain', 'bazaar', 'boda']) {
  for (let s = 0; s < 120; s++) {
    const n = server.slotFloats(id)
    const fs = floats(n, s)
    const got = server.resolveSlotSpin(id, fs, {})

    // Browser equivalent, computed independently.
    let want
    if (id === 'bonni') want = Math.round(Math.min(5000, bon.resolve(bon.buildGrid(fs.slice(0, 15))).totalMultiplier) * 100) / 100
    else if (id === 'craters') want = Math.round(Math.min(cr.CRATERS.maxWin, cr.resolveCraters(cr.CRATERS, eng.buildGrid(cr.CRATERS, fs), {}).total) * 100) / 100
    else {
      const cfg = mapped[id]
      want = Math.round(Math.min(cfg.maxWin, eng.resolve(cfg, eng.buildGrid(cfg, fs)).totalMultiplier) * 100) / 100
    }

    checked++
    if (Math.abs(got.multiplier - want) > 1e-9) {
      worst = Math.max(worst, Math.abs(got.multiplier - want))
      if (mismatches.length < 5) mismatches.push(`${id} seed${s}: server ${got.multiplier} vs board ${want}`)
    }
  }
}

console.log(`compared ${checked} spins across 6 games`)
console.log(`mismatches: ${mismatches.length ? mismatches.length : 0}`)
for (const m of mismatches) console.log('  ', m)
if (mismatches.length) process.exit(1)
console.log('server and board agree on every multiplier')
