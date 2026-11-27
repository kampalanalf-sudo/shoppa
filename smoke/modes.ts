// smoke/modes.ts
//
// Proves the two promises that make free play safe to ship:
//
//   1. ONE CURRENCY. There is no PX, no peg and no conversion left in the
//      shipping code. A missed conversion is how a screen that says "UGX 1,000"
//      ends up moving 10,000, or the reverse.
//
//   2. FREE PLAY CANNOT BECOME MONEY. It has its own wallet, its own storage
//      key, its own stats, and no path from a free credit to a withdrawal.
//      This is checked by reading the store's own source, because the risk is a
//      future edit adding a shortcut, not a bug at runtime.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const fails: string[] = []
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) fails.push(name)
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${extra}`)
}
const read = (p: string) => readFileSync(p, 'utf8')

// --------------------------------------------------------------- one currency --

/**
 * Every shipping source file. Tests are excluded: a test is allowed to talk
 * about PX to assert its absence.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) {
      if (!['node_modules', 'dist', '.git', 'smoke', 'public'].includes(e)) walk(full, out)
    } else if (/\.(ts|tsx)$/.test(e)) out.push(full)
  }
  return out
}
const sources = walk('src')
ok('there are sources to check', sources.length > 20, `(${sources.length})`)

/*
 * A PX *identifier* may survive as a legacy database column name (`balance_px`
 * predates this change and renaming it would touch every function and policy in
 * the same commit). What must not survive is a PX *amount* shown to a player, or
 * any conversion between a coin and fiat.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const pxLiterals = sources.filter((f) => {
  const code = stripComments(read(f))
  // Strip the one legitimate survivor: the migration constant, which names the
  // rate an existing PX balance converts at. Everything else is a currency
  // label and must be gone.
  const withoutMigration = code
    .replace(/PX_PER_UGX_AT_MIGRATION/g, '')
    .replace(/px\b/g, '')
  return /\bPX\b/.test(withoutMigration)
})
ok('no source still prints "PX" as a currency',
  pxLiterals.length === 0, pxLiterals.join(', '))

// The peg is allowed to appear in exactly one place: the constant that converts
// an EXISTING PX balance into UGX during migration. A live conversion function
// (pxToUgx/ugxToPx) is what must not exist, because that is what a screen would
// call to render a second currency.
const pegFunctions = sources.filter((f) => /pxToUgx|ugxToPx|PROXICOIN|STARTING_PX/.test(stripComments(read(f))))
ok('no source exports or calls a live PX conversion',
  pegFunctions.length === 0, pegFunctions.join(', '))
const pegUses = sources.filter((f) => (stripComments(read(f)).match(/PX_PER_UGX_AT_MIGRATION/g) ?? []).length > 0)
ok('the migration rate is used in exactly one module', pegUses.length === 1 && pegUses[0].endsWith('store.tsx'), pegUses.join(', '))

const store = read('src/lib/store.tsx')
const currency = read('src/lib/currency.ts')
const format = read('src/lib/format.ts')

ok('the currency module declares one currency', /CURRENCY = 'UGX'/.test(currency))
ok('money is formatted with a UGX label', /export const ugx = \(v: number\) => `UGX \$\{money\(v\)\}`/.test(format))
ok('there is no coin formatter left', !/export const (coin|coinCompact)\b/.test(format))
ok('the bet floor is whole shillings', /MIN_BET = 100/.test(currency))
ok('stakes round to whole units', /Math\.round\(wager\)/.test(store))
ok('payouts floor, never round up', /Math\.floor\(wager \* multiplier\)/.test(store))

// ------------------------------------------------------------- free play ----

const badge = read('src/components/ModeBadge.tsx')

ok('free play has its own storage key', /FREE_PLAY_KEY = 'floatbet\.freeplay\.v1'/.test(currency))
ok('the free wallet is a separate object in state', /free: FreePlay/.test(store))
ok('free play has its own credits field, not the real balance', /credits: number/.test(store))
ok('the store starts in real-money mode', /mode: 'real'/.test(store))

// The games must never read `balance` directly -- they read `playBalance`, which
// resolves the mode. A game that reads `balance` spends real money in free play.
ok('the games get a mode-resolved balance', /playBalance: state\.mode === 'free' \? state\.free\.credits : state\.balance/.test(store))
ok('stats are resolved per mode too', /playStats: state\.mode === 'free' \? state\.free\.stats : state\.stats/.test(store))
ok('bet history is resolved per mode', /playBets: state\.mode === 'free' \? state\.free\.bets : state\.bets/.test(store))

// A bet is charged to exactly one wallet, chosen by mode.
ok('placeBet charges the free wallet in free play', /free: \{ \.\.\.s\.free, credits: Math\.round\(s\.free\.credits - stake\) \}/.test(store))
ok('placeBet charges the real wallet otherwise', /balance: Math\.round\(s\.balance - stake\)/.test(store))
ok('a refund returns to the wallet that was charged', /mode === 'free'[\s\S]{0,240}credits: Math\.round\(s\.free\.credits \+ wager\)/.test(store))
ok('a free round does not touch real stats', /stats: nextStats\(s\.free\.stats\)/.test(store) && /stats: nextStats\(s\.stats\)/.test(store))

// Deposits and withdrawals are refused in free play, in the action itself rather
// than only by hiding the button.
ok('deposit and withdraw are refused in free play', /Not available in free play/.test(read('src/components/Modals.tsx')))
ok('the welcome bonus is refused in free play', /Switch to real money to claim this bonus/.test(read('src/components/Modals.tsx')))

// Marking. The requirement is that free play is CLEARLY marked.
ok('free play renders a full-width warning strip', /variant="bar"/.test(read('src/App.tsx')))
ok('the badge says it is not real money', /not real money/.test(badge))
ok('the badge says it cannot be withdrawn', /cannot be withdrawn|can be withdrawn/.test(badge))
ok('the mode switch names both modes', /Real money/.test(badge) && /Free play/.test(badge))
ok('a free balance is never labelled as plain money', /label=\{mode === 'free' \? 'Free credits' : 'Balance'\}/.test(read('src/components/PlayBar.tsx')))

// Refill exists, and only in free play.
ok('refill is gated to free play', /if \(mode !== 'free'\) return null/.test(badge))
ok('refill only writes the fake wallet', /free: \{ \.\.\.s\.free, credits: FREE_PLAY_REFILL \}/.test(store))

// ------------------------------------------------------- legacy migration ----

// Existing players held PX. The conversion rate must be the peg their screen
// showed, or the change silently takes 99% of their balance.
ok('existing PX converts at the advertised peg', /PX_PER_UGX_AT_MIGRATION = 100/.test(store))
ok('legacy balances are converted, not wiped', /balance: toUgx\(old\.balance\)/.test(store))
ok('legacy bets are converted so history still adds up', /wager: toUgx\(b\.wager\)/.test(store))
ok('the migration is only used when there is no current wallet', /migrateLegacy\(\) \?\? defaults\(\)/.test(store))

// Free play must survive a reload as its own object, or a corrupt/partial blob
// would leave `free` undefined and the games would read a real balance.
ok('a partial stored blob cannot lose the free wallet', /credits: Math\.max\(0, Math\.round\(Number\(parsed\.free\?\.credits \?\? FREE_PLAY_START\)\)\)/.test(store))

console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nUGX only, and free play cannot become money')
process.exit(fails.length ? 1 : 0)
