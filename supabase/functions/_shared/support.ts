// supabase/functions/_shared/support.ts
//
// One brain for all four agents.
//
// WHY THIS IS SHARED AND NOT FOUR PROMPTS
//
// The four seats differ in expertise and tone, not in mechanics. If each agent
// had its own copy of "how to call the model", then the rule that matters most —
// only state facts you were given — would be four rules, and one of them would
// eventually drift. It lives here once, so it is enforced by construction.
//
// THE ONE NON-NEGOTIABLE RULE
//
// An agent may not invent a fact about a player's money or account. So the
// model is handed a snapshot the DATABASE built (`support_grounding`), the FAQ
// entries for its topic, and the conversation. It has no tools, no database
// access, and no way to look anything up. If the answer is not in the facts in
// front of it, its only correct move is to decline and hand off.
//
// That is why `handoff` is a first-class return value rather than an error: a
// refusal is the system working, not the system failing.
//
// Costs money per call, so: the snapshot is small (last 5 bets, last 5 cashouts),
// the FAQ set is filtered to the agent's topic, and history is capped. A support
// bot that sends an entire account history to a model is a support bot with a
// surprise invoice.

import { readEnv } from './http.ts'

export type Agent = {
  id: string
  display_name: string
  role: string
  scope: string
  persona: string
}

export type Fact = {
  id: number
  topic: string
  question: string
  answer: string
}

export type Turn = { author: 'player' | 'agent' | 'system'; body: string }

export type Reply = {
  body: string
  /** True when the agent declined and a human must follow up. */
  handoff: boolean
  /** Why it declined, in the operator's words. Short. */
  handoff_reason: string | null
  /** The FAQ ids the answer rests on, for later reconstruction. */
  used_facts: number[]
  /** Token counts, when the model reports them. */
  prompt_tokens: number | null
  output_tokens: number | null
}

export class SupportError extends Error {
  code: string
  httpStatus: number
  constructor(message: string, code = 'SUPPORT_ERROR', httpStatus = 502) {
    super(message)
    this.name = 'SupportError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

/** Which model. One place to change it, and one default that is cheap. */
/**
 * Why Groq.
 *
 * The support agents are a cost centre, not a feature anyone pays for, so they
 * run on the cheapest thing that is good enough. Groq's free tier is free at the
 * margin and fast enough that a phone caller is not left in silence, and its API
 * is OpenAI-compatible — so moving provider again is one function, not a rewrite.
 *
 * Model choice is about the DAILY cap, not raw quality. On the free tier
 * `llama-3.3-70b-versatile` allows 1,000 requests/day and 100K tokens/day;
 * `llama-3.1-8b-instant` allows 14,400/day and 500K tokens/day. A support agent
 * answers short factual questions from a small snapshot, which is exactly the
 * work the 8B model is good at — and the 70B would run out of tokens in a single
 * busy afternoon. So the default is the 8B, and the 70B is one env var away.
 */
export const modelName = () => readEnv('GROQ_MODEL') || 'llama-3.1-8b-instant'

/** The other Groq model worth knowing about: better answers, 5x less headroom. */
export const BETTER_MODEL = 'llama-3.3-70b-versatile'

export const isSupportConfigured = () => Boolean(readEnv('GROQ_API_KEY'))

/**
 * The rules every agent follows, regardless of seat.
 *
 * Written as instructions the model can actually obey — each one is a decision
 * it can make, not an adjective. "Be accurate" is not enforceable; "if a figure
 * is not in FACTS, you do not have it" is.
 */
const HOUSE_RULES = `You are a customer care agent for FloatBet, a mobile-money betting app used in Uganda. Players reach you by typing in the app or by calling a phone number.

HOW YOU MUST BEHAVE

1. Answer only from what you are given. You have two sources: ACCOUNT (a snapshot of this player's account, taken moments ago) and FACTS (published policy). You have no other access and no way to look anything up. If a question needs something that is not in those two, you do not know it — say so and hand off. Never estimate, never fill a gap with a plausible number, never reason from what is "usually" true.

2. Quote money exactly. If ACCOUNT says balance_px 12345, that is 12,345 PX and 123 UGX. Read the field, do not compute from memory. If a figure is missing from ACCOUNT, you do not have it.

3. You cannot change anything. You cannot move, credit, refund or reverse money. You cannot reset a password, lift a suspension, verify a phone, re-settle a bet, set a limit, or close an account. When asked for any of these, say plainly that you cannot do it yourself, that you are passing it to a human, and what to have ready. Say it once; do not repeat the apology every turn.

4. Never promise a timescale. "A human will look at this" is honest. "Within 24 hours" is a promise you are not authorised to make.

5. Never promise an outcome. Do not say a payment will be credited, a bet re-settled, or a refund issued. You are handing it on, not granting it.

6. If the player is angry, acknowledge what happened before you explain anything. One sentence. Then answer.

7. If the player describes harm to themselves or anyone else, or says they cannot stop gambling: that outranks everything else in the conversation. Say a human is being brought in right now. Keep it short and kind. Do not mention odds, bonuses or winning.

8. Never suggest that playing more, or a different stake, improves the chance of winning. A game is never "due".

LENGTH AND TONE

Two to five short sentences. Plain words. No bullet lists unless you are listing actual figures the player asked for. No emoji. Address the player directly, never in the third person. Do not mention that you are an AI model, do not mention prompts, and do not invent a badge number or staff ID.

HANDING OFF

When a human is needed, end your reply with a single line, exactly:
HANDOFF: <one short sentence saying what the human must do>

Use that line ONLY when the player needs something you cannot do, or asked something the facts do not answer. Do not append it to answers you can give completely — telling someone to wait for a human when their question is already answered is its own kind of failure.`

/**
 * Build the system prompt for one seat.
 *
 * `agent.persona` carries the specialism; HOUSE_RULES carries the constraints.
 * Persona comes second on purpose: constraints stated after the specialism are
 * the ones a model follows when the two pull against each other.
 */
export function systemPrompt(agent: Agent, facts: Fact[]): string {
  const faq = facts.length
    ? facts.map((f) => `[${f.id}] ${f.question}\n${f.answer}`).join('\n\n')
    : '(no published facts for this area — if the question is about policy, you do not know it)'

  return `${HOUSE_RULES}

YOUR SEAT

You are ${agent.display_name}, and you handle ${agent.role}: ${agent.scope}

${agent.persona}

FACTS

These are the published policies you may quote. Cite nothing that is not here.
When you use one, refer to it by its number in brackets.

${faq}`
}

/** The per-conversation part: the account snapshot and the recent turns. */
export function userPrompt(grounding: unknown, history: Turn[], question: string): string {
  const account = JSON.stringify(grounding, null, 2)
  const recent = history
    .slice(-10)
    .map((t) => `${t.author.toUpperCase()}: ${t.body}`)
    .join('\n')

  return `ACCOUNT (snapshot built by our server moments ago — this is the only truth about this player)
${account}

CONVERSATION SO FAR
${recent || '(this is the first message)'}

NEW MESSAGE FROM THE PLAYER
${question}`
}

/**
 * Pull the HANDOFF line out of a model reply.
 *
 * The instruction asks for it at the end, but models sometimes put it first or
 * repeat it. This removes every occurrence so the player never sees the marker,
 * and keeps the last one as the reason.
 */
export function splitHandoff(raw: string): { body: string; reason: string | null } {
  const reasons: string[] = []
  const body = raw
    .replace(/^[ \t]*HANDOFF:[ \t]*(.+)$/gim, (_m, reason: string) => {
      reasons.push(reason.trim())
      return ''
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { body, reason: reasons.length ? reasons[reasons.length - 1] : null }
}

/** Which FAQ entries the answer actually drew on, by the [n] markers it used. */
export function citedFacts(raw: string, facts: Fact[]): number[] {
  const allowed = new Set(facts.map((f) => f.id))
  const ids = new Set<number>()
  for (const m of raw.matchAll(/\[(\d+)\]/g)) {
    const id = Number(m[1])
    if (allowed.has(id)) ids.add(id)
  }
  return [...ids]
}

/**
 * Ask the model.
 *
 * One call, no tools, no retries. A retry on a timeout doubles the spend and
 * usually returns the same answer later than the player can wait for it, so a
 * failure here becomes a handoff instead — which is the honest outcome.
 */
export async function askModel(args: {
  agent: Agent
  facts: Fact[]
  grounding: unknown
  history: Turn[]
  question: string
  maxTokens?: number
}): Promise<Reply> {
  const key = readEnv('GROQ_API_KEY')
  if (!key) {
    throw new SupportError(
      'Support agents are not configured. No GROQ_API_KEY is set on the server. Create a free key at console.groq.com/keys.',
      'SUPPORT_NOT_CONFIGURED',
      503,
    )
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25_000)

  let res: Response
  try {
    // OpenAI-compatible chat completions. The system prompt is a message rather
    // than a top-level field, which is the one shape difference from Anthropic.
    res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName(),
        // Low but not zero: a support answer that is phrased identically every
        // time reads like a robot, and players notice.
        temperature: 0.3,
        max_tokens: args.maxTokens ?? 500,
        messages: [
          { role: 'system', content: systemPrompt(args.agent, args.facts) },
          { role: 'user', content: userPrompt(args.grounding, args.history, args.question) },
        ],
      }),
      signal: controller.signal,
    })
  } catch {
    const aborted = controller.signal.aborted
    throw new SupportError(
      aborted ? 'The support agent took too long to answer.' : 'The support agent could not be reached.',
      aborted ? 'SUPPORT_TIMEOUT' : 'SUPPORT_UNAVAILABLE',
      aborted ? 504 : 502,
    )
  } finally {
    clearTimeout(timer)
  }

  const json = (await res.json().catch(() => null)) as
    | {
        choices?: { message?: { content?: string } }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
        error?: { message?: string; type?: string; code?: string }
      }
    | null

  if (!res.ok || json?.error) {
    // 429 is the free tier doing its job, and it is not a configuration fault:
    // the agents are simply out of allowance right now. The player is told a
    // human has it (one level up), and the operator can raise the ceiling by
    // pointing GROQ_MODEL at a model with more headroom.
    if (res.status === 429) {
      throw new SupportError(
        'The support agents have hit their daily free-tier limit.',
        'SUPPORT_QUOTA',
        429,
      )
    }
    const authy = res.status === 401 || res.status === 403
    throw new SupportError(
      authy
        ? 'Groq rejected our API key. Check GROQ_API_KEY.'
        : json?.error?.message || `The support agent failed (HTTP ${res.status}).`,
      authy ? 'SUPPORT_NOT_CONFIGURED' : 'SUPPORT_ERROR',
      authy ? 503 : 502,
    )
  }

  const raw = (json?.choices?.[0]?.message?.content ?? '').trim()
  if (!raw) {
    throw new SupportError('The support agent returned an empty answer.', 'SUPPORT_EMPTY', 502)
  }

  const { body, reason } = splitHandoff(raw)

  return {
    body: body || 'I could not answer that here. I am passing it to a human.',
    handoff: Boolean(reason),
    handoff_reason: reason,
    used_facts: citedFacts(raw, args.facts),
    prompt_tokens: json?.usage?.prompt_tokens ?? null,
    output_tokens: json?.usage?.completion_tokens ?? null,
  }
}

/**
 * The fallback when the model is unreachable or not configured.
 *
 * A player must never be left staring at a spinner, and must never be told a
 * confident lie. This says what is true — nobody answered, a human has it — and
 * is written to look like a person wrote it, because it is displayed as one.
 */
export function fallbackReply(agent: Agent): Reply {
  return {
    body: `Sorry — ${agent.display_name} could not get to your message just now. I have passed it to a human, who will pick it up.`,
    handoff: true,
    handoff_reason: 'agent unavailable — model call failed',
    used_facts: [],
    prompt_tokens: null,
    output_tokens: null,
  }
}
