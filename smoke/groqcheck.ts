// smoke/groqcheck.ts — assert the real askModel request shape against a stub.
//
// The stub is in-process: `askModel` calls `fetch`, so replacing the global is
// enough and nothing has to be listening on a port. An earlier version pointed
// at 127.0.0.1:8111/8112 and only passed when a server happened to be running,
// which made the suite fail with SUPPORT_UNAVAILABLE for no real reason.
import { askModel, fallbackReply } from '../supabase/functions/_shared/support'

let key = 'gsk_test_key'
;(globalThis as any).Deno = {
  env: { get: (k: string) => (k === 'GROQ_API_KEY' ? key : undefined) },
}

const fails: string[] = []
const ok = (n: string, c: boolean, extra = '') => {
  if (!c) fails.push(n)
  console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${extra}`)
}

const agent = {
  id: 'wallet',
  display_name: 'Odong',
  role: 'Wallet & payments',
  scope: 'Balances, top-ups.',
  persona: 'You explain money.',
}

// ------------------------------------------------------------------ stubbing --

type Seen = { url: string; init: any; body: any }

/** Install a stub that records the request and answers with `reply`. */
function stubFetch(reply: (seen: Seen) => Response) {
  const realFetch = globalThis.fetch
  const seen: Seen[] = []
  globalThis.fetch = (async (url: any, init: any) => {
    const record = { url: String(url), init, body: init?.body ? JSON.parse(init.body) : null }
    seen.push(record)
    return reply(record)
  }) as any
  return { seen, restore: () => ((globalThis.fetch = realFetch), seen) }
}

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

// ------------------------------------------------ the happy path and its shape --

// A reply in the shape the HOUSE_RULES ask for: a figure, a citation, a handoff.
const goodReply = {
  choices: [
    {
      message: {
        content:
          'Your balance is 125,000 PX, which is 1,250 UGX. That is the balance after your top-up [1].\nHANDOFF: A human must confirm the top-up on the provider side.',
      },
    },
  ],
  usage: { prompt_tokens: 812, completion_tokens: 44 },
}

const first = stubFetch(() => json(200, goodReply))

const reply = await askModel({
  agent,
  facts: [{ id: 1, topic: 'money', question: 'What is 1 PX?', answer: '100 PX = 1 UGX.' }],
  grounding: { known: true, wallet: { balance_px: 125000, balance_ugx: 1250 } },
  history: [],
  question: 'what is my balance?',
})

first.restore()
const sent = first.seen[0]

// The endpoint is the part that has to be right for the key to work at all.
ok('the request goes to Groq, not Anthropic', sent?.url === 'https://api.groq.com/openai/v1/chat/completions', sent?.url)
ok('the key is sent as a bearer token', /^Bearer gsk_test_key$/.test(sent?.init?.headers?.Authorization))
// Not a preference: the Llama models were retired on 2026-08-16 and 404 now.
ok('the default model is one Groq still serves', sent?.body?.model === 'openai/gpt-oss-20b', sent?.body?.model)
// gpt-oss is a reasoning model. Unpinned and under-capped, it burns the whole
// budget thinking and returns an empty answer.
ok('reasoning effort is low, so little of the cap is spent thinking', sent?.body?.reasoning_effort === 'low', sent?.body?.reasoning_effort)
ok('the token cap leaves room for thinking plus the answer', sent?.body?.max_tokens === 800, sent?.body?.max_tokens)
ok('temperature is low but not zero', sent?.body?.temperature === 0.3)
ok(
  'house rules travel as a system message, not a top-level field',
  sent?.body?.messages?.[0]?.role === 'system' && /HANDOFF:/.test(sent?.body?.messages?.[0]?.content ?? ''),
)
ok('the player question is the user message', sent?.body?.messages?.[1]?.role === 'user')
ok('no Anthropic-only top-level system field', sent?.body && !('system' in sent.body))

// The snapshot is JSON, so the figure is raw; the comma-separated form is what
// the model writes back, checked below.
ok(
  'the account snapshot reaches the model',
  /"balance_px":\s*125000/.test(String(sent?.body?.messages?.[1]?.content)),
)
ok('the model formats the figure for the player', reply.body.includes('125,000'), reply.body)
ok('the HANDOFF line never reaches the player', !/HANDOFF/.test(reply.body), reply.body)
ok('the handoff is recorded separately', !!reply.handoff && /human/i.test(reply.handoff_reason ?? ''))
ok('cited facts are captured', reply.used_facts.includes(1))
ok('usage is read from Groq field names', reply.prompt_tokens === 812 && reply.output_tokens === 44)

// ------------------------------------------------------- a non-default model --

// The operator can raise the ceiling without a code change by pointing
// GROQ_MODEL at a model with more headroom.
;(globalThis as any).Deno.env.get = (k: string) =>
  k === 'GROQ_API_KEY' ? key : k === 'GROQ_MODEL' ? 'openai/gpt-oss-120b' : undefined

const second = stubFetch(() => json(200, goodReply))
await askModel({ agent, facts: [], grounding: {}, history: [], question: 'hi' })
second.restore()
ok('GROQ_MODEL overrides the default', second.seen[0]?.body?.model === 'openai/gpt-oss-120b', second.seen[0]?.body?.model)

// A non-reasoning model would reject reasoning_effort, so the field appears
// only for gpt-oss. This keeps the door open for GROQ_MODEL to name anything.
;(globalThis as any).Deno.env.get = (k: string) =>
  k === 'GROQ_API_KEY' ? key : k === 'GROQ_MODEL' ? 'qwen/qwen3.8-27b' : undefined
const third = stubFetch(() => json(200, goodReply))
await askModel({ agent, facts: [], grounding: {}, history: [], question: 'hi' })
third.restore()
ok('a non gpt-oss model gets no reasoning_effort field', third.seen[0]?.body && !('reasoning_effort' in third.seen[0].body))

;(globalThis as any).Deno.env.get = (k: string) => (k === 'GROQ_API_KEY' ? key : undefined)

// ------------------------------------------------ the free tier running out --

// A spent daily allowance comes back as 429. It must be distinguishable from a
// bad key and from a network fault, because the operator response to each is
// different: wait, replace, or investigate.
const quotaStub = stubFetch(() =>
  json(429, { error: { message: 'Rate limit reached for llama-3.1-8b-instant', type: 'rate_limit_error' } }),
)

let quota: any = null
try {
  await askModel({ agent, facts: [], grounding: {}, history: [], question: 'hi' })
} catch (e) {
  quota = e
}
quotaStub.restore()
ok('a spent free tier is reported as SUPPORT_QUOTA', quota?.code === 'SUPPORT_QUOTA')
ok('and it is a 429, not a server error', quota?.httpStatus === 429)

// --------------------------------------------------------- a rejected key, etc --

const authStub = stubFetch(() => json(401, { error: { message: 'Invalid API Key' } }))
let auth: any = null
try {
  await askModel({ agent, facts: [], grounding: {}, history: [], question: 'hi' })
} catch (e) {
  auth = e
}
authStub.restore()
ok('a rejected key is a configuration fault, not a quota one', auth?.code === 'SUPPORT_NOT_CONFIGURED', auth?.code)
ok('and it points the operator at the key to replace', /GROQ_API_KEY/.test(auth?.message ?? ''))

const netStub = stubFetch(() => {
  throw new TypeError('fetch failed')
})
let net: any = null
try {
  await askModel({ agent, facts: [], grounding: {}, history: [], question: 'hi' })
} catch (e) {
  net = e
}
netStub.restore()
ok('a network fault is not mistaken for a quota or a key fault', net?.code === 'SUPPORT_UNAVAILABLE', net?.code)

// A model Groq no longer serves answers 404. This is the failure that took all
// four agents down, and it must be distinguishable in the log.
const goneStub = stubFetch(() =>
  json(404, { error: { message: 'The model `openai/gpt-oss-20b` does not exist or you do not have access to it.' } }),
)
let gone: any = null
try {
  await askModel({ agent, facts: [], grounding: {}, history: [], question: 'hi' })
} catch (e) {
  gone = e
}
goneStub.restore()
ok('a retired model is reported as a provider error', gone?.code === 'SUPPORT_ERROR', gone?.code)
ok('and the provider text is kept, not replaced by a guess', /does not exist/.test(gone?.message ?? ''), gone?.message)

// The fallback must carry the code, or the usage row cannot record the reason.
const fb = fallbackReply({ ...agent, display_name: 'Naki' }, 'SUPPORT_ERROR')
ok('the fallback carries the error code for the usage row', fb.error_code === 'SUPPORT_ERROR')
ok('the fallback never leaks a code to the player', !/SUPPORT_/.test(fb.body), fb.body)

// A key that was never set is the case the operator hits first on a fresh install.
key = ''
const noneStub = stubFetch(() => json(200, goodReply))
let none: any = null
try {
  await askModel({ agent, facts: [], grounding: {}, history: [], question: 'hi' })
} catch (e) {
  none = e
}
noneStub.restore()
ok('no key at all is caught before any request is made', none?.code === 'SUPPORT_NOT_CONFIGURED' && noneStub.seen.length === 0)
ok('and the error names the free key page', /console\.groq\.com/.test(none?.message ?? ''))

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall groq checks passed')
process.exit(fails.length ? 1 : 0)
