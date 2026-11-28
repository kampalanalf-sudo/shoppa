// smoke/sessions.ts
//
// The player-address record, checked where it can quietly go wrong.
//
// The feature is "note the location and IP of players for security reasons", and
// every way of getting it wrong compiles:
//
//   * the client sends an IP, or a user id — and the record becomes a claim by the
//     player rather than evidence about them;
//   * full-precision coordinates are stored, so "about a kilometre" is a comment
//     rather than a fact;
//   * a heartbeat writes on every request, turning a security log into a
//     movement log;
//   * the player's own view returns an address, exposing a household's IP to
//     anyone who guesses a password;
//   * `0, 0` is treated as a real position and pinned in the Gulf of Guinea;
//   * the retention job is never scheduled, so "180 days" means "forever";
//   * the record is readable, or writable, without a session at all.
//
// This asserts the rules against the source: the migration, the edge function and
// the client. It does not talk to a database — the live probe that mints a session
// and calls `record_session` is a separate, manual step, because it needs a real
// player's JWT.
import { readFileSync } from 'node:fs'

const fails: string[] = []
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) fails.push(name)
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`)
}

const MIG = readFileSync('supabase/migrations/0027_player_sessions.sql', 'utf8')
const FN = readFileSync('supabase/functions/session/index.ts', 'utf8')
const CLIENT = readFileSync('src/lib/session.ts', 'utf8')
const ADMIN = readFileSync('src/pages/AdminPlayers.tsx', 'utf8')
const PRIVACY = readFileSync('src/pages/Privacy.tsx', 'utf8')

// ------------------------------------------------------------- the write path --

// `auth.uid()`, not a parameter: the one property that makes the log evidence.
ok('record_session takes the player from auth.uid(), not from the caller',
  /v_uid\s+uuid\s*:=\s*auth\.uid\(\)/.test(MIG) &&
  !/p_user\s+uuid/.test(MIG.split('record_session')[1]?.split('create or replace')[0] ?? ''))

ok('an anonymous call is refused before anything is written',
  /if v_uid is null then\s*\n\s*raise exception 'not authenticated'/.test(MIG))

// The address is parsed, not trusted: a junk header must not error the row away.
ok('a malformed address is stored as unknown instead of raising',
  /begin\s*\n\s*v_ip := nullif\(trim\(coalesce\(p_ip/.test(MIG) && /exception when others then\s*\n\s*v_ip := null/.test(MIG))

// ------------------------------------------------------------- the precision --

ok('coordinates are rounded to 2dp before storage',
  /round\(p_lat, 2\)/.test(MIG) && /round\(p_lng, 2\)/.test(MIG))

ok('(0,0) is treated as no fix, not as a position off the coast of Africa',
  /coalesce\(p_lat,\s*0\) = 0 and coalesce\(p_lng,\s*0\) = 0/.test(MIG))

ok('the column itself cannot hold more precision than a kilometre',
  /device_lat\s+numeric\(6, 2\)/.test(MIG))

// ---------------------------------------------------------------- the throttle --

ok('a heartbeat inside the interval is dropped, server-side',
  /v_recent > now\(\) - make_interval\(mins => v_settings\.heartbeat_minutes\)/.test(MIG) &&
  /return jsonb_build_object\('recorded', false, 'reason', 'too soon'\)/.test(MIG))

ok('a sign-in is never dropped by the throttle',
  /if v_event = 'heartbeat' then/.test(MIG))

ok('the client throttles too, so a reload loop does not even reach the server',
  /HEARTBEAT_MS = 30 \* 60 \* 1000/.test(CLIENT) && /recentlySent\(\)/.test(CLIENT))

// The events that must not record. A bet is not a session event.
ok('nothing in the money path records a session', !/record_session/.test(
  readFileSync('supabase/functions/play/index.ts', 'utf8'),
))

// ---------------------------------------------------------------- what is seen --

const myLog = MIG.split('my_session_log')[2]?.split('player_session_log')[0] ?? ''
ok('the player\'s own view never returns an address', !/'ip'/.test(myLog) && !/host\(s\.ip\)/.test(myLog))
ok('the player\'s own view returns a city-level place', /'place'/.test(myLog))

const adminLog = MIG.split('function public.player_session_log')[1] ?? ''
ok('the admin view is by one player, with no fleet-wide list', !/from profiles p2|all_players/.test(MIG))
ok('the admin view surfaces an address shared by more than one account',
  /shared_ip_accounts/.test(adminLog) && /having count\(distinct s2\.user_id\) > 1/.test(adminLog))

ok('only the service role may read another player\'s record',
  /revoke all on function public\.player_session_log\(uuid,\s*int\) from public, anon, authenticated/.test(MIG) &&
  /grant execute on function public\.player_session_log\(uuid,\s*int\) to service_role/.test(MIG))

ok('the address table has RLS on and no policy at all',
  /alter table player_sessions enable row level security/.test(MIG) &&
  !/create policy[^;]*player_sessions/i.test(MIG))

// ------------------------------------------------------------------ the header --

ok('the address is read from the request headers, not from the body',
  /function clientIp\(req: Request\)/.test(FN) && !/body\?\.ip/.test(FN))

ok('Cloudflare\'s header wins, because a browser cannot set it',
  /cf-connecting-ip/.test(FN))

ok('only the first entry of x-forwarded-for is used', /split\(','\)\[0\]/.test(FN))

ok('the function identifies the caller before reading the body',
  /const user = await requireUser\(req\)\s*\n\s*if \(!user\) return json\(\{ error: 'not authenticated' \}, 401\)/.test(FN))

ok('an out-of-range coordinate is rejected rather than drawn on a map',
  /lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180/.test(FN))

// ---------------------------------------------------------------- the client --

ok('location is requested with the cheap network fix, not GPS', /enableHighAccuracy: false/.test(CLIENT))
ok('a fix older than five minutes is not sent', /MAX_FIX_AGE_MS/.test(CLIENT))
ok('the recorder never throws into the app', /catch \{\s*\n\s*\/\/ Signed out, offline/.test(CLIENT))

// ---------------------------------------------------------------- the operator --

ok('the admin screen labels the coordinates unverified', /unverified/.test(ADMIN))
ok('the admin screen says a shared address is not a verdict', /not a verdict/.test(ADMIN))
ok('the admin screen states the retention window', /180 days/.test(ADMIN))

// ---------------------------------------------------------------- the disclosure --

ok('the privacy page states the recording interval',
  /once every 30 minutes/.test(PRIVACY))
ok('the privacy page states the rounding', /one\s*\n?\s*kilometre|about one\s*\n?\s*kilometre/.test(PRIVACY))
ok('the privacy page states who can see it', /Admins can see one player/.test(PRIVACY))
ok('the privacy page states the retention', /180 days/.test(PRIVACY))
ok('what it is NOT used for is stated explicitly', /not used to decide a bet/.test(PRIVACY))

// ---------------------------------------------------------------- the retention --

ok('the erasure is scheduled, not left to memory',
  /cron\.schedule\(\s*\n?\s*'purge_session_addresses'/.test(MIG))
ok('the retention window is enforced in the purge, not only in prose',
  /make_interval\(days => greatest\(coalesce\(p_keep_days, 180\), 30\)\)/.test(MIG))

if (fails.length) {
  console.error(`\n${fails.length} failed`)
  process.exit(1)
}
console.log('\nall session-privacy checks pass')
