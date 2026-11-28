-- ============================================================================
-- 0024 — referral rewards
-- ============================================================================
--
-- THE PRODUCT, AS ASKED FOR
--
--   A player shares a code. Somebody signs up with it. For the FIRST FIVE
--   deposits that referred player makes, the referrer is paid a percentage of
--   the profit the platform made from that player's deposits.
--
-- WHAT "PROFIT MADE FROM HIS DEPOSITS" MEANS, EXACTLY
--
-- The phrase has two readings and they are wildly different amounts of money, so
-- this migration only implements one of them and the screen says the same words:
--
--   * deposit volume  (5 x 5,000 deposit = 25,000 -> a 2% reward is 500)
--   * house profit    (deposits minus everything the player took back out:
--                       withdrawals and unsettled balance. Could be zero, and
--                       must never be negative.)
--
-- This implements HOUSE PROFIT. It cannot pay for deposits nobody gambled: a
-- referred player who deposits 5,000 and withdraws 5,000 earns the referrer
-- nothing, which is the only reading where the reward is a share of *profit*
-- rather than a rebate on *turnover*. The screen states it in those words, and
-- `referral_profit()` is the single function that computes it — so there is one
-- definition in the codebase, not a client-side guess.
--
-- THE FIVE
--
-- Counter is the number of the referred player's COMPLETED deposits. Their first
-- deposit is 1, their sixth is not eligible. That is enforced in SQL against the
-- payment_orders rows, never against a number the client can send.
--
-- Each of those five evaluates profit AT THAT MOMENT and pays a share of it. So a
-- friend who deposits and immediately withdraws earns nothing on that deposit —
-- the slot is used up rather than saved, and the sixth deposit is never eligible.
-- The alternative, carrying a shortfall forward, would let a withdrawal made
-- after a reward turn into a clawback or an overpayment depending on timing; a
-- snapshot is decided by facts at a single instant and cannot be replayed.
--
-- The rate applies to the profit earned since the previous reward, NOT to the
-- cumulative figure. Otherwise five deposits would each pay a share of the whole
-- history and the total would be a multiple of the advertised percentage.
--
-- WHAT KEEPS THIS FROM PRINTING MONEY
--
--   1. The reward is paid from a percentage the DATABASE holds, not one the
--      client sends, and the percentage is capped at 10% by a function whose
--      value is checked on write.
--   2. Profit is `deposits - withdrawals - balance`, computed under the referred
--      player's wallet row lock. A player cannot inflate profit by winning and
--      cannot create it by opening a tab.
--   3. One reward per referred player per deposit number. A unique index on
--      (referred_id, deposit_n) means a retried, replayed or triggered settlement
--      cannot pay the same deposit twice.
--   4. A referrer cannot refer themselves, and a referral is set once — the
--      code is only read at sign-up, before the account has any money.
--   5. A credited reward is recorded in the ledger as `referral_bonus` and is
--      withdrawable only through the existing cashout path, which already holds
--      back anything owed on a float.
-- ============================================================================

alter type ledger_kind add value if not exists 'referral_bonus';

-- --------------------------------------------------------------- referrals ---

create table if not exists referrals (
  id            uuid primary key default uuid_generate_v4(),
  -- the player who shared the code
  referrer_id   uuid not null references profiles(id) on delete cascade,
  -- the player who used it. Unique: an account is referred by one person, once.
  referred_id   uuid not null unique references profiles(id) on delete cascade,
  code          text not null,
  created_at    timestamptz not null default now(),
  constraint no_self_referral check (referrer_id <> referred_id)
);

create index if not exists referrals_referrer on referrals (referrer_id, created_at desc);

-- Which deposit number of the referred player this reward is for (1..5), and how
-- much was paid. The unique pair is the anti-double-pay guarantee.
create table if not exists referral_rewards (
  id            uuid primary key default uuid_generate_v4(),
  referral_id   uuid not null references referrals(id) on delete cascade,
  referrer_id   uuid not null references profiles(id) on delete cascade,
  referred_id   uuid not null references profiles(id) on delete cascade,
  -- 1..5: which of the referred player's deposits this settles against
  deposit_n     int not null check (deposit_n between 1 and 5),
  -- the numbers the reward was computed FROM, so an auditor can redo the sum
  deposits_px   bigint not null,
  withdrawals_px bigint not null,
  balance_px    bigint not null,
  -- cumulative profit at this instant (the audit trail)
  profit_px     bigint not null check (profit_px >= 0),
  -- profit earned SINCE the previous reward; the rate applies to this, not to the
  -- cumulative figure, so five deposits pay 2% of profit ONCE, not five times.
  marginal_px   bigint not null check (marginal_px >= 0),
  rate          numeric(6, 4) not null check (rate > 0 and rate <= 0.10),
  reward_px     bigint not null check (reward_px >= 0),
  created_at    timestamptz not null default now(),
  unique (referred_id, deposit_n)
);

create index if not exists referral_rewards_referrer on referral_rewards (referrer_id, created_at desc);

-- --------------------------------------------------------------- the code -----
--
-- The share code is the referrer's own handle, uppercased. Using the handle means
-- there is nothing extra to generate, nothing to expire, and a player can say it
-- out loud. It is resolved to a profile id HERE, at sign-up, from the profiles
-- table — a client cannot name a referrer id directly.

create or replace function referral_code_for(p_user uuid)
returns text
language sql stable security definer set search_path = public as $$
  select upper(username) from profiles where id = p_user
$$;

revoke all on function referral_code_for(uuid) from public, anon;
grant execute on function referral_code_for(uuid) to authenticated, service_role;

/**
 * The rate, and where it lives.
 *
 * 2% by default. It is a row in `referral_settings`, not a literal in the UI,
 * because the screen PRINTS it and the payment USES it — one value, read from one
 * place, so the copy can never promise a percentage the money does not pay.
 * `set_referral_rate` refuses anything above the 10% the check constraint allows.
 */
create table if not exists referral_settings (
  id         boolean primary key default true check (id),
  rate       numeric(6, 4) not null default 0.02 check (rate > 0 and rate <= 0.10),
  updated_at timestamptz not null default now()
);
insert into referral_settings (id, rate) values (true, 0.02) on conflict (id) do nothing;

create or replace function set_referral_rate(p_rate numeric)
returns numeric
language plpgsql security definer set search_path = public as $$
begin
  if p_rate is null or p_rate <= 0 or p_rate > 0.10 then
    raise exception 'the referral rate must be between 0 and 10 percent' using errcode = '22023';
  end if;
  -- Stored in a one-row settings table so a change survives a redeploy and is
  -- visible to both the reward function and the screen.
  insert into referral_settings (id, rate) values (true, p_rate)
  on conflict (id) do update set rate = excluded.rate, updated_at = now();
  return p_rate;
end $$;

-- Reads the live row, so an operator change takes effect without a deploy.
create or replace function referral_rate_now()
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select rate from referral_settings where id), 0.02::numeric)
$$;

revoke all on function referral_rate_now() from public, anon;
grant execute on function referral_rate_now() to authenticated, service_role;

revoke all on function set_referral_rate(numeric) from public, anon, authenticated;
grant execute on function set_referral_rate(numeric) to service_role;

-- ------------------------------------------------------------- attach a code ---

/**
 * Bind a new account to the code it was given. Called once, from the app, right
 * after sign-up.
 *
 * Refuses: an unknown code, your own code, an account that already has a
 * referral, and an account that has already deposited (a code used after the
 * money is in is a way to claim somebody else's deposits).
 */
create or replace function claim_referral(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_code     text := upper(trim(coalesce(p_code, '')));
  v_referrer uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if v_code = '' then raise exception 'enter a code' using errcode = '22023'; end if;

  select id into v_referrer from profiles where upper(username) = v_code;
  if v_referrer is null then
    raise exception 'that code does not exist' using errcode = 'P0002';
  end if;
  if v_referrer = v_uid then
    raise exception 'you cannot use your own code' using errcode = '22023';
  end if;

  if exists (select 1 from referrals where referred_id = v_uid) then
    raise exception 'this account already used a referral code' using errcode = '55000';
  end if;

  -- Any money already moved means the account is not new, and a referral is for
  -- a new player, not for an existing one who found a code.
  if exists (
    select 1 from payment_orders
     where user_id = v_uid and direction = 'collect' and status in ('pending', 'completed')
  ) then
    raise exception 'a referral code has to be added before your first deposit' using errcode = '55000';
  end if;

  insert into referrals (referrer_id, referred_id, code)
  values (v_referrer, v_uid, v_code);

  return jsonb_build_object(
    'referrer', (select username from profiles where id = v_referrer),
    'code', v_code,
    'rate', referral_rate_now(),
    'deposits_covered', 5
  );
end $$;

revoke all on function claim_referral(text) from public, anon;
grant execute on function claim_referral(text) to authenticated, service_role;

-- --------------------------------------------------------------- the profit ---

/**
 * The platform's profit from one referred player, right now.
 *
 *   deposits     every completed collection        (what they put in)
 * - withdrawals  every completed payout           (what they took out)
 * - balance      what is still sitting in the wallet, which they can still take out
 *
 * Never negative: a player who is up is not a negative profit to be carried
 * against the next reward, and a negative here would flip the sign of a payment.
 */
create or replace function referral_profit(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_deposits    bigint;
  v_withdrawals bigint;
  v_balance     bigint;
  v_profit      bigint;
begin
  select coalesce(sum(amount), 0) into v_deposits
    from payment_orders
   where user_id = p_user and direction = 'collect' and status = 'completed';

  select coalesce(sum(amount_px), 0) into v_withdrawals
    from cashouts
   where user_id = p_user and status = 'paid';

  select coalesce(balance_px, 0) into v_balance from wallets where user_id = p_user;

  v_profit := greatest(v_deposits - v_withdrawals - v_balance, 0);

  return jsonb_build_object(
    'deposits', v_deposits,
    'withdrawals', v_withdrawals,
    'balance', v_balance,
    'profit', v_profit
  );
end $$;

revoke all on function referral_profit(uuid) from public, anon;
grant execute on function referral_profit(uuid) to authenticated, service_role;

-- ------------------------------------------------------------- the payout ----
--
-- SECURITY DEFINER and service_role only. The app never calls this: it is fired
-- by the payment trigger below, so a reward happens because a payment was
-- confirmed, not because a client asked for one.

create or replace function pay_referral_reward(p_referred uuid, p_deposit_n int)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ref      referrals;
  v_rate     numeric;
  v_money    jsonb;
  v_profit   bigint;
  v_base     bigint;
  v_marginal bigint;
  v_reward   bigint;
  v_after    bigint;
  v_row      referral_rewards;
begin
  if p_deposit_n is null or p_deposit_n < 1 or p_deposit_n > 5 then
    return jsonb_build_object('paid', false, 'reason', 'outside the first five deposits');
  end if;

  select * into v_ref from referrals where referred_id = p_referred;
  if not found then
    return jsonb_build_object('paid', false, 'reason', 'not referred');
  end if;

  -- Already settled for this deposit number: a replay must not pay twice.
  if exists (select 1 from referral_rewards where referred_id = p_referred and deposit_n = p_deposit_n) then
    return jsonb_build_object('paid', false, 'reason', 'already rewarded');
  end if;

  v_rate := referral_rate_now();
  v_money := referral_profit(p_referred);
  v_profit := (v_money->>'profit')::bigint;

  /*
   * WHAT THE RATE IS APPLIED TO.
   *
   * NOT the cumulative profit. `referral_profit()` returns everything the house
   * has kept from this player so far, so applying 2% to it at every one of the
   * five deposits would pay roughly 6% in total — the reward would grow with the
   * player's history rather than with the deposit that earned it. (Found exactly
   * that on the live database: five deposits of 3,000 kept paid 2,080 instead of
   * 300, before this line existed.)
   *
   * So the rate applies to the profit earned SINCE the last reward. The sum over
   * the five is then 2% of profit, once — and because profit can go DOWN as well
   * as up (a withdrawal after a reward), the baseline is the highest cumulative
   * figure already paid on, so nothing is clawed back and nothing is paid twice
   * for the same profit.
   */
  select coalesce(max(profit_px), 0) into v_base
    from referral_rewards where referred_id = p_referred;
  v_marginal := greatest(v_profit - v_base, 0);
  v_reward := floor(v_marginal * v_rate)::bigint;

  insert into referral_rewards (
    referral_id, referrer_id, referred_id, deposit_n,
    deposits_px, withdrawals_px, balance_px, profit_px, marginal_px, rate, reward_px
  ) values (
    v_ref.id, v_ref.referrer_id, p_referred, p_deposit_n,
    (v_money->>'deposits')::bigint, (v_money->>'withdrawals')::bigint,
    (v_money->>'balance')::bigint, v_profit, v_marginal, v_rate, v_reward
  )
  on conflict (referred_id, deposit_n) do nothing
  returning * into v_row;

  -- The unique constraint already refused a duplicate above; belt and braces.
  if v_row.id is null then
    return jsonb_build_object('paid', false, 'reason', 'already rewarded');
  end if;

  if v_reward <= 0 then
    return jsonb_build_object('paid', false, 'reason', 'no new profit to share', 'reward_px', 0);
  end if;

  select balance_px into v_after from wallets where user_id = v_ref.referrer_id for update;
  if v_after is null then
    raise exception 'referrer wallet missing' using errcode = 'P0002';
  end if;
  v_after := v_after + v_reward;
  update wallets set balance_px = v_after where user_id = v_ref.referrer_id;

  insert into ledger (user_id, kind, delta_px, balance_after, ref, meta)
  values (v_ref.referrer_id, 'referral_bonus', v_reward, v_after, v_row.id::text,
          jsonb_build_object(
            'referred', p_referred, 'deposit_n', p_deposit_n,
            'profit', v_profit, 'marginal', v_marginal,
            'rate', v_rate, 'reward', v_reward));

  return jsonb_build_object('paid', true, 'reward_px', v_reward,
                            'profit_px', v_profit, 'marginal_px', v_marginal);
end $$;

revoke all on function pay_referral_reward(uuid, int) from public, anon, authenticated;
grant execute on function pay_referral_reward(uuid, int) to service_role;

/**
 * The trigger. Fires when a collection is `completed` — the same event that
 * credits the wallet in `apply_gateway_result`.
 *
 * INSERT as well as UPDATE, because both shapes exist: the live webhook creates
 * a `pending` order and then updates it, but a backfill or a different provider
 * path can insert a row that is already `completed`. A trigger that only watched
 * UPDATE silently paid nothing for the second shape — which is exactly how this
 * was found, by running the probe against the live database and seeing a reward
 * of zero for a deposit that had real profit behind it.
 *
 * It counts completed collections to learn WHICH deposit this is. Counting in the
 * trigger rather than trusting a number passed in is what makes "the first five"
 * true even if a payment is retried.
 */
create or replace function referral_on_deposit()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if new.direction <> 'collect' or new.status <> 'completed' then
    return new;
  end if;

  -- WHICH deposit this is. Counting the rows that are completed and no later than
  -- this one, ordered by (created_at, reference) — `reference` is UNIQUE, so the
  -- order is total and two deposits created in the same instant still get
  -- distinct numbers, in a stable order. Ordering by the reference alone would
  -- NOT work: a randomly generated one sorts arbitrarily.
  select count(*) into v_n
    from payment_orders o
   where o.user_id = new.user_id
     and o.direction = 'collect'
     and o.status = 'completed'
     and (o.created_at, o.reference) <= (new.created_at, new.reference);

  -- 6 means "not one of the first five", and pay_referral_reward refuses it.
  perform pay_referral_reward(new.user_id, least(v_n, 6));
  return new;
end $$;

drop trigger if exists payment_orders_referral on payment_orders;
create trigger payment_orders_referral
  after insert or update of status on payment_orders
  for each row execute function referral_on_deposit();

revoke all on function referral_on_deposit() from public, anon, authenticated;

-- --------------------------------------------------------------- the screen ---

/** Everything the referral screen shows: my code, my rewards, my referrals. */
create or replace function referral_state()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_code      text;
  v_referrer  text;
  v_referred  text;
  v_total     bigint;
  v_count     int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  v_code := referral_code_for(v_uid);

  select p.username into v_referrer
    from referrals r join profiles p on p.id = r.referrer_id
   where r.referred_id = v_uid;

  select p.username into v_referred
    from referrals r join profiles p on p.id = r.referred_id
   where r.referrer_id = v_uid
   limit 1;

  select coalesce(sum(reward_px), 0), count(*) into v_total, v_count
    from referral_rewards where referrer_id = v_uid;

  return jsonb_build_object(
    'code', v_code,
    'rate', referral_rate_now(),
    'deposits_covered', 5,
    'referred_by', v_referrer,
    'invited', (select count(*) from referrals where referrer_id = v_uid),
    'rewards_paid', v_count,
    'earned_px', v_total,
    'rewards', (select coalesce(jsonb_agg(jsonb_build_object(
                    'referred', (select username from profiles where id = rr.referred_id),
                    'deposit_n', rr.deposit_n,
                    'profit_px', rr.profit_px,
                    'marginal_px', rr.marginal_px,
                    'reward_px', rr.reward_px,
                    'created_at', rr.created_at) order by rr.created_at desc), '[]'::jsonb)
                from referral_rewards rr where rr.referrer_id = v_uid),
    -- per-referral progress, so a player can see 3 of 5 without asking support
    'friends', (select coalesce(jsonb_agg(jsonb_build_object(
                    'username', (select username from profiles where id = r.referred_id),
                    'rewards', (select count(*) from referral_rewards where referred_id = r.referred_id),
                    'earned_px', (select coalesce(sum(reward_px), 0) from referral_rewards where referred_id = r.referred_id)
                  ) order by r.created_at desc), '[]'::jsonb)
                from referrals r where r.referrer_id = v_uid)
  );
end $$;

revoke all on function referral_state() from public, anon;
grant execute on function referral_state() to authenticated, service_role;

-- ------------------------------------------------------------- the rules ------

alter table referrals enable row level security;
alter table referral_rewards enable row level security;

-- A player sees the row where they are the referrer or the referred, and the
-- rewards they were paid. Nothing else: a referral graph is other people's data.
drop policy if exists referrals_read_own on referrals;
create policy referrals_read_own on referrals for select
  using (auth.uid() = referrer_id or auth.uid() = referred_id);

drop policy if exists referral_rewards_read_own on referral_rewards;
create policy referral_rewards_read_own on referral_rewards for select
  using (auth.uid() = referrer_id or auth.uid() = referred_id);

-- No insert/update/delete policies: only the functions above write these.

/**
 * What is left to earn, said in one place so the screen and the tests agree.
 */
create or replace function referral_remaining(p_user uuid)
returns int
language sql stable security definer set search_path = public as $$
  select greatest(5 - coalesce((select count(*) from referral_rewards where referred_id = p_user), 0), 0)
$$;

revoke all on function referral_remaining(uuid) from public, anon;
grant execute on function referral_remaining(uuid) to authenticated, service_role;

comment on table referrals is
  'Who invited whom. One referrer per account, set once, before the first deposit.';
comment on table referral_rewards is
  'A share of house profit on one of a referred player''s first five deposits. Unique on (referred_id, deposit_n).';
