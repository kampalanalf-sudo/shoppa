-- 0013_support_usage_error.sql
--
-- Why an agent call failed, recorded on the usage row.
--
-- Four agent calls failed in production on 2026-11-24 and the only evidence was
-- a friendly apology to the player plus two null token columns. The real reason
-- was a 404: Groq retired llama-3.1-8b-instant on 2026-08-16, so every call
-- pointed at a model that no longer existed. Nothing in the database said so.
--
-- The column is plain text rather than an enum because a provider can add error
-- shapes faster than a migration can ship, and a new code must never fail the
-- insert that carries it.

alter table support_agent_usage
  add column if not exists error_code text;

comment on column support_agent_usage.error_code is
  'SupportError code when the model call failed (e.g. SUPPORT_NOT_CONFIGURED, SUPPORT_QUOTA, SUPPORT_ERROR); null when it succeeded.';

-- A failed call has no tokens, so "the agents are broken" is now one query:
-- this index makes that check cheap enough to put on a dashboard.
create index if not exists support_usage_failures
  on support_agent_usage (created_at desc)
  where error_code is not null;
