-- ============================================================================
-- FloatBet / Shopper — production schema
-- ----------------------------------------------------------------------------
-- Money model
--   All balances are whole PX stored as BIGINT. 10 PX = 1 UGX.
--   Every mutation goes through a SECURITY DEFINER function so the ledger,
--   the balance and the audit trail can never drift apart. The browser never
--   writes a balance column directly.
--
-- Trust model
--   * profiles/wallets: read own only.
--   * ledger: append-only, read own only. No UPDATE/DELETE policy => immutable.
--   * chat: authenticated read, authenticated insert of own messages only.
--   * gifts: only the send_gift() function may insert.
--   * cashouts: inserted by the user, but only the service role can move them
--     to a terminal state (the DGateway webhook runs as service role).
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums -----
do $$ begin
  create type gift_status as enum ('pending', 'accepted', 'declined', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cashout_kind as enum ('momo', 'crypto');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cashout_status as enum (
    'requested', 'pending_provider', 'paid', 'failed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type ledger_kind as enum (
    'grant', 'bet', 'win', 'gift_out', 'gift_in',
    'cashout_hold', 'cashout_refund', 'adjustment'
  );
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------- profiles -----
create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text not null unique,
  display_name  text,
  avatar_url    text,
  -- KYC-lite: a verified phone is required before a first cashout.
  phone         text,
  phone_verified boolean not null default false,
  country       text not null default 'UG',
  date_of_birth date,
  -- players must confirm 18+ before playing for value
  age_confirmed boolean not null default false,
  is_admin      boolean not null default false,
  suspended     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint username_shape check (username ~ '^[a-zA-Z0-9_]{3,18}$')
);

-- ------------------------------------------------------------- wallets ------
create table if not exists wallets (
  user_id       uuid primary key references profiles(id) on delete cascade,
  balance_px    bigint not null default 0 check (balance_px >= 0),
  -- lifetime totals, for responsible-gaming limits and reporting
  wagered_px    bigint not null default 0,
  won_px        bigint not null default 0,
  cashed_out_px bigint not null default 0,
  gifted_out_px bigint not null default 0,
  gifted_in_px  bigint not null default 0,
  updated_at    timestamptz not null default now()
);

-- -------------------------------------------------------------- ledger ------
-- Append-only. Every balance change has a row. `balance_after` lets an auditor
-- replay the account without recomputing.
create table if not exists ledger (
  id            bigserial primary key,
  user_id       uuid not null references profiles(id) on delete cascade,
  kind          ledger_kind not null,
  delta_px      bigint not null,
  balance_after bigint not null,
  ref           text,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists ledger_user_time on ledger (user_id, created_at desc);

-- ---------------------------------------------------------------- chat ------
create table if not exists chat_messages (
  id         bigserial primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 500),
  -- a gift can be attached to a message so it renders inline
  gift_id    uuid,
  created_at timestamptz not null default now()
);
create index if not exists chat_time on chat_messages (created_at desc);

-- ---------------------------------------------------------------- gifts -----
create table if not exists gifts (
  id          uuid primary key default uuid_generate_v4(),
  sender_id   uuid not null references profiles(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  amount_px   bigint not null check (amount_px > 0),
  note        text check (note is null or char_length(note) <= 140),
  status      gift_status not null default 'pending',
  message_id  bigint references chat_messages(id) on delete set null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  constraint no_self_gift check (sender_id <> recipient_id)
);
create index if not exists gifts_recipient on gifts (recipient_id, status);

-- ------------------------------------------------------------- cashouts -----
create table if not exists cashouts (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references profiles(id) on delete cascade,
  kind           cashout_kind not null,
  amount_px      bigint not null check (amount_px > 0),
  ugx            bigint not null check (ugx > 0),
  -- momo
  phone          text,
  rail           text check (rail in ('MTN', 'Airtel')),
  -- crypto
  asset          text,
  address        text,
  status         cashout_status not null default 'requested',
  provider_ref   text unique,
  failure_reason text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint cashout_target check (
    (kind = 'momo' and phone is not null and rail is not null) or
    (kind = 'crypto' and asset is not null and address is not null)
  )
);
create index if not exists cashouts_user on cashouts (user_id, created_at desc);

-- -------------------------------------------------------------- rounds ------
-- One row per settled round, so the server can validate revenue and the
-- player can reconcile their history. Written by the settle_round() RPC.
create table if not exists rounds (
  id          bigserial primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  game        text not null,
  wager_px    bigint not null check (wager_px >= 0),
  payout_px   bigint not null check (payout_px >= 0),
  multiplier  numeric(12, 4) not null default 0,
  nonce       bigint,
  client_seed text,
  server_seed_hash text,
  detail      text,
  created_at  timestamptz not null default now()
);
create index if not exists rounds_user on rounds (user_id, created_at desc);

-- ======================================================== triggers ==========
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_touch on profiles;
create trigger profiles_touch before update on profiles
  for each row execute function touch_updated_at();

drop trigger if exists wallets_touch on wallets;
create trigger wallets_touch before update on wallets
  for each row execute function touch_updated_at();

drop trigger if exists cashouts_touch on cashouts;
create trigger cashouts_touch before update on cashouts
  for each row execute function touch_updated_at();

-- New auth user -> profile + wallet with the starting grant.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_username text;
  v_grant    constant bigint := 10000;
begin
  -- derive a usable handle, falling back to a generated suffix
  v_username := coalesce(
    nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', ''), '[^a-zA-Z0-9_]', '', 'g'), ''),
    nullif(regexp_replace(split_part(coalesce(new.email, ''), '@', 1), '[^a-zA-Z0-9_]', '', 'g'), ''),
    'player'
  );
  -- enforce the 3..18 shape before the insert, and make it unique
  v_username := substr(v_username, 1, 12);
  if char_length(v_username) < 3 then
    v_username := 'player' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;
  while exists (select 1 from profiles where lower(username) = lower(v_username)) loop
    v_username := substr(v_username, 1, 10) || floor(random() * 9000 + 1000)::int::text;
  end loop;

  insert into profiles (id, username, display_name, avatar_url, country)
  values (
    new.id,
    v_username,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(new.raw_user_meta_data ->> 'country', 'UG')
  );

  insert into wallets (user_id, balance_px) values (new.id, 0);

  -- the welcome grant, recorded in the ledger like any other money movement
  if v_grant > 0 then
    update wallets set balance_px = balance_px + v_grant where user_id = new.id;
    insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
    values (new.id, 'grant', v_grant, v_grant, 'welcome', jsonb_build_object('reason', 'new player grant'));
  end if;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================ RLS ===========
alter table profiles      enable row level security;
alter table wallets       enable row level security;
alter table ledger        enable row level security;
alter table chat_messages enable row level security;
alter table gifts         enable row level security;
alter table cashouts      enable row level security;
alter table rounds        enable row level security;

-- profiles: you may read and update your own row. Usernames are public so the
-- chat can resolve senders.
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select
  using (true);

drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- wallets: own row only.
drop policy if exists wallets_read_own on wallets;
create policy wallets_read_own on wallets for select
  using (auth.uid() = user_id);

-- ledger: own rows only, and insert is forbidden for clients.
drop policy if exists ledger_read_own on ledger;
create policy ledger_read_own on ledger for select
  using (auth.uid() = user_id);

-- chat: everyone authenticated reads; you may post as yourself.
drop policy if exists chat_read on chat_messages;
create policy chat_read on chat_messages for select
  to authenticated using (true);

drop policy if exists chat_insert_own on chat_messages;
create policy chat_insert_own on chat_messages for insert
  to authenticated with check (auth.uid() = user_id);

-- gifts: see gifts you sent or received. Only the RPC may insert.
drop policy if exists gifts_read_involved on gifts;
create policy gifts_read_involved on gifts for select
  to authenticated using (auth.uid() = sender_id or auth.uid() = recipient_id);

-- cashouts: own rows only. Inserts go through request_cashout().
drop policy if exists cashouts_read_own on cashouts;
create policy cashouts_read_own on cashouts for select
  using (auth.uid() = user_id);

-- rounds: own rows only.
drop policy if exists rounds_read_own on rounds;
create policy rounds_read_own on rounds for select
  using (auth.uid() = user_id);

-- ==================================================== money functions =======

/** Debit a stake. Returns the new balance, or raises on insufficient funds. */
create or replace function place_bet(p_game text, p_wager_px bigint)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_balance bigint;
  v_after bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_wager_px is null or p_wager_px <= 0 then
    raise exception 'wager must be positive' using errcode = '22023';
  end if;
  if exists (select 1 from profiles where id = v_uid and suspended) then
    raise exception 'account suspended' using errcode = '42501';
  end if;

  -- row lock prevents two concurrent spins from spending the same balance
  select balance_px into v_balance from wallets where user_id = v_uid for update;
  if v_balance is null then raise exception 'wallet missing' using errcode = 'P0002'; end if;
  if v_balance < p_wager_px then
    raise exception 'insufficient balance' using errcode = 'P0001';
  end if;

  v_after := v_balance - p_wager_px;
  update wallets
     set balance_px = v_after,
         wagered_px = wagered_px + p_wager_px
   where user_id = v_uid;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (v_uid, 'bet', -p_wager_px, v_after, p_game, jsonb_build_object('game', p_game));

  return v_after;
end $$;

/** Credit a win and record the round. Returns the new balance. */
create or replace function settle_round(
  p_game text,
  p_wager_px bigint,
  p_multiplier numeric,
  p_detail text default null,
  p_nonce bigint default null,
  p_client_seed text default null,
  p_server_seed_hash text default null
)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_mult numeric := coalesce(p_multiplier, 0);
  v_payout bigint;
  v_after bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if v_mult < 0 then raise exception 'multiplier cannot be negative' using errcode = '22023'; end if;

  -- hard ceiling so a malformed multiplier can never mint an absurd payout
  if v_mult > 100000 then v_mult := 100000; end if;

  v_payout := floor(coalesce(p_wager_px, 0) * v_mult)::bigint;

  select balance_px into v_after from wallets where user_id = v_uid for update;
  if v_after is null then raise exception 'wallet missing' using errcode = 'P0002'; end if;

  v_after := v_after + v_payout;
  update wallets
     set balance_px = v_after,
         won_px = won_px + v_payout
   where user_id = v_uid;

  if v_payout > 0 then
    insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
    values (v_uid, 'win', v_payout, v_after, p_game,
            jsonb_build_object('game', p_game, 'multiplier', v_mult));
  end if;

  insert into rounds (user_id, game, wager_px, payout_px, multiplier, nonce, client_seed, server_seed_hash, detail)
  values (v_uid, p_game, coalesce(p_wager_px, 0), v_payout, v_mult, p_nonce, p_client_seed, p_server_seed_hash, p_detail);

  return v_after;
end $$;

/**
 * Send a gift. The money leaves the sender immediately and is held in escrow
 * on the gift row until the recipient claims it, so a declined or expired gift
 * can be returned cleanly.
 */
create or replace function send_gift(p_recipient uuid, p_amount_px bigint, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_balance bigint;
  v_after bigint;
  v_gift uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_recipient is null then raise exception 'recipient required' using errcode = '22023'; end if;
  if p_recipient = v_uid then raise exception 'you cannot gift yourself' using errcode = '22023'; end if;
  if p_amount_px is null or p_amount_px <= 0 then
    raise exception 'gift must be positive' using errcode = '22023';
  end if;
  if not exists (select 1 from profiles where id = p_recipient and not suspended) then
    raise exception 'recipient not found' using errcode = 'P0002';
  end if;

  select balance_px into v_balance from wallets where user_id = v_uid for update;
  if v_balance < p_amount_px then
    raise exception 'insufficient balance' using errcode = 'P0001';
  end if;

  v_after := v_balance - p_amount_px;
  update wallets
     set balance_px = v_after,
         gifted_out_px = gifted_out_px + p_amount_px
   where user_id = v_uid;

  insert into gifts (sender_id, recipient_id, amount_px, note)
  values (v_uid, p_recipient, p_amount_px, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_gift;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (v_uid, 'gift_out', -p_amount_px, v_after, v_gift::text,
          jsonb_build_object('to', p_recipient));

  return v_gift;
end $$;

/** Recipient claims a pending gift. */
create or replace function claim_gift(p_gift uuid)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_gift gifts;
  v_after bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select * into v_gift from gifts where id = p_gift for update;
  if not found then raise exception 'gift not found' using errcode = 'P0002'; end if;
  if v_gift.recipient_id <> v_uid then raise exception 'not your gift' using errcode = '42501'; end if;
  if v_gift.status <> 'pending' then raise exception 'gift already resolved' using errcode = 'P0001'; end if;

  update gifts set status = 'accepted', resolved_at = now() where id = p_gift;

  select balance_px into v_after from wallets where user_id = v_uid for update;
  v_after := v_after + v_gift.amount_px;
  update wallets
     set balance_px = v_after,
         gifted_in_px = gifted_in_px + v_gift.amount_px
   where user_id = v_uid;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (v_uid, 'gift_in', v_gift.amount_px, v_after, p_gift::text,
          jsonb_build_object('from', v_gift.sender_id));

  return v_after;
end $$;

/** Sender cancels, or recipient declines: escrow returns to the sender. */
create or replace function refund_gift(p_gift uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_gift gifts;
  v_after bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select * into v_gift from gifts where id = p_gift for update;
  if not found then raise exception 'gift not found' using errcode = 'P0002'; end if;
  if v_gift.status <> 'pending' then raise exception 'gift already resolved' using errcode = 'P0001'; end if;

  -- either party can unwind a pending gift
  if v_uid not in (v_gift.sender_id, v_gift.recipient_id) then
    raise exception 'not your gift' using errcode = '42501';
  end if;

  update gifts
     set status = case when v_uid = v_gift.recipient_id then 'declined' else 'expired' end,
         resolved_at = now()
   where id = p_gift;

  select balance_px into v_after from wallets where user_id = v_gift.sender_id for update;
  v_after := v_after + v_gift.amount_px;
  update wallets
     set balance_px = v_after,
         gifted_out_px = greatest(0, gifted_out_px - v_gift.amount_px)
   where user_id = v_gift.sender_id;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (v_gift.sender_id, 'gift_in', v_gift.amount_px, v_after, p_gift::text,
          jsonb_build_object('refund_of', p_gift, 'to', v_gift.recipient_id));
end $$;

/**
 * Move PX into a cashout. The money leaves the spendable balance immediately
 * and sits in cashout_hold until the provider confirms, so a player cannot
 * both cash out and keep betting the same PX.
 */
create or replace function request_cashout(
  p_kind cashout_kind,
  p_amount_px bigint,
  p_phone text default null,
  p_rail text default null,
  p_asset text default null,
  p_address text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_balance bigint;
  v_after bigint;
  v_ugx bigint;
  v_profile profiles;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  select * into v_profile from profiles where id = v_uid;
  if v_profile.suspended then raise exception 'account suspended' using errcode = '42501'; end if;
  if not v_profile.age_confirmed then
    raise exception 'confirm you are 18 or older before cashing out' using errcode = '42501';
  end if;
  if not v_profile.phone_verified then
    raise exception 'verify a phone number before cashing out' using errcode = '42501';
  end if;
  if p_amount_px is null or p_amount_px <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;

  -- 10 PX = 1 UGX, rounded down in the house's favour by a whole shilling
  v_ugx := floor(p_amount_px / 10.0)::bigint;
  if v_ugx < 1000 then
    raise exception 'minimum cashout is 10,000 PX (1,000 UGX)' using errcode = '22023';
  end if;

  select balance_px into v_balance from wallets where user_id = v_uid for update;
  if v_balance < p_amount_px then
    raise exception 'insufficient balance' using errcode = 'P0001';
  end if;

  v_after := v_balance - p_amount_px;
  update wallets set balance_px = v_after where user_id = v_uid;

  insert into cashouts (user_id, kind, amount_px, ugx, phone, rail, asset, address)
  values (v_uid, p_kind, p_amount_px, v_ugx, p_phone, p_rail, p_asset, p_address)
  returning id into v_id;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (v_uid, 'cashout_hold', -p_amount_px, v_after, v_id::text,
          jsonb_build_object('ugx', v_ugx, 'kind', p_kind));

  return v_id;
end $$;

/** Service-role only: provider confirmed, finalise the cashout. */
create or replace function settle_cashout(p_cashout uuid, p_status cashout_status, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_co cashouts;
  v_after bigint;
begin
  select * into v_co from cashouts where id = p_cashout for update;
  if not found then raise exception 'cashout not found' using errcode = 'P0002'; end if;
  if v_co.status in ('paid', 'failed', 'cancelled') then return; end if;

  update cashouts
     set status = p_status,
         failure_reason = case when p_status = 'failed' then p_reason else failure_reason end
   where id = p_cashout;

  if p_status = 'paid' then
    update wallets set cashed_out_px = cashed_out_px + v_co.amount_px where user_id = v_co.user_id;
  elsif p_status in ('failed', 'cancelled') then
    -- return held funds to the player
    select balance_px into v_after from wallets where user_id = v_co.user_id for update;
    v_after := v_after + v_co.amount_px;
    update wallets set balance_px = v_after where user_id = v_co.user_id;
    insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
    values (v_co.user_id, 'cashout_refund', v_co.amount_px, v_after, p_cashout::text,
            jsonb_build_object('reason', p_reason));
  end if;
end $$;

-- ================================================ function permissions ======
revoke all on function place_bet(text, bigint) from public;
revoke all on function settle_round(text, bigint, numeric, text, bigint, text, text) from public;
revoke all on function send_gift(uuid, bigint, text) from public;
revoke all on function claim_gift(uuid) from public;
revoke all on function refund_gift(uuid) from public;
revoke all on function request_cashout(cashout_kind, bigint, text, text, text, text) from public;
revoke all on function settle_cashout(uuid, cashout_status, text) from public;

grant execute on function place_bet(text, bigint) to authenticated;
grant execute on function settle_round(text, bigint, numeric, text, bigint, text, text) to authenticated;
grant execute on function send_gift(uuid, bigint, text) to authenticated;
grant execute on function claim_gift(uuid) to authenticated;
grant execute on function refund_gift(uuid) to authenticated;
grant execute on function request_cashout(cashout_kind, bigint, text, text, text, text) to authenticated;
-- settle_cashout is intentionally NOT granted to authenticated clients.

-- ================================================ realtime for chat =========
do $$ begin
  alter publication supabase_realtime add table chat_messages;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table gifts;
exception when duplicate_object then null; end $$;
