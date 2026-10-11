-- Operator layer. Claude (or the owner) runs the business through these
-- views and functions, e.g. via the Supabase MCP `execute_sql` tool.
-- Every write goes through a function so the rules live in one place and
-- every action is recorded in ops_log.

create schema if not exists ops;

create or replace function ops.setting(p_key text, p_default text) returns text
language sql stable as $$
  select coalesce((select value from public.kv where key = p_key), p_default)
$$;

create or replace function ops.app_url() returns text
language sql stable as $$ select ops.setting('app_url', 'http://localhost:3000') $$;

create or replace function ops.brand() returns text
language sql stable as $$ select ops.setting('brand_name', '유형공장') $$;

create or replace function ops.log(p_action text, p_detail jsonb) returns void
language sql as $$ insert into public.ops_log (action, detail) values (p_action, p_detail) $$;

create or replace function ops.new_secret() returns text
language sql volatile as $$
  select replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
$$;

create or replace function ops.new_slug() returns text
language plpgsql volatile as $$
declare
  v_slug text;
begin
  loop
    v_slug := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    exit when not exists (select 1 from public.tests where slug = v_slug);
  end loop;
  return v_slug;
end
$$;

-- Returns null when the content is playable, otherwise a Korean error message.
create or replace function ops.validate_content(c jsonb) returns text
language plpgsql immutable as $$
declare
  v_keys text[] := '{}';
  v_used text[] := '{}';
  v_q jsonb;
  v_o jsonb;
  v_w jsonb;
  v_r jsonb;
  v_n int;
begin
  if c is null or jsonb_typeof(c) <> 'object' then return 'content가 객체가 아닙니다'; end if;
  if coalesce(trim(c->>'title'), '') = '' then return 'title이 비었습니다'; end if;
  if jsonb_typeof(c->'results') <> 'array' then return 'results 배열이 없습니다'; end if;
  v_n := jsonb_array_length(c->'results');
  if v_n < 2 or v_n > 12 then return 'results는 2~12개여야 합니다'; end if;
  for v_r in select * from jsonb_array_elements(c->'results') loop
    if coalesce(v_r->>'key', '') !~ '^[a-z0-9_-]{1,20}$' then return '결과 key 형식 오류: ' || coalesce(v_r->>'key', 'null'); end if;
    if (v_r->>'key') = any(v_keys) then return '결과 key 중복: ' || (v_r->>'key'); end if;
    if coalesce(trim(v_r->>'name'), '') = '' then return '결과 이름이 비었습니다: ' || (v_r->>'key'); end if;
    v_keys := v_keys || (v_r->>'key');
  end loop;
  if jsonb_typeof(c->'questions') <> 'array' then return 'questions 배열이 없습니다'; end if;
  v_n := jsonb_array_length(c->'questions');
  if v_n < 3 or v_n > 15 then return 'questions는 3~15개여야 합니다'; end if;
  for v_q in select * from jsonb_array_elements(c->'questions') loop
    if coalesce(trim(v_q->>'text'), '') = '' then return '질문 문구가 비었습니다'; end if;
    if jsonb_typeof(v_q->'options') <> 'array' then return '보기 배열이 없습니다: ' || (v_q->>'text'); end if;
    v_n := jsonb_array_length(v_q->'options');
    if v_n < 2 or v_n > 4 then return '보기는 2~4개여야 합니다: ' || (v_q->>'text'); end if;
    for v_o in select * from jsonb_array_elements(v_q->'options') loop
      if coalesce(trim(v_o->>'text'), '') = '' then return '보기 문구가 비었습니다'; end if;
      if jsonb_typeof(v_o->'weights') <> 'array' or jsonb_array_length(v_o->'weights') < 1 then
        return '보기에 weights가 없습니다: ' || (v_o->>'text');
      end if;
      for v_w in select * from jsonb_array_elements(v_o->'weights') loop
        if not ((v_w->>'key') = any(v_keys)) then return '없는 결과 key를 가리킵니다: ' || coalesce(v_w->>'key', 'null'); end if;
        if coalesce((v_w->>'points')::int, 0) not between 1 and 3 then return 'points는 1~3이어야 합니다'; end if;
        v_used := v_used || (v_w->>'key');
      end loop;
    end loop;
  end loop;
  for v_r in select * from jsonb_array_elements(c->'results') loop
    if not ((v_r->>'key') = any(v_used)) then return '어떤 보기로도 나올 수 없는 결과: ' || (v_r->>'key'); end if;
  end loop;
  return null;
end
$$;

create or replace function ops.house_workspace() returns uuid
language plpgsql volatile as $$
declare
  v_id uuid;
begin
  select id into v_id from public.workspaces where is_house order by created_at limit 1;
  if v_id is null then
    insert into public.workspaces (secret, brand_name, plan, is_house)
    values (ops.new_secret(), ops.brand(), 'agency', true)
    returning id into v_id;
  end if;
  return v_id;
end
$$;

-- ---------------------------------------------------------------- summary

create or replace function ops.summary(p_days int default 7) returns jsonb
language plpgsql stable as $$
declare
  v_since timestamptz := now() - make_interval(days => p_days);
begin
  return jsonb_build_object(
    'days', p_days,
    'workspaces_new', (select count(*) from public.workspaces where not is_house and created_at > v_since),
    'tests_created', (select count(*) from public.tests t join public.workspaces w on w.id = t.workspace_id where not w.is_house and t.created_at > v_since),
    'tests_published', (select count(*) from public.tests t join public.workspaces w on w.id = t.workspace_id where not w.is_house and t.published_at > v_since),
    'views', (select count(*) from public.events where type = 'view' and created_at > v_since),
    'starts', (select count(*) from public.events where type = 'start' and created_at > v_since),
    'completes', (select count(*) from public.events where type = 'complete' and created_at > v_since),
    'shares', (select count(*) from public.events where type = 'share' and created_at > v_since),
    'watermark_clicks', (select count(*) from public.events where type = 'watermark_click' and created_at > v_since),
    'leads', (select count(*) from public.leads where created_at > v_since),
    'orders_paid', (select count(*) from public.orders where status = 'paid' and paid_at > v_since),
    'revenue_krw', (select coalesce(sum(amount), 0) from public.orders where status = 'paid' and paid_at > v_since),
    'paying_workspaces', (select count(*) from public.workspaces where not is_house and plan <> 'free' and plan_expires_at > now()),
    'tickets_waiting', (select count(*) from public.tickets where status in ('open', 'escalated')),
    'tickets_escalated', (select count(*) from public.tickets where status = 'escalated'),
    'sales_leads_new', (select count(*) from public.sales_leads where status = 'new'),
    'generation_queue', (select count(*) from public.generation_requests where status = 'queued'),
    'outbox_pending', (select count(*) from public.outbox where status = 'pending'),
    'content_drafts', (select count(*) from public.content_queue where status in ('draft', 'approved'))
  );
end
$$;

-- ---------------------------------------------------------------- support

create or replace view ops.open_tickets as
select
  t.id, t.status, t.category, t.subject, t.email, t.name,
  t.workspace_id, w.plan, w.plan_expires_at, t.created_at, t.updated_at,
  (select jsonb_agg(jsonb_build_object('role', m.role, 'body', m.body, 'at', m.created_at) order by m.id)
     from public.ticket_messages m where m.ticket_id = t.id) as messages
from public.tickets t
left join public.workspaces w on w.id = t.workspace_id
where t.status in ('open', 'escalated')
order by t.created_at;

create or replace function ops.reply_ticket(p_ticket uuid, p_body text, p_status text default 'answered')
returns void language plpgsql as $$
declare
  v_t public.tickets;
begin
  if p_status not in ('answered', 'escalated', 'closed', 'open') then raise exception 'invalid status %', p_status; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'empty reply'; end if;
  select * into v_t from public.tickets where id = p_ticket for update;
  if not found then raise exception 'ticket % not found', p_ticket; end if;
  insert into public.ticket_messages (ticket_id, role, body) values (p_ticket, 'operator', p_body);
  update public.tickets set status = p_status, updated_at = now() where id = p_ticket;
  if v_t.email is not null then
    insert into public.outbox (to_email, subject, body_text, kind, ref)
    values (
      v_t.email,
      '[' || ops.brand() || '] 문의 답변: ' || v_t.subject,
      '안녕하세요, ' || ops.brand() || '입니다.' || E'\n\n' || p_body || E'\n\n'
        || '대화 전체 보기·추가 문의: ' || ops.app_url() || '/support/' || v_t.token || E'\n\n'
        || '※ 발신 전용 메일입니다. 위 링크에서 답장해 주세요.',
      'support', 'ticket:' || p_ticket
    );
  end if;
  perform ops.log('reply_ticket', jsonb_build_object('ticket', p_ticket, 'status', p_status));
end
$$;

-- Hand a ticket to the human owner (refunds, legal, anything uncertain).
create or replace function ops.escalate_ticket(p_ticket uuid, p_reason text) returns void
language plpgsql as $$
begin
  update public.tickets set status = 'escalated', updated_at = now() where id = p_ticket;
  if not found then raise exception 'ticket % not found', p_ticket; end if;
  perform ops.log('escalate_ticket', jsonb_build_object('ticket', p_ticket, 'reason', p_reason));
end
$$;

-- ---------------------------------------------------------------- concierge generation

create or replace view ops.generation_queue as
select g.id, g.priority, g.brief, g.created_at, g.workspace_id, w.plan, w.owner_email, w.brand_name
from public.generation_requests g
join public.workspaces w on w.id = g.workspace_id
where g.status = 'queued'
order by g.priority desc, g.created_at;

create or replace function ops.fulfill_generation(p_request uuid, p_content jsonb, p_settings jsonb default null)
returns text language plpgsql as $$
declare
  v_g public.generation_requests;
  v_w public.workspaces;
  v_err text;
  v_test uuid;
  v_slug text;
begin
  select * into v_g from public.generation_requests where id = p_request for update;
  if not found then raise exception 'request % not found', p_request; end if;
  if v_g.status <> 'queued' then raise exception 'request % is %', p_request, v_g.status; end if;
  v_err := ops.validate_content(p_content);
  if v_err is not null then raise exception 'invalid content: %', v_err; end if;
  select * into v_w from public.workspaces where id = v_g.workspace_id;
  v_slug := ops.new_slug();
  insert into public.tests (workspace_id, slug, status, content, settings, brief, source)
  values (v_g.workspace_id, v_slug, 'draft', p_content, coalesce(p_settings, '{}'::jsonb), v_g.brief, 'concierge')
  returning id into v_test;
  update public.generation_requests set status = 'done', test_id = v_test, done_at = now() where id = p_request;
  if v_w.owner_email is not null then
    insert into public.outbox (to_email, subject, body_text, kind, ref)
    values (
      v_w.owner_email,
      '[' || ops.brand() || '] 요청하신 테스트 초안이 준비됐어요',
      '안녕하세요, ' || ops.brand() || '입니다.' || E'\n\n'
        || '요청하신 「' || (p_content->>'title') || '」 초안을 만들었습니다. 아래 링크에서 문구를 확인·수정한 뒤 발행해 주세요.' || E'\n\n'
        || ops.app_url() || '/w/' || v_w.secret || '/t/' || v_test || E'\n\n'
        || '이 링크는 관리자 링크이니 다른 사람과 공유하지 마세요.',
      'transactional', 'generation:' || p_request
    );
  end if;
  perform ops.log('fulfill_generation', jsonb_build_object('request', p_request, 'test', v_test));
  return ops.app_url() || '/w/' || v_w.secret || '/t/' || v_test;
end
$$;

-- Concierge request created by the operator (e.g. after a 캠페인 패스 purchase).
create or replace function ops.create_concierge_request(p_workspace uuid, p_brief jsonb, p_note text default null)
returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.workspaces where id = p_workspace) then
    raise exception 'workspace % not found', p_workspace;
  end if;
  insert into public.generation_requests (workspace_id, brief, priority, note)
  values (p_workspace, p_brief, true, p_note)
  returning id into v_id;
  perform ops.log('create_concierge_request', jsonb_build_object('request', v_id, 'workspace', p_workspace));
  return v_id;
end
$$;

-- Look up the dashboard link for a workspace when the requester's email matches its owner.
create or replace function ops.dashboard_link_for(p_email text) returns setof text
language sql stable as $$
  select ops.app_url() || '/w/' || secret from public.workspaces
  where owner_email is not null and lower(owner_email) = lower(trim(p_email)) and not is_house
  order by last_seen_at desc
$$;

-- ---------------------------------------------------------------- promotion

-- Publish a test authored by the operator into the public gallery (SEO + social content).
create or replace function ops.create_house_test(p_content jsonb, p_settings jsonb default '{}'::jsonb, p_gallery boolean default true)
returns text language plpgsql as $$
declare
  v_err text;
  v_slug text;
begin
  v_err := ops.validate_content(p_content);
  if v_err is not null then raise exception 'invalid content: %', v_err; end if;
  v_slug := ops.new_slug();
  insert into public.tests (workspace_id, slug, status, content, settings, source, in_gallery, published_at)
  values (ops.house_workspace(), v_slug, 'published', p_content, coalesce(p_settings, '{}'::jsonb), 'ops', p_gallery, now());
  perform ops.log('create_house_test', jsonb_build_object('slug', v_slug, 'title', p_content->>'title'));
  return ops.app_url() || '/t/' || v_slug;
end
$$;

create or replace view ops.test_performance as
select
  t.slug, t.content->>'title' as title, t.source, t.in_gallery, w.is_house, t.published_at,
  count(*) filter (where e.type = 'view') as views,
  count(*) filter (where e.type = 'start') as starts,
  count(*) filter (where e.type = 'complete') as completes,
  count(*) filter (where e.type = 'share') as shares,
  count(*) filter (where e.type = 'watermark_click') as watermark_clicks,
  round(100.0 * count(*) filter (where e.type = 'complete') / nullif(count(*) filter (where e.type = 'start'), 0), 1) as completion_pct,
  round(100.0 * count(*) filter (where e.type = 'share') / nullif(count(*) filter (where e.type = 'complete'), 0), 1) as share_pct
from public.tests t
join public.workspaces w on w.id = t.workspace_id
left join public.events e on e.test_id = t.id and e.created_at > now() - interval '30 days'
where t.status = 'published'
group by t.id, w.is_house
order by views desc;

create or replace function ops.add_content(
  p_channel text, p_body text, p_title text default null, p_test_slug text default null,
  p_asset_url text default null, p_scheduled_for timestamptz default null
) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.content_queue (channel, test_id, title, body, asset_url, scheduled_for)
  values (p_channel, (select id from public.tests where slug = p_test_slug), p_title, p_body, p_asset_url, p_scheduled_for)
  returning id into v_id;
  perform ops.log('add_content', jsonb_build_object('id', v_id, 'channel', p_channel));
  return v_id;
end
$$;

create or replace function ops.mark_content(p_id uuid, p_status text, p_posted_url text default null) returns void
language plpgsql as $$
begin
  update public.content_queue
     set status = p_status, posted_url = coalesce(p_posted_url, posted_url),
         posted_at = case when p_status = 'posted' then now() else posted_at end
   where id = p_id;
  if not found then raise exception 'content % not found', p_id; end if;
  perform ops.log('mark_content', jsonb_build_object('id', p_id, 'status', p_status));
end
$$;

-- ---------------------------------------------------------------- sales

create or replace view ops.sales_inbox as
select s.*, w.plan, w.plan_expires_at, w.secret is not null as has_workspace
from public.sales_leads s
left join public.workspaces w on w.id = s.workspace_id
where s.status in ('new', 'contacted')
order by s.created_at;

create or replace function ops.update_sales_lead(
  p_id uuid, p_status text, p_note text default null, p_reply_subject text default null, p_reply_body text default null
) returns void language plpgsql as $$
declare
  v_s public.sales_leads;
begin
  select * into v_s from public.sales_leads where id = p_id for update;
  if not found then raise exception 'sales lead % not found', p_id; end if;
  update public.sales_leads
     set status = p_status, note = coalesce(p_note, note), updated_at = now()
   where id = p_id;
  if p_reply_body is not null then
    -- The person asked us to contact them, so this is a reply, not an unsolicited ad.
    insert into public.outbox (to_email, subject, body_text, kind, ref)
    values (v_s.email, coalesce(p_reply_subject, '[' || ops.brand() || '] 문의 주신 내용 안내'), p_reply_body, 'sales', 'sales:' || p_id);
  end if;
  perform ops.log('update_sales_lead', jsonb_build_object('id', p_id, 'status', p_status, 'replied', p_reply_body is not null));
end
$$;

-- Free workspaces worth a nudge. Only people who opted in to marketing are listed.
create or replace view ops.upgrade_candidates as
select
  w.id as workspace_id, w.owner_email, w.brand_name, w.plan, w.plan_expires_at, w.created_at,
  count(distinct t.id) filter (where t.status = 'published') as published_tests,
  (select count(*) from public.events e join public.tests t2 on t2.id = e.test_id where t2.workspace_id = w.id and e.type = 'view') as views,
  (select count(*) from public.leads l where l.workspace_id = w.id) as leads,
  bool_or((t.settings->'lead'->>'enabled')::boolean) as uses_lead_form,
  bool_or((t.settings->'coupon'->>'enabled')::boolean) as uses_coupon
from public.workspaces w
left join public.tests t on t.workspace_id = w.id
where not w.is_house
  and w.owner_email is not null
  and w.marketing_opt_in
  and (w.plan = 'free' or w.plan_expires_at is null or w.plan_expires_at < now())
group by w.id
having count(distinct t.id) filter (where t.status = 'published') > 0
order by leads desc, views desc;

create or replace function ops.grant_plan(p_workspace uuid, p_plan text, p_days int, p_note text) returns timestamptz
language plpgsql as $$
declare
  v_until timestamptz;
begin
  if p_plan not in ('free', 'pro', 'agency') then raise exception 'invalid plan %', p_plan; end if;
  update public.workspaces
     set plan = p_plan,
         plan_expires_at = case when p_plan = 'free' then null
                                else greatest(coalesce(plan_expires_at, now()), now()) + make_interval(days => p_days) end
   where id = p_workspace
  returning plan_expires_at into v_until;
  if not found then raise exception 'workspace % not found', p_workspace; end if;
  perform ops.log('grant_plan', jsonb_build_object('workspace', p_workspace, 'plan', p_plan, 'days', p_days, 'note', p_note));
  return v_until;
end
$$;

-- Generic email. Marketing mail only goes to people who opted in (정보통신망법 제50조),
-- gets the "(광고)" prefix and an opt-out line.
create or replace function ops.queue_email(p_to text, p_subject text, p_body text, p_kind text default 'transactional')
returns bigint language plpgsql as $$
declare
  v_id bigint;
  v_subject text := p_subject;
  v_body text := p_body;
begin
  if p_kind not in ('transactional', 'support', 'sales', 'marketing') then raise exception 'invalid kind %', p_kind; end if;
  if p_kind = 'marketing' then
    if not exists (select 1 from public.workspaces where owner_email = p_to and marketing_opt_in) then
      raise exception '% has not opted in to marketing email', p_to;
    end if;
    v_subject := '(광고) ' || p_subject;
    v_body := p_body || E'\n\n' || '수신을 원하지 않으시면 이 메일에 "수신거부"라고 회신하거나 '
      || ops.app_url() || '/support 에서 요청해 주세요. 발신: ' || ops.brand();
  end if;
  insert into public.outbox (to_email, subject, body_text, kind) values (p_to, v_subject, v_body, p_kind)
  returning id into v_id;
  perform ops.log('queue_email', jsonb_build_object('id', v_id, 'kind', p_kind));
  return v_id;
end
$$;

create or replace function ops.unsubscribe(p_email text) returns int
language plpgsql as $$
declare
  v_n int;
begin
  update public.workspaces set marketing_opt_in = false where owner_email = p_email;
  get diagnostics v_n = row_count;
  perform ops.log('unsubscribe', jsonb_build_object('email', p_email, 'rows', v_n));
  return v_n;
end
$$;

-- ---------------------------------------------------------------- housekeeping

create or replace function ops.purge_expired_leads() returns int
language plpgsql as $$
declare
  v_n int;
begin
  delete from public.leads where delete_after < now();
  get diagnostics v_n = row_count;
  if v_n > 0 then perform ops.log('purge_expired_leads', jsonb_build_object('rows', v_n)); end if;
  return v_n;
end
$$;
