// supabase/functions/support/index.ts
//
// The in-app half of customer care: the four agents, the thread, and the reply.
//
// WHY THE MODEL CALL LIVES HERE AND NOT IN THE BROWSER
//
// The API key, the account snapshot and the FAQ corpus must never reach the
// client. A support bot that runs in the browser is a support bot whose prompt,
// key and every other player's data are one devtools window away. The client
// sends words; this function decides what the agent is allowed to know.
//
// WHY A FAILED MODEL CALL IS NOT AN ERROR RESPONSE
//
// The player does not care that an upstream timed out. If the model is down or
// unconfigured, they still get a reply — an honest one that says a human has it
// — and a handoff row exists so a human actually does. Returning 502 would show
// an error in their support chat, which is the one place an error is least
// forgivable. Only a problem with the player's own request (not signed in, no
// such thread) is a 4xx.
//
// ROUTES
//
//   GET  ?op=agents                 which seats exist (for the "you are chatting
//                                   with Naki" header and the picker)
//   GET  ?op=thread&id=<uuid>       one thread's messages
//   GET  ?op=calls                  this player's recent phone calls to support
//   POST ?op=start                  open a thread, routed by the message
//   POST ?op=send&id=<uuid>         say something; returns your message and the
//                                   agent's answer in one response
//   POST ?op=close&id=<uuid>        close your own thread

import { json, preflight, readEnv } from '../_shared/http.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import {
  askModel,
  fallbackReply,
  isSupportConfigured,
  type Agent,
  type Fact,
  type Turn,
} from '../_shared/support.ts'

const env = (key: string) => readEnv(key)

const AGENT_COLS = 'id,display_name,role,scope,persona'

function svc() {
  const url = env('SUPABASE_URL')
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Supabase service credentials are not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}

/** Who is asking. Null rather than a thrown error when there is no session. */
async function requireUser(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get('Authorization') || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null

  const url = env('SUPABASE_URL')
  const anon = env('SUPABASE_ANON_KEY')
  if (!url || !anon) return null

  const asUser = createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: auth } },
  })
  const { data, error } = await asUser.auth.getUser()
  if (error || !data?.user) return null
  return { id: data.user.id }
}

// ------------------------------------------------------------------ agents ---

async function listAgents(): Promise<Response> {
  const { data, error } = await svc()
    .from('support_agents')
    .select('id,display_name,role,scope')
    .eq('enabled', true)
    .order('priority', { ascending: true })

  if (error) return json({ error: 'could not load the agents' }, 502)

  return json({
    agents: data ?? [],
    // So the app can say "automated" honestly, and explain what happens when a
    // human is needed, without hardcoding that promise in the UI.
    automated: true,
    configured: isSupportConfigured(),
  })
}

// ------------------------------------------------------------------ thread ---

async function thread(userId: string, id: string): Promise<Response> {
  const db = svc()
  const { data: conv, error: convErr } = await db
    .from('support_conversations')
    .select('id,agent_id,channel,status,topic,needs_human,started_at,last_msg_at')
    .eq('id', id)
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()

  // 404 rather than 403: a thread belonging to someone else must not be
  // distinguishable from one that does not exist.
  if (convErr) return json({ error: 'could not load that conversation' }, 502)
  if (!conv) return json({ error: 'no such conversation' }, 404)

  const { data: msgs, error: msgErr } = await db
    .from('support_messages')
    .select('id,author,agent_id,body,created_at')
    .eq('conversation_id', id)
    .order('id', { ascending: true })
    .limit(200)

  if (msgErr) return json({ error: 'could not load the messages' }, 502)

  return json({ conversation: conv, messages: msgs ?? [] })
}

// ------------------------------------------------------------------- start ---

async function startConversation(userId: string, req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { message?: string } | null
  const opening = String(body?.message ?? '').trim().slice(0, 2000)
  const db = svc()

  // Route FIRST, so the greeting can name the right specialist. Routing on an
  // empty string returns the safety seat (priority 5), which is wrong for a
  // player who just wants to know their balance — so with no text the general
  // account seat answers until there is something to go on.
  let agentId: string | null = null
  if (opening) {
    agentId = (await route(db, opening)).agentId
  }

  const fallbackAgent = agentId ? null : await firstAgentId(db)
  agentId = agentId ?? fallbackAgent

  const { data: conv, error } = await db
    .from('support_conversations')
    .insert({ user_id: userId, agent_id: agentId, channel: 'chat', topic: opening.slice(0, 120) || null })
    .select('id,agent_id,channel,status,topic,needs_human,started_at,last_msg_at')
    .single()

  if (error || !conv) {
    console.error('support: could not start a conversation', error?.message)
    return json({ error: 'could not start a conversation' }, 502)
  }

  // The opening greeting is generated by the same agent that will answer, so it
  // can acknowledge what the player actually said instead of a canned hello.
  if (opening) {
    const reply = await answerAndStore({
      conversationId: conv.id,
      userId,
      agentId,
      question: opening,
      history: [],
      savePlayerMessage: true,
    })
    return json({ conversation: conv, messages: reply.messages })
  }

  return json({ conversation: conv, messages: [] })
}

async function firstAgentId(db: ReturnType<typeof svc>): Promise<string | null> {
  const { data } = await db
    .from('support_agents')
    .select('id')
    .eq('enabled', true)
    .order('priority', { ascending: true })
    .limit(1)
  return data?.[0]?.id ?? null
}

// -------------------------------------------------------------------- send ---

async function sendMessage(userId: string, id: string, req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { message?: string } | null
  const text = String(body?.message ?? '').trim()
  if (!text) return json({ error: 'message is required' }, 400)
  if (text.length > 4000) return json({ error: 'that message is too long — please shorten it' }, 400)

  const db = svc()
  const { data: conv, error } = await db
    .from('support_conversations')
    .select('id,agent_id,status')
    .eq('id', id)
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()

  if (error) return json({ error: 'could not load that conversation' }, 502)
  if (!conv) return json({ error: 'no such conversation' }, 404)

  const { data: history, error: histErr } = await db
    .from('support_messages')
    .select('author,body')
    .eq('conversation_id', id)
    .order('id', { ascending: true })
    .limit(50)

  if (histErr) return json({ error: 'could not load the messages' }, 502)

  const reply = await answerAndStore({
    conversationId: id,
    userId,
    agentId: conv.agent_id,
    question: text,
    history: (history ?? []) as Turn[],
    savePlayerMessage: true,
  })

  return json({ messages: reply.messages, needs_human: reply.needsHuman, agent_id: reply.agentId })
}

/**
 * Run one exchange and persist it.
 *
 * Shared by `start` and `send` because the difference between them is only
 * whether there is history — the grounding, the routing, the handoff and the
 * logging must not be implemented twice, or one of them will forget the handoff.
 */
async function answerAndStore(args: {
  conversationId: string
  userId: string
  agentId: string | null
  question: string
  history: Turn[]
  savePlayerMessage: boolean
}): Promise<{ messages: unknown[]; needsHuman: boolean; agentId: string | null }> {
  const db = svc()
  const saved: unknown[] = []

  if (args.savePlayerMessage) {
    const { data: mine, error } = await db
      .from('support_messages')
      .insert({ conversation_id: args.conversationId, author: 'player', body: args.question })
      .select('id,author,agent_id,body,created_at')
      .single()
    if (error) console.error('support: could not save the player message', error.message)
    else if (mine) saved.push(mine)
  }

  // Which seat answers. A thread keeps its agent unless routing is strongly
  // more confident — a player who asks about money should reach the wallet seat
  // even mid-thread, but not bounce between seats every message.
  let agentId = args.agentId
  {
    const { agentId: candidate, hits } = await route(db, args.question)
    if (!agentId) agentId = candidate
    else if (candidate && candidate !== agentId && hits >= REROUTE_HITS) agentId = candidate
  }

  const { data: agentRow } = agentId
    ? await db.from('support_agents').select(AGENT_COLS).eq('id', agentId).limit(1).maybeSingle()
    : await db.from('support_agents').select(AGENT_COLS).eq('enabled', true)
        .order('priority', { ascending: true }).limit(1).maybeSingle()

  const agent = (agentRow as Agent | null) ?? null

  // Grounding is built by the database, not here: one definition of "what an
  // agent may know", next to the tables it reads.
  const { data: grounding } = await db.rpc('support_grounding', { p_user: args.userId })

  const { data: factRows } = agent
    ? await db
        .from('support_facts')
        .select('id,topic,question,answer')
        .or(`agent_id.eq.${agent.id},agent_id.is.null`)
        .order('priority', { ascending: true })
        .limit(20)
    : { data: null }

  let reply
  try {
    reply = await askModel({
      agent:
        agent ??
        ({
          id: 'account',
          display_name: 'support',
          role: 'customer care',
          scope: 'general questions',
          persona: '',
        } as Agent),
      facts: (factRows ?? []) as Fact[],
      grounding: grounding ?? { known: false },
      history: args.history,
      question: args.question,
    })
  } catch (err) {
    // Deliberately not rethrown: see the note at the top of this file.
    console.error('support: agent call failed', (err as Error).message)
    reply = fallbackReply(
      (agent ?? { display_name: 'support' }) as Agent,
    )
  }

  const shownAgentId = agent?.id ?? agentId
  const { data: agentMsg } = await db
    .from('support_messages')
    .insert({
      conversation_id: args.conversationId,
      author: 'agent',
      agent_id: shownAgentId,
      body: reply.body,
      used_facts: reply.used_facts,
      handoff_reason: reply.handoff_reason,
    })
    .select('id,author,agent_id,body,created_at')
    .single()

  if (agentMsg) saved.push(agentMsg)

  if (reply.handoff) {
    await db
      .from('support_conversations')
      .update({ status: 'handoff', needs_human: true })
      .eq('id', args.conversationId)

    await db.from('support_handoffs').insert({
      conversation_id: args.conversationId,
      user_id: args.userId,
      agent_id: shownAgentId,
      reason: reply.handoff_reason ?? 'agent could not resolve this',
      request: args.question.slice(0, 2000),
      detail: { used_facts: reply.used_facts },
    })

    // A visible line, so the player is not left inferring whether anyone was
    // told. Written by the server as 'system', never by the client.
    const { data: note } = await db
      .from('support_messages')
      .insert({
        conversation_id: args.conversationId,
        author: 'system',
        body: 'Passed to a human.',
      })
      .select('id,author,agent_id,body,created_at')
      .single()
    if (note) saved.push(note)
  }

  await db.from('support_agent_usage').insert({
    agent_id: shownAgentId,
    conversation_id: args.conversationId,
    prompt_tokens: reply.prompt_tokens,
    output_tokens: reply.output_tokens,
  })

  if (args.savePlayerMessage === false) {
    await db
      .from('support_conversations')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', args.conversationId)
  }

  return { messages: saved, needsHuman: reply.handoff, agentId: shownAgentId }
}

/**
 * The seat that should answer, and how sure the router is.
 *
 * `hits` is how many of that seat's keywords the message contained. It is used
 * only to decide whether to move a live conversation to a different agent: on
 * one shared word, no. Being bounced between agents mid-conversation is the
 * most common complaint about automated support, and it is the reason this is a
 * threshold rather than a switch.
 */
async function route(
  db: ReturnType<typeof svc>,
  text: string,
): Promise<{ agentId: string | null; hits: number }> {
  const { data, error } = await db.rpc('support_route_score', { p_text: text })
  if (error) return { agentId: null, hits: 0 }
  const row = (data ?? {}) as { agent_id?: string; hits?: number }
  return { agentId: row.agent_id ?? null, hits: Number(row.hits ?? 0) }
}

/** Two or more matching keywords: enough to hand a live thread to a new seat. */
const REROUTE_HITS = 2

// ------------------------------------------------------------------- calls ---

async function myCalls(userId: string): Promise<Response> {
  const { data, error } = await svc()
    .from('support_calls')
    .select('id,status,duration_seconds,started_at,ended_at,summary,agent_id,needs_human')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(10)

  if (error) return json({ error: 'could not load your calls' }, 502)
  return json({ calls: data ?? [] })
}

// ------------------------------------------------------------------- close ---

async function closeThread(userId: string, id: string): Promise<Response> {
  const { error } = await svc()
    .from('support_conversations')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)

  if (error) return json({ error: 'could not close that conversation' }, 502)
  return json({ ok: true })
}

// ------------------------------------------------------------------- serve ---

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()

  const url = new URL(req.url)
  const op = url.searchParams.get('op') || 'agents'

  const user = await requireUser(req)
  if (!user) return json({ error: 'not signed in' }, 401)

  const id = (url.searchParams.get('id') || '').trim()

  try {
    if (req.method === 'GET') {
      if (op === 'agents') return await listAgents()
      if (op === 'calls') return await myCalls(user.id)
      if (op === 'thread') {
        if (!id) return json({ error: 'id is required' }, 400)
        return await thread(user.id, id)
      }
      return json({ error: 'unknown operation' }, 400)
    }

    if (req.method === 'POST') {
      if (op === 'start') return await startConversation(user.id, req)
      if (op === 'send') {
        if (!id) return json({ error: 'id is required' }, 400)
        return await sendMessage(user.id, id, req)
      }
      if (op === 'close') {
        if (!id) return json({ error: 'id is required' }, 400)
        return await closeThread(user.id, id)
      }
      return json({ error: 'unknown operation' }, 400)
    }

    return json({ error: 'method not allowed' }, 405)
  } catch (err) {
    console.error('support failed', op, (err as Error).message)
    return json({ error: 'that request failed' }, 502)
  }
})

