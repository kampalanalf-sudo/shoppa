// scripts/build-edge-functions.mjs
//
// Flattens each supabase/functions/<name>/index.ts plus its ../_shared imports
// into one file under supabase/.dist/, which is what gets uploaded.
//
// WHY THIS EXISTS
//
// A deployed Supabase Edge Function is a single module. The Management API takes
// one `body` string, and the CLI does not follow relative imports either, so
// `import { x } from '../_shared/zengapay.ts'` cannot resolve once uploaded.
//
// Copying the shared clients into every function by hand is how two webhook
// handlers drift apart until one of them stops verifying signatures. So the
// shared modules stay single-source, and this script emits them in dependency
// order, exactly once each:
//
//   _shared/http.ts      leaf — CORS, json, preflight, readEnv
//   _shared/zengapay.ts  imports http.ts (not yet, but allowed)
//   _shared/oddsfeed.ts  leaf
//
// The output is generated and git-ignored. Never edit it.
//
//   node scripts/build-edge-functions.mjs          # write supabase/.dist
//   node scripts/build-edge-functions.mjs --check  # verify every import resolves
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname, normalize } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
/*
 * The slot maths lives in src/lib and is shared by the browser and the server.
 * It used to be browser-only, which is why six games could not be settled for
 * money. Rather than fork the rules — a fork is a second paytable that drifts —
 * _shared/slots.ts imports them and this bundler splices them in.
 *
 * These modules are pure: no DOM, no React, no import.meta.env (artwork goes
 * through assetBase, which this resolves to '/').
 */
const SRC_LIB_RE = /^import\s+(?:type\s+)?\{[^}]*\}\s*from\s*'\.\.\/\.\.\/\.\.\/src\/lib\/([\w./-]+)\.ts'[ \t]*$/gm
const FN_DIR = join(ROOT, 'supabase/functions')
const SHARED = join(FN_DIR, '_shared')
const OUT = join(ROOT, 'supabase/.dist')

const SHARED_IMPORT_RE = /^import\s*\{[^}]*\}\s*from\s*'\.\.\/_shared\/([\w.-]+)'[ \t]*$/gm
const RELATIVE_IMPORT_RE = /^import\s*\{[^}]*\}\s*from\s*'\.\/([\w.-]+)'[ \t]*$/gm

/** Bare the source: `export function f` -> `function f` so it can be inlined. */
const unbare = (src) =>
  // Keep a single space: the keyword and the name must not fuse into
  // `functionjson`. A newline here would be harmless, but a space is simpler.
  src.replace(/^export\s+(async\s+function|function|const|class|let|type|interface)\s/gm, '$1 ')

const exportsOf = (src) =>
  new Set(
    [...src.matchAll(/^export\s+(?:type\s+|interface\s+|async\s+)?(?:function|const|class|let|type|interface)\s+(\w+)/gm)]
      .map((m) => m[1]),
  )

/** Read a shared module and everything it imports, deepest first. */
function loadShared(file, seen = new Map(), stack = []) {
  if (seen.has(file)) return seen
  if (stack.includes(file)) throw new Error(`circular import: ${[...stack, file].join(' -> ')}`)

  const path = join(SHARED, file)
  if (!existsSync(path)) throw new Error(`missing shared module _shared/${file}`)
  const raw = readFileSync(path, 'utf8')

  for (const m of raw.matchAll(RELATIVE_IMPORT_RE)) {
    loadShared(m[1], seen, [...stack, file])
  }

  // Drop the intra-shared imports: their contents are spliced in below.
  const body = unbare(
    raw
      .replace(RELATIVE_IMPORT_RE, '')
      // A src/lib import becomes a binding from that module's namespace object,
      // which is created later on. `{ a, b as c }` -> `const { a, b: c } = ns`.
      .replace(
        /^import\s+\{([^}]*)\}\s*from\s*'\.\.\/\.\.\/\.\.\/src\/lib\/([\w./-]+)\.ts'[ \t]*$/gm,
        (_m, names, mod) => {
          const bind = names
            .split(',')
            .map((n) => n.trim())
            .filter(Boolean)
            .map((n) => n.replace(/\s+as\s+/, ': '))
            .join(', ')
          return `const { ${bind} } = src_${mod.replace(/[^a-zA-Z0-9]/g, '_')};`
        },
      )
      .replace(/^import\s+type\s+\{[^}]*\}\s*from\s*'\.\.\/\.\.\/\.\.\/src\/lib\/[\w./-]+\.ts'[ \t]*$/gm, '')
      .replace(/^export\s+type\s+\{[^}]*\}\s*from\s*'\.\.\/\.\.\/\.\.\/src\/lib\/[\w./-]+\.ts'[ \t]*$/gm, '')
      // A type-only import of a sibling shared module is erased by the compiler
      // anyway, but it still looks like an unresolved relative import to the
      // check below, so drop it explicitly.
      .replace(/^import\s+type\s+\{[^}]*\}\s*from\s*'\.\/[\w.-]+'[ \t]*$/gm, '')
      .replace(/\n{3,}/g, '\n\n'),
  )
  const srcLib = [...raw.matchAll(SRC_LIB_RE)].map((m) => m[1])
  seen.set(file, { body, exports: exportsOf(raw), srcLib })
  return seen
}

/** Read one src/lib module (pure maths only) and its own src/lib imports. */
function loadSrcLib(file, seen = new Map(), stack = []) {
  const key = `src:${file}`
  if (seen.has(key)) return seen
  if (stack.includes(file)) throw new Error(`circular import: ${[...stack, file].join(' -> ')}`)

  const path = join(ROOT, 'src/lib', `${file}.ts`)
  if (!existsSync(path)) throw new Error(`missing src/lib/${file}.ts`)
  const raw = readFileSync(path, 'utf8')

  /*
   * Only imports that stay inside src/lib are followed. Anything else — React,
   * the store, a Vite helper — means the module is not pure, and this build must
   * fail rather than ship a browser dependency into the edge runtime.
   *
   * Both `./x` and `../x` are followed: the slot games live in src/lib/slots and
   * their artwork base lives one level up.
   */
  const rel = /^import\s+(?:type\s+)?\{[^}]*\}\s*from\s*'(\.{1,2}\/[\w./-]+)'[ \t]*$/gm
  for (const m of raw.matchAll(rel)) {
    const target = normalize(join(dirname(file), m[1].replace(/\.ts$/, '')))
    loadSrcLib(target, seen, [...stack, file])
  }

  const body = unbare(
    raw
      .replace(rel, '')
      // The edge never renders artwork; the art path is a display string only.
      // Substituting it here avoids shipping `import.meta.env` into Deno for a
      // value nothing on the server reads.
      .replace(/\$\{ASSET_BASE\}/g, '/')
      .replace(/\n{3,}/g, '\n\n'),
  )
  seen.set(key, { body, exports: exportsOf(raw) })
  return seen
}

/** Build one self-contained source file for a function directory. */
function bundle(name) {
  const entry = join(FN_DIR, name, 'index.ts')
  if (!existsSync(entry)) return null

  const source = readFileSync(entry, 'utf8')
  const requested = []
  for (const m of source.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'\.\.\/_shared\/([\w.-]+)'/gm)) {
    for (const spec of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      // `readEnv as env` asks for `readEnv`; `type FeedEvent` for `FeedEvent`.
      requested.push({ name: spec.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim(), from: m[2] })
    }
  }

  const modules = new Map()
  for (const r of requested) loadShared(r.from, modules)

  /*
   * A shared module may import the shared slot maths. Follow those from the
   * module's RAW source: the body has already had its imports stripped, so
   * scanning the body finds nothing and the bundle ships undefined names.
   */
  for (const [, mod] of [...modules]) {
    for (const file of mod.srcLib ?? []) loadSrcLib(file, modules)
  }

  // Fail loudly rather than shipping a bundle with an undefined reference.
  for (const r of requested) {
    const mod = modules.get(r.from)
    if (!mod) throw new Error(`${name}: could not load _shared/${r.from}`)
    if (!mod.exports.has(r.name)) {
      throw new Error(`${name}: _shared/${r.from} has no export '${r.name}'`)
    }
  }

  const parts = [
    `// GENERATED by scripts/build-edge-functions.mjs — do not edit.`,
    `// Source: supabase/functions/${name}/index.ts + _shared/[${[...modules.keys()].join(', ')}]`,
    '',
  ]
  /*
   * The src/lib modules cannot be flattened into the same scope: slot.ts and
   * slots/engine.ts both declare `symbolFromFloat` (and buildGrid, resolve,
   * countSymbol) with different signatures. In one file that is a duplicate
   * declaration; the deploy then answers BOOT_ERROR and nothing works.
   *
   * So each one becomes its own closure that returns only the names the shared
   * module asked for. The rules stay single-source — same code, same numbers —
   * and the scopes cannot collide.
   */
  const srcParts = []
  // The names the shared bodies actually reference. Testing `source` (the entry
  // file) finds nothing: the entry never names them directly, the shared module
  // does — and with nothing emitted the bundle is full of undefined references.
  const sharedText = [...modules]
    .filter(([k]) => !k.startsWith('src:'))
    .map(([, m]) => m.body)
    .join('\n')
  for (const [key, mod] of modules) {
    if (!key.startsWith('src:')) continue
    /*
     * Only VALUE exports, and only ones there is room for.
     *
     * `exportsOf` also picks up `type`/`interface` names. Destructuring one is a
     * syntax error in the emitted JS ("Identifier 'SlotConfig' has already been
     * declared"), and two entries can share a name because `buildGrid` exists in
     * both slot.ts and slots/engine.ts. Both are handled here.
     */
    const valueExports = [...(mod.exports ?? [])].filter((n) => {
      const decl = new RegExp(`^(?:export\\s+)?(?:type|interface)\\s+${n}\\b`, 'm')
      return !decl.test(mod.body)
    })
    const wanted = [...new Set(valueExports)].filter((n) => new RegExp(`\\b${n}\\b`).test(sharedText))
    if (!wanted.length) continue
    /*
     * Namespaced on purpose. Two modules can export the same name — slot.ts and
     * slots/engine.ts both export `buildGrid`, `resolve` and `symbolFromFloat` —
     * so top-level destructuring collides even though the closures do not.
     * Each module gets its own object, and the shared module binds from it.
     */
    srcParts.push(
      `// ======== begin ${key} ========`,
      `const ${key.replace(/[^a-zA-Z0-9]/g, '_')} = (() => {`,
      mod.body.trimEnd(),
      `return { ${wanted.join(', ')} }`,
      `})()`,
      `// ======== end ${key} ========`,
      '',
    )
  }

  // The src/lib namespaces first: the shared modules bind from those objects at
  // module top level, so emitting them anywhere later is a temporal dead zone.
  parts.push(...srcParts)

  for (const [file, mod] of modules) {
    // src/lib modules are emitted as closures further down; printing them here
    // as well is what produced the duplicate declarations.
    if (file.startsWith('src:')) continue
    parts.push(
      `// ======== begin _shared/${file} ========`,
      mod.body.trimEnd(),
      `// ======== end _shared/${file} ========`,
      '',
    )
  }
  parts.push(source.replace(SHARED_IMPORT_RE, '').trimStart())
  return parts.join('\n')
}

const check = process.argv.includes('--check')
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const names = readdirSync(FN_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== '_shared')
  .map((d) => d.name)
  .sort()

let count = 0
for (const name of names) {
  const out = bundle(name)
  if (!out) {
    console.warn(`skip ${name}: no index.ts`)
    continue
  }
  if (/from\s*'\.\.?\//.test(out.replace(/^\/\/.*$/gm, ''))) {
    throw new Error(`${name}: unresolved relative import after flattening`)
  }

  /*
   * Two spliced modules that both declare `r2` produce a bundle that parses as
   * valid text and throws `Identifier 'r2' has already been declared` on the
   * edge, where the function then answers BOOT_ERROR and nothing works. Catch it
   * here, where the message can name the file and the symbol.
   */
  /*
   * Only TOP-LEVEL declarations can collide. Anything inside a `begin src:` /
   * `end src:` block is wrapped in its own closure, so its names are private —
   * counting them made this check reject a bundle that parses perfectly.
   */
  const scoped = []
  {
    let depth = 0
    for (const line of out.split('\n')) {
      if (line.startsWith('// ======== begin src:')) depth++
      else if (line.startsWith('// ======== end src:')) depth = Math.max(0, depth - 1)
      scoped.push(depth > 0)
    }
  }
  let offset = 0
  const lineStarts = out.split('\n').map((l) => {
    const at = offset
    offset += l.length + 1
    return at
  })
  const declared = new Map()
  for (const m of out.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)) {
    const sym = m[1]
    const line = out.slice(0, m.index).split('\n').length
    if (scoped[line - 1]) continue
    void lineStarts
    if (declared.has(sym)) {
      throw new Error(
        `${name}: '${sym}' is declared twice (lines ${declared.get(sym)} and ${line}) — ` +
          `rename one of them; the bundle will not parse`,
      )
    }
    declared.set(sym, line)
  }
  writeFileSync(join(OUT, `${name}.ts`), out)
  count++
  console.log(`${name.padEnd(24)} ${String(out.length).padStart(7)} bytes`)
}

console.log(`\n${count} bundle(s) written to supabase/.dist/`)
if (check) console.log('--check: every shared import resolved to a real export')
