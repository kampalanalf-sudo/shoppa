// smoke/groqcheck.ts — assert the real askModel request shape against a stub.
import { askModel } from '../supabase/functions/_shared/support'

;(globalThis as any).Deno = {
  env: { get: (k: string) => (k === 'GROQ_API_KEY' ? 'gsk_test_key' : undefined) },
}

// Point the function at the local stub by rewriting the one URL it uses.
const realFetch = globalThis.fetch
globalThis.fetch = ((url: any, init: any) => {
  const u = String(url).replace('https://api.groq.com', 'http://127.0.0.1:8111')
  return realFetch(u, init)
}) as any

const agent = {
  id: 'wallet',
  display_name: 'Odong',
  role: 'Wallet & payments',
  scope: 'Balances, top-ups.',
  persona: 'You explain money.',
}

const fails: string[] = []
const ok = (n: string, c: boolean, extra = '') => {
  if (!c) fails.push(n)
  console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${extra}`)
}

const reply = await askModel({
  agent,
  facts: [{ id: 1, topic: 'money', question: 'What is 1 PX?', answer: '100 PX = 1 UGX.' }],
  grounding: { known: true, wallet: { balance_px: 125000, balance_ugx: 1250 } },
  history: [],
  question: 'what is my balance?',
})

// If the stub had rejected the request shape, askModel would have thrown.
ok('the request Groq actually receives is well-formed', reply.body.includes('125,000'))
ok('the HANDOFF line never reaches the player', !/HANDOFF/.test(reply.body))
ok('the handoff is recorded separately', reply.handoff && /reference/i.test(reply.handoff_reason ?? ''))
ok('cited facts are captured', reply.used_facts.includes(1))
ok('usage is read from Groq field names', reply.prompt_tokens === 812 && reply.output_tokens === 44)

// ------------------------------------------------ the free tier running out --

// A spent daily allowance comes back as 429. It must be distinguishable from a
// bad key and from a network fault, because the operator response to each is
// different: wait, replace, or investigate.
const realFetch2 = globalThis.fetch
globalThis.fetch = ((url: any, init: any) => {
  const u = String(url).replace('https://api.groq.com', 'http://127.0.0.1:8112')
  return realFetch2(u, init)
}) as any

let quota: any = null
try {
  await askModel({ agent, facts: [], grounding: {}, history: [], question: 'hi' })
} catch (e) {
  quota = e
}
ok('a spent free tier is reported as SUPPORT_QUOTA', quota?.code === 'SUPPORT_QUOTA')
ok('and it is a 429, not a server error', quota?.httpStatus === 429)

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall groq checks passed')
process.exit(fails.length ? 1 : 0)
