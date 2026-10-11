-- Schema additions from the pre-launch review (abuse limits, consent records,
-- suppression list, refunds, outbox claiming). Portable: PGlite and Supabase.

-- Marketing consent records (정보통신망법: 동의 일시 보관, 2년마다 재확인).
alter table workspaces add column if not exists marketing_opt_in_at timestamptz;
alter table workspaces add column if not exists marketing_opt_in_source text;

-- Hashed client IP for abuse limits on anonymous endpoints.
alter table tickets add column if not exists ip_hash text;
alter table sales_leads add column if not exists ip_hash text;
alter table leads add column if not exists ip_hash text;
alter table events add column if not exists ip_hash text;
create index if not exists tickets_ip_idx on tickets (ip_hash, created_at);
create index if not exists sales_leads_ip_idx on sales_leads (ip_hash, created_at);
create index if not exists leads_ip_idx on leads (ip_hash, created_at);
create index if not exists events_ip_idx on events (ip_hash, created_at);

-- Every paid model call or generation attempt, counted before the work starts.
create table if not exists generation_attempts (
  id bigserial primary key,
  ip_hash text,
  workspace_id uuid references workspaces(id) on delete set null,
  kind text not null check (kind in ('ai', 'template', 'concierge', 'support_ai')),
  outcome text not null default 'started' check (outcome in ('started', 'ok', 'refused', 'failed')),
  created_at timestamptz not null default now()
);
create index if not exists generation_attempts_ip_idx on generation_attempts (ip_hash, created_at);
create index if not exists generation_attempts_ws_idx on generation_attempts (workspace_id, created_at);

-- Global marketing suppression list. contact = lower(email) or digits-only phone.
create table if not exists marketing_suppressions (
  contact text primary key,
  reason text,
  created_at timestamptz not null default now()
);

-- Refund bookkeeping.
alter table orders add column if not exists refunded_at timestamptz;
alter table orders add column if not exists refund_note text;

-- Outbox rows are claimed ('sending') before delivery so two flushes never send twice.
alter table outbox drop constraint if exists outbox_status_check;
alter table outbox add constraint outbox_status_check check (status in ('pending', 'sending', 'sent', 'failed', 'skipped'));
alter table outbox add column if not exists claimed_at timestamptz;

alter table generation_attempts enable row level security;
alter table marketing_suppressions enable row level security;

-- Supabase only: let the app role through RLS on the new tables.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_user') then
    execute 'drop policy if exists app_all on public.generation_attempts';
    execute 'create policy app_all on public.generation_attempts for all to app_user using (true) with check (true)';
    execute 'drop policy if exists app_all on public.marketing_suppressions';
    execute 'create policy app_all on public.marketing_suppressions for all to app_user using (true) with check (true)';
  end if;
end
$$;
