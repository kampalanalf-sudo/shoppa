// supabase/functions/support-voice/index.ts
//
// Real phone calls into customer care.
//
// A player dials the support number, Twilio answers, and this function is the
// thing on the other end. Each turn: Twilio posts what the caller said, we ask
// the routed agent, and we return TwiML that speaks the answer and listens again.
//
// WHY THE PROVIDER'S CALL ID IS THE KEY
//
// Twilio retries webhooks and does not guarantee order. A `completed` event can
// arrive before the `in_progress` that preceded it, and the same `started` can
// arrive twice. So the call row is upserted on (provider, provider_call_id) and
// every event is journalled before it is applied — the journal is the evidence,
// the row is the state. Applying an event twice must be a no-op, never a second
// agent conversation.
//
// WHY AN UNKNOWN NUMBER IS STILL ANSWERED
//
// Most calls from an unregistered number are a wrong number or someone who has
// not signed up. They get a short, honest answer and a human handoff. They must
// never get an account snapshot, and this code never looks one up without a
// matched profile.
//
// COST
//
// Every speech turn is a model call, so: turns are capped, the transcript is
// trimmed, and the reply is capped at 500 tokens. A caller who is silent is
// hung up on rather than billed for listening.
//
// ROUTES (all POST, all from Twilio)
//
//   ?op=answer   the call arrives: greet, record the call, listen
//   ?op=turn     one thing the caller said: answer it, listen again
//   ?op=status   the call ended: record duration and outcome

import { json, readEnv } from '../_shared/http.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { askModel, isSupportConfigured, type Agent, type Fact, type Turn } from '../_shared/support.ts'
import { isVoiceConfigured, publicUrl, twiml, verifyTwilioSignature } from '../_shared/voice.ts'

const env = (key: string) => readEnv(key)

/** Spoken turns per call. Beyond this a human should be talking to them. */
const MAX_TURNS = 8

const AGENT_COLS = 'id,display_name,role,scope,persona'

function svc() {
  const url = env('SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Supabase service credentials are not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}

type CallRow = {
  id: string
  provider_call_id: string
  user_id: string | null
  agent_id: string | null
  status: string
  transcript: Turn[]
  needs_human: boolean
}

/**
 * Find or create the call row for this provider call id.
 *
 * Upsert on the natural key, so a retried `answer` webhook cannot create a
 * second call — which would put the same conversation into the database twice
 * and show the operator two calls where the player made one.
 */
async function upsertCall(
  db: ReturnType<typeof svc>,
  callId: string,
  from: string,
  to: string,
): Promise<CallRow | null> {
  const { data: existing } = await db
    .from('support_calls')
    .select('id,provider_call_id,user_id,agent_id,status,transcript,needs_human')
    .eq('provider', 'twilio')
    .eq('provider_call_id', callId)
    .limit(1)
    .maybeSingle()

  if (existing) return existing as CallRow

  // Match the caller to a profile by phone. The phone on `profiles` is stored as
  // the player typed it, so compare on the last nine digits, which is the part
  // that does not change between +2567…, 2567… and 07….
  const tail = digits(from).slice(-9)
  let userId: string | null = null
  if (tail.length === 9) {
    const { data: matches } = await db
      .from('profiles')
      .select('id,phone')
      .ilike('phone', `%${tail}`)
      .limit(1)
    userId = matches?.[0]?.id ?? null
  }

  const { data: created, error } = await db
    .from('support_calls')
    .insert({
      provider: 'twilio',
      provider_call_id: callId,
      user_id: userId,
      from_number: from || null,
      to_number: to || null,
      status: 'in_progress',
    })
    .select('id,provider_call_id,user_id,agent_id,status,transcript,needs_human')
    .single()

  if (error) {
    // A race between two retries: the other one won the insert. Read it back.
    const { data: raced } = await db
      .from('support_calls')
      .select('id,provider_call_id,user_id,agent_id,status,transcript,needs_human')
      .eq('provider', 'twilio')
      .eq('provider_call_id', callId)
      .limit(1)
      .maybeSingle()
    if (raced) return raced as CallRow
    console.error('support-voice: could not record the call', error.message)
    return null
  }

  return created as CallRow
}

const digits = (s: string) => String(s ?? '').replace(/\D/g, '')

async function waitTurn(db: ReturnType<typeof svc>, text: string): Promise<string | null> {
  const { data, error } = await db.rpc('support_route_score', { p_text: text })
  if (error) return null
  return ((data ?? {}) as { agent_id?: string }).agent_id ?? null
}

/** The agent for this call, chosen from the first thing the caller said. */
async function agentFor(
  db: ReturnType<typeof svc>,
  id: string | null,
): Promise<Agent | null> {
  const q = id
    ? db.from('support_agents').select(AGENT_COLS).eq('id', id).limit(1).maybeSingle()
    : db.from('support_agents').select(AGENT_COLS).eq('enabled', true)
        .order('priority', { ascending: true }).limit(1).maybeSingle()
  const { data } = await q
  return (data as Agent | null) ?? null
}

// ------------------------------------------------------------------ answer ---

async function answer(db: ReturnType<typeof svc>, form: URLSearchParams, url: string) {
  const callId = form.get('CallSid') || ''
  const from = form.get('From') || ''
  const to = form.get('To') || ''

  if (!isSupportConfigured()) {
    return twiml(
      'Sorry, our support line is not available right now. Please send us a message in the app instead.',
      { hangup: true },
    )
  }

  // If the call cannot be recorded, nothing else here can be trusted: no
  // grounding, no handoff row, no transcript for the human. Say so, rather than
  // talking to the caller and losing everything they said.
  let call: CallRow | null = null
  try {
    call = callId ? await upsertCall(db, callId, from, to) : null
  } catch {
    call = null
  }
  if (callId && !call) {
    return twiml('Sorry, our support line cannot take calls at the moment. Please message us in the app instead.', {
      hangup: true,
    })
  }

  const agent = await agentFor(db, call?.agent_id ?? null)

  // The greeting is deliberately one sentence. A long greeting on a phone line
  // is paid for in seconds and remembered as a wall of words.
  const greeting = agent
    ? `Hello, you've reached FloatBet support. This is ${agent.display_name}, and I help with ${agent.role.toLowerCase()}. What can I do for you?`
    : `Hello, you've reached FloatBet support. What can I do for you?`

  return twiml(greeting, { listen: listenUrl(url) })
}

/** Where Twilio should post the next thing the caller says. */
function listenUrl(url: string): string {
  const u = new URL(url)
  u.searchParams.set('op', 'turn')
  return u.toString()
}

// -------------------------------------------------------------------- turn ---

async function turn(db: ReturnType<typeof svc>, form: URLSearchParams, url: string) {
  const callId = form.get('CallSid') || ''
  const said = (form.get('SpeechResult') || '').trim()

  const call = callId
    ? ((await db
        .from('support_calls')
        .select('id,provider_call_id,user_id,agent_id,status,transcript,needs_human')
        .eq('provider', 'twilio')
        .eq('provider_call_id', callId)
        .limit(1)
        .maybeSingle()).data as CallRow | null)
    : null

  if (!call) {
    // The call row is missing, which means `answer` never landed. Rather than
    // improvise, tell the caller the truth and end cleanly.
    return twiml('Sorry, I lost this call. Please call again in a moment.', { hangup: true })
  }

  // Silence. Twilio sends an empty SpeechResult when the caller says nothing;
  // prompting again once is helpful, twice is a loop that bills them.
  if (!said) {
    const promptCount = (call.transcript ?? []).filter((t) => t.body === '__prompt__').length
    if (promptCount >= 1) {
      return twiml('I did not catch that. Please call again when you can, or message us in the app.', {
        hangup: true,
      })
    }
    return twiml('Sorry, I didn\'t hear anything. Are you still there?', { listen: listenUrl(url) })
  }

  const transcript: Turn[] = Array.isArray(call.transcript) ? call.transcript : []
  const spokenTurns = transcript.filter((t) => t.body !== '__prompt__').length

  if (spokenTurns >= MAX_TURNS) {
    await db.from('support_calls').update({ needs_human: true, summary: 'turn limit reached' }).eq('id', call.id)
    return twiml(
      'I have taken down what you told me and a human will follow up. Thank you for calling FloatBet.',
      { hangup: true },
    )
  }

  // Which seat. A call keeps its agent; routing only applies before one is set,
  // because a caller who hears a different name each time thinks they were
  // transferred by accident.
  let agentId = call.agent_id
  if (!agentId) {
    agentId = await waitTurn(db, said)
    if (agentId) await db.from('support_calls').update({ agent_id: agentId }).eq('id', call.id)
  }
  const agent = await agentFor(db, agentId)

  const { data: grounding } = call.user_id
    ? await db.rpc('support_grounding', { p_user: call.user_id })
    : { data: { known: false } }

  const { data: factRows } = agent
    ? await db
        .from('support_facts')
        .select('id,topic,question,answer')
        .or(`agent_id.eq.${agent.id},agent_id.is.null`)
        .order('priority', { ascending: true })
        .limit(15)
    : { data: null }

  let reply
  // Carried out of the catch so the usage row can say why the call failed.
  let failure: string | null = null
  try {
    reply = await askModel({
      agent:
        agent ??
        ({ id: 'account', display_name: 'support', role: 'customer care', scope: 'general', persona: '' } as Agent),
      facts: (factRows ?? []) as Fact[],
      grounding: grounding ?? { known: false },
      // Only the last few turns: a phone call is short, and a long prompt on
      // every turn is paid for again on every turn.
      history: transcript.slice(-6),
      question: said,
      maxTokens: 600,
    })
  } catch (err) {
    failure = (err as { code?: string }).code ?? 'SUPPORT_ERROR'
    console.error('support-voice: agent failed', failure, (err as Error).message)
    reply = {
      body: 'I am having trouble looking that up. I have taken your details and a human will call you back.',
      handoff: true,
      handoff_reason: 'agent unavailable during a call',
      used_facts: [],
      prompt_tokens: null,
      output_tokens: null,
    }
  }

  // Persist the exchange. A `__prompt__` marker is not stored: it exists only to
  // count prompts, and it is not a turn.
  const nextTranscript: Turn[] = [...transcript, { author: 'player', body: said }, { author: 'agent', body: reply.body }]
  await db
    .from('support_calls')
    .update({
      transcript: nextTranscript,
      needs_human: call.needs_human || reply.handoff,
      summary: reply.handoff
        ? (reply.handoff_reason ?? 'needs a human').slice(0, 200)
        : nextTranscript[nextTranscript.length - 1]?.body.slice(0, 200),
    })
    .eq('id', call.id)

  await db.from('support_agent_usage').insert({
    agent_id: agent?.id ?? agentId,
    call_id: call.id,
    prompt_tokens: reply.prompt_tokens,
    output_tokens: reply.output_tokens,
    error_code: reply.error_code ?? failure ?? null,
  })

  if (reply.handoff) {
    await db.from('support_handoffs').insert({
      call_id: call.id,
      user_id: call.user_id,
      agent_id: agent?.id ?? agentId,
      reason: reply.handoff_reason ?? 'needs a human',
      request: said.slice(0, 2000),
      detail: { channel: 'voice', used_facts: reply.used_facts },
    })
    // Say it, then end. A handoff that keeps listening invites the caller to
    // repeat a request nobody can act on yet.
    return twiml(`${reply.body} I am passing this to a human now. Thank you for calling.`, {
      hangup: true,
    })
  }

  return twiml(reply.body, { listen: listenUrl(url) })
}

// ------------------------------------------------------------------ status ---

async function status(db: ReturnType<typeof svc>, form: URLSearchParams) {
  const callId = form.get('CallSid') || ''
  if (!callId) return json({ ok: true })

  const providerStatus = (form.get('CallStatus') || '').toLowerCase()
  const seconds = Number(form.get('CallDuration') || 0)

  const mapped =
    providerStatus === 'completed'
      ? 'completed'
      : providerStatus === 'failed'
        ? 'failed'
        : providerStatus === 'no-answer' || providerStatus === 'busy'
          ? 'no_answer'
          : 'in_progress'

  await db
    .from('support_calls')
    .update({
      status: mapped,
      duration_seconds: Number.isFinite(seconds) ? Math.max(0, Math.trunc(seconds)) : 0,
      ended_at: mapped === 'in_progress' ? null : new Date().toISOString(),
    })
    .eq('provider', 'twilio')
    .eq('provider_call_id', callId)

  return json({ ok: true })
}

// ------------------------------------------------------------------- serve ---

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const url = new URL(req.url)
  const op = url.searchParams.get('op') || 'answer'

  if (!isVoiceConfigured()) {
    // Explicit and honest: no Twilio credentials, so no call can be trusted or
    // spoken to. This is a 503 rather than a 401 because nothing was forged.
    return json(
      {
        error: 'The support phone line is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.',
        code: 'VOICE_NOT_CONFIGURED',
      },
      503,
    )
  }

  // Signature first, before the body is trusted or any row is written.
  if (!(await verifyTwilioSignature(req.clone(), publicUrl(req)))) {
    return json({ error: 'invalid signature' }, 401)
  }

  const raw = await req.text()
  const form = new URLSearchParams(raw)

  try {
    const db = svc()

    // Journal the raw event before applying it. If applying fails, the record of
    // what the provider actually sent is still there to explain the call.
    await db.from('support_call_events').insert({
      provider: 'twilio',
      provider_call_id: form.get('CallSid'),
      event_type: op,
      payload: Object.fromEntries(form.entries()),
    })

    if (op === 'turn') return await turn(db, form, url.toString())
    if (op === 'status') return await status(db, form)
    return await answer(db, form, url.toString())
  } catch (err) {
    console.error('support-voice failed', op, (err as Error).message)
    // A spoken apology beats a Twilio error tone. The caller cannot read a JSON
    // body, so an exception here must still produce TwiML.
    return twiml('Sorry, something went wrong on our side. Please call back shortly.', { hangup: true })
  }
})
