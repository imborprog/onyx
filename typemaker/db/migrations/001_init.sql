-- 유형공장 (typemaker) schema. Portable between Supabase Postgres and PGlite.
-- App tables live in `public` with RLS enabled (no anon policies), so the
-- Supabase REST API cannot read them. Operator views/functions live in `ops`.

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  secret text not null unique,
  owner_email text,
  brand_name text,
  plan text not null default 'free' check (plan in ('free', 'pro', 'agency')),
  plan_expires_at timestamptz,
  marketing_opt_in boolean not null default false,
  is_house boolean not null default false,
  ip_hash text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists tests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  slug text not null unique,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  content jsonb not null,
  settings jsonb not null default '{}'::jsonb,
  brief jsonb not null default '{}'::jsonb,
  source text not null default 'ai' check (source in ('ai', 'template', 'ops', 'concierge')),
  in_gallery boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists tests_workspace_idx on tests (workspace_id);
create index if not exists tests_gallery_idx on tests (status, in_gallery);

create table if not exists events (
  id bigserial primary key,
  test_id uuid not null references tests(id) on delete cascade,
  type text not null check (type in ('view', 'start', 'complete', 'share', 'watermark_click', 'cta_click', 'lead_submit', 'coupon_reveal')),
  result_key text,
  channel text,
  session_id text,
  created_at timestamptz not null default now()
);
create index if not exists events_test_type_idx on events (test_id, type);
create index if not exists events_created_idx on events (created_at);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references tests(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  result_key text,
  name text,
  phone text,
  email text,
  consent_privacy boolean not null,
  consent_marketing boolean not null default false,
  consent_night boolean not null default false,
  age_over_14 boolean not null,
  delete_after timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists leads_workspace_idx on leads (workspace_id, created_at);
create index if not exists leads_test_idx on leads (test_id, created_at);

create table if not exists generation_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brief jsonb not null,
  priority boolean not null default false,
  status text not null default 'queued' check (status in ('queued', 'done', 'failed', 'cancelled')),
  test_id uuid references tests(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  workspace_id uuid references workspaces(id) on delete set null,
  email text,
  name text,
  category text not null default 'general' check (category in ('general', 'billing', 'bug', 'sales', 'refund', 'privacy')),
  subject text not null,
  status text not null default 'open' check (status in ('open', 'answered', 'escalated', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ticket_messages (
  id bigserial primary key,
  ticket_id uuid not null references tickets(id) on delete cascade,
  role text not null check (role in ('customer', 'ai', 'operator')),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists ticket_messages_ticket_idx on ticket_messages (ticket_id, id);

create table if not exists sales_leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete set null,
  name text,
  company text,
  email text not null,
  phone text,
  product text,
  message text,
  source text not null default 'contact',
  status text not null default 'new' check (status in ('new', 'contacted', 'won', 'lost')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product text not null,
  amount integer not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
  provider text not null default 'toss',
  payment_key text,
  customer_email text,
  raw jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists outbox (
  id bigserial primary key,
  to_email text not null,
  subject text not null,
  body_text text not null,
  kind text not null default 'transactional' check (kind in ('transactional', 'support', 'sales', 'marketing')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  error text,
  ref text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists outbox_status_idx on outbox (status, id);

create table if not exists content_queue (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('instagram', 'threads', 'tiktok', 'naver_blog', 'x', 'community', 'kmong', 'other')),
  test_id uuid references tests(id) on delete set null,
  title text,
  body text not null,
  asset_url text,
  status text not null default 'draft' check (status in ('draft', 'approved', 'posted', 'skipped')),
  scheduled_for timestamptz,
  posted_url text,
  created_at timestamptz not null default now(),
  posted_at timestamptz
);

create table if not exists ops_log (
  id bigserial primary key,
  actor text not null default 'claude',
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists kv (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table workspaces enable row level security;
alter table tests enable row level security;
alter table events enable row level security;
alter table leads enable row level security;
alter table generation_requests enable row level security;
alter table tickets enable row level security;
alter table ticket_messages enable row level security;
alter table sales_leads enable row level security;
alter table orders enable row level security;
alter table outbox enable row level security;
alter table content_queue enable row level security;
alter table ops_log enable row level security;
alter table kv enable row level security;
