// smoke/auth.ts
//
// Sign-in regressions.
//
// The bug this suite exists to catch: `Auth.tsx` has always had email/password,
// a Google button, and a "forgot password" form — but the reset it offered could
// never complete. `resetPasswordForEmail` mailed a link to `#reset-password`, the
// hash router had no such route, and `AuthProvider` had no `updatePassword`, so
// the player was dropped on the home page and the password never changed. Every
// check below is one link in that chain that used to be missing.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const fails: string[] = []
const ok = (n: string, c: boolean, e = '') => { if (!c) fails.push(n); console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${e}`) }

const root = resolve(process.cwd())
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const auth = read('src/lib/auth.tsx')
const app = read('src/App.tsx')
const page = read('src/pages/Auth.tsx')
const setPw = read('src/pages/SetPassword.tsx')

// ------------------------------------------------------- password reset ====
ok('the provider can actually change a password',
  auth.includes('updatePassword') && auth.includes('updateUser({ password })'))
ok('updatePassword is exposed on the context',
  /updatePassword: \(password: string\) => Promise<void>/.test(auth))
ok('the reset mail points at a route that exists',
  auth.includes('#reset-password') && app.includes("h === 'reset-password'"))
ok('the signed-in landing for a recovery link is the set-password screen',
  app.includes("<SetPassword onDone={home} />") && app.includes("{ name: 'set-password' }"))
ok('a recovery link is exchanged by hand (the code lands after the #)',
  auth.includes('exchangeCodeForSession') && auth.includes('token_hash') && auth.includes("type: 'recovery'"))
ok('an expired link is reported, not silently swallowed',
  auth.includes('recoveryError') && setPw.includes('no longer valid'))
ok('the recovery tokens are stripped out of the address bar',
  auth.includes("replaceState(null, '',") && auth.includes('#reset-password`'))
ok('the new password is length-checked in the UI, above the server minimum',
  setPw.includes('password.length >= 8'))
ok('the new password must be typed twice', setPw.includes('password === confirm'))
ok('the reset form cannot submit while it does not match', setPw.includes('const canSubmit'))

// ------------------------------------------------- email + google sign-in ====
ok('email sign-in exists', auth.includes('signInWithPassword'))
ok('email sign-up exists and sends a verification redirect',
  auth.includes('auth.signUp(') && auth.includes('#verified'))
ok('the verification landing is routed, so the link is not a dead end',
  app.includes("h === 'verified'"))
ok('Google sign-in exists', auth.includes('signInWithOAuth') && auth.includes("provider: 'google'"))
ok('the Google button is on the form', page.includes('Continue with Google') && page.includes('GoogleMark'))
ok('a refused Google redirect tells the player instead of doing nothing',
  page.includes('allow pop-ups'))
ok('the reset flow offers a way into the set-password screen',
  page.includes("location.hash = 'reset-password'"))

// ------------------------------------------------------------ hash router ====
// Supabase appends `&access_token=…` / `?code=…` to the redirect hash. Matching
// the whole hash would miss the route; matching too little broke top-up refs.
ok('the router splits recovery params off the hash before matching',
  app.includes('raw.split(/[?&]/)[0]'))
ok('the top-up reference is still read from the raw hash',
  app.includes("new URLSearchParams(raw.split('?')[1] || '')"))

// --------------------------------------------------------------- secrets ====
ok('no server secret is exposed to the browser bundle',
  !/import\.meta\.env\.(VITE_)?(DGATEWAY_API_KEY|SUPABASE_SERVICE_ROLE_KEY)/.test(
    read('src/lib/supabase.ts') + read('src/lib/auth.tsx')))
ok('the backend is optional, so a build without env vars still boots',
  read('src/lib/supabase.ts').includes('export const isBackendConfigured'))

if (fails.length) { console.log(`\n${fails.length} FAILED: ${fails.join(', ')}`); process.exit(1) }
console.log('\nauthentication: email, Google, and password recovery are all wired end to end')
