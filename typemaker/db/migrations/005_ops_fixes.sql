-- Operator-layer fixes from the pre-launch review. Applied on top of 001-004,
-- so everything here is `create or replace` / `if not exists` / `drop ... if exists`
-- and safe to run more than once. Portable: PGlite and Supabase Postgres.
--
-- What changes for the operator (see ops/PLAYBOOK.md):
--   * Admin links (/w/<secret>) never reach the operator or a ticket page any more:
--     ops.dashboard_link_for is gone, ops.send_dashboard_link mails the owner directly,
--     ops.fulfill_generation returns the test id, and operator-written text is
--     refused when it contains an admin link.
--   * Operator-written content and settings are checked as strictly as the app's zod
--     schemas (src/lib/schema.ts), so they can no longer break pages.
--   * Marketing consent: case-insensitive matching, a global suppression list,
--     2-year expiry, result notices, participant withdrawal, legal sender footer.
--   * Plans: grant_plan refuses silent tier changes, bank transfers become real
--     orders, and refunds have a function.

-- ---------------------------------------------------------------- helpers

create or replace function ops.norm_email(p text) returns text
language sql immutable as $$ select nullif(lower(trim(p)), '') $$;

-- Digits only; an international Korean number (+82 10 ...) becomes 010....
create or replace function ops.norm_phone(p text) returns text
language sql immutable as $$
  select case
           when d = '' then null
           when d ~ '^820' then substr(d, 3)
           when d ~ '^82[1-9]' then '0' || substr(d, 3)
           else d
         end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$$;

-- For ops_log, which is kept indefinitely: enough to recognise a contact, not to reuse it.
create or replace function ops.mask_contact(p text) returns text
language sql immutable as $$
  select case
           when p is null then null
           when position('@' in p) > 0 then left(split_part(p, '@', 1), 2) || '***@' || split_part(p, '@', 2)
           else left(ops.norm_phone(p), 3) || '****' || right(ops.norm_phone(p), 4)
         end
$$;

-- String length as JavaScript (and therefore zod's .max()) counts it: UTF-16 code units,
-- so an emoji outside the BMP counts as 2.
create or replace function ops.js_length(s text) returns int
language sql immutable as $$
  select char_length(s) + char_length(regexp_replace(s, '[^\U00010000-\U0010FFFF]', '', 'g'))
$$;

-- Field checks shared by validate_content / validate_settings. Each returns null when the
-- field is fine, otherwise a Korean error naming the field. A missing key is fine unless
-- required; an explicit JSON null is not (zod's .default() only fills in undefined).
create or replace function ops.check_text(p_obj jsonb, p_key text, p_max int, p_required boolean, p_label text) returns text
language plpgsql immutable as $$
declare
  v_len int;
begin
  if p_obj -> p_key is null then
    return case when p_required then p_label || ': 값이 없습니다' end;
  end if;
  if jsonb_typeof(p_obj -> p_key) <> 'string' then return p_label || ': 문자열이어야 합니다'; end if;
  if p_required and trim(p_obj ->> p_key) = '' then return p_label || ': 비었습니다'; end if;
  v_len := ops.js_length(p_obj ->> p_key);
  if v_len > p_max then return p_label || ': ' || p_max || '자 이하로 줄여 주세요 (지금 ' || v_len || '자)'; end if;
  return null;
end
$$;

create or replace function ops.check_bool(p_obj jsonb, p_key text, p_label text) returns text
language sql immutable as $$
  select case when p_obj -> p_key is not null and jsonb_typeof(p_obj -> p_key) <> 'boolean'
              then p_label || ': true 또는 false여야 합니다' end
$$;

create or replace function ops.check_enum(p_obj jsonb, p_key text, p_allowed text[], p_label text) returns text
language sql immutable as $$
  select case when p_obj -> p_key is not null
                   and (jsonb_typeof(p_obj -> p_key) <> 'string' or not ((p_obj ->> p_key) = any(p_allowed)))
              then p_label || ': ' || array_to_string(p_allowed, ', ') || ' 중 하나여야 합니다' end
$$;

create or replace function ops.check_int(p_obj jsonb, p_key text, p_min int, p_max int, p_label text) returns text
language sql immutable as $$
  select case
           when p_obj -> p_key is null then null
           when jsonb_typeof(p_obj -> p_key) <> 'number' then p_label || ': 숫자여야 합니다'
           when (p_obj ->> p_key)::numeric <> trunc((p_obj ->> p_key)::numeric)
             or (p_obj ->> p_key)::numeric not between p_min and p_max
             then p_label || ': ' || p_min || '~' || p_max || ' 사이의 정수여야 합니다'
         end
$$;

-- Mirror of PRODUCTS in src/lib/config.ts. Keep the two in sync.
create or replace function ops.product_info(p_product text, out plan text, out days int, out amount int, out concierge boolean)
language sql immutable as $$
  select v.plan, v.days, v.amount, v.concierge
  from (values
    ('pro_month', 'pro', 30, 49000, false),
    ('pro_year', 'pro', 365, 468000, false),
    ('agency_month', 'agency', 30, 149000, false),
    ('campaign', 'pro', 30, 199000, true)
  ) as v(id, plan, days, amount, concierge)
  where v.id = p_product
$$;

-- Admin links and secret-looking hex strings must never leave through operator-written text
-- (ticket replies are shown to whoever holds the ticket token, and the ticket email is unverified).
create or replace function ops.assert_no_admin_link(p_text text) returns void
language plpgsql immutable as $$
begin
  if p_text ~* '/w/[0-9a-z]' or p_text ~* '[0-9a-f]{32,}' then
    raise exception '관리 링크(/w/…)나 비밀값처럼 보이는 문자열은 답변·메일·콘텐츠에 넣을 수 없습니다. 관리 링크 분실은 ops.send_dashboard_link(이메일)을 쓰세요';
  end if;
end
$$;

-- Marketing consent for one address (정보통신망법 제50조), compared case-insensitively:
--   * not on the suppression list (수신거부 is permanent: an unverified re-tick cannot undo it),
--   * at least one workspace with that email opted in within the last 2 years, and at least
--     kv marketing_confirm_days (default 7) ago, so the consent-result notice reaches the
--     address before any ad and someone opted in by a stranger can object first,
--   * no workspace with that email has marketing turned off (opting out anywhere wins).
create or replace function ops.marketing_allowed(p_email text) returns boolean
language sql stable as $$
  with e as (
    select ops.norm_email(p_email) as v,
           coalesce(nullif(regexp_replace(ops.setting('marketing_confirm_days', '7'), '[^0-9]', '', 'g'), '')::int, 7) as confirm_days
  )
  select e.v is not null
     and not exists (select 1 from public.marketing_suppressions s where s.contact = e.v)
     and exists (
       select 1 from public.workspaces w
        where lower(trim(w.owner_email)) = e.v and not w.is_house
          and w.marketing_opt_in
          and w.marketing_opt_in_at > now() - interval '2 years'
          and w.marketing_opt_in_at <= now() - make_interval(days => e.confirm_days)
     )
     and not exists (
       select 1 from public.workspaces w
        where lower(trim(w.owner_email)) = e.v and not w.is_house and not w.marketing_opt_in
     )
  from e
$$;

-- ---------------------------------------------------------------- content & settings validation

-- Returns null when the content passes TestContentSchema (src/lib/schema.ts), otherwise a
-- Korean error with the JSON path. Slightly stricter in places (blank strings, duplicate
-- option ids in one question), never looser.
create or replace function ops.validate_content(c jsonb) returns text
language plpgsql immutable as $$
declare
  v_err text;
  v_keys text[] := '{}';
  v_used text[] := '{}';
  v_qids text[] := '{}';
  v_oids text[];
  v_r jsonb;
  v_q jsonb;
  v_o jsonb;
  v_w jsonb;
  v_t jsonb;
  v_n int;
  v_m int;
  v_p text;
  v_po text;
  i int;
  j int;
  k int;
begin
  if c is null or jsonb_typeof(c) <> 'object' then return 'content가 JSON 객체가 아닙니다'; end if;
  v_err := coalesce(
    ops.check_text(c, 'title', 60, true, 'title'),
    ops.check_text(c, 'subtitle', 120, false, 'subtitle'),
    ops.check_text(c, 'intro', 400, false, 'intro'));
  if v_err is not null then return v_err; end if;

  if jsonb_typeof(c -> 'results') is distinct from 'array' then return 'results 배열이 없습니다'; end if;
  v_n := jsonb_array_length(c -> 'results');
  if v_n < 2 or v_n > 12 then return 'results는 2~12개여야 합니다 (지금 ' || v_n || '개)'; end if;
  for i in 0 .. v_n - 1 loop
    v_r := c -> 'results' -> i;
    v_p := 'results[' || i || ']';
    if jsonb_typeof(v_r) <> 'object' then return v_p || ': 객체가 아닙니다'; end if;
    if jsonb_typeof(v_r -> 'key') is distinct from 'string' or (v_r ->> 'key') !~ '^[a-z0-9_-]{1,20}$' then
      return v_p || '.key: 영문 소문자·숫자·_·- 1~20자여야 합니다 (' || coalesce((v_r -> 'key')::text, '없음') || ')';
    end if;
    if (v_r ->> 'key') = any(v_keys) then return '결과 key 중복: ' || (v_r ->> 'key'); end if;
    v_keys := v_keys || (v_r ->> 'key');
    v_err := coalesce(
      ops.check_text(v_r, 'name', 40, true, v_p || '.name'),
      ops.check_text(v_r, 'emoji', 8, false, v_p || '.emoji'),
      ops.check_text(v_r, 'tagline', 100, false, v_p || '.tagline'),
      ops.check_text(v_r, 'description', 900, false, v_p || '.description'));
    if v_err is not null then return v_err; end if;
    if v_r -> 'traits' is not null then
      if jsonb_typeof(v_r -> 'traits') <> 'array' then return v_p || '.traits: 배열이어야 합니다'; end if;
      if jsonb_array_length(v_r -> 'traits') > 6 then return v_p || '.traits: 6개 이하여야 합니다'; end if;
      for v_t in select value from jsonb_array_elements(v_r -> 'traits') loop
        if jsonb_typeof(v_t) <> 'string' then return v_p || '.traits: 문자열만 넣을 수 있습니다'; end if;
        if ops.js_length(v_t #>> '{}') > 40 then return v_p || '.traits: 항목마다 40자 이하여야 합니다'; end if;
      end loop;
    end if;
    if v_r -> 'bestMatch' is not null and jsonb_typeof(v_r -> 'bestMatch') not in ('string', 'null') then
      return v_p || '.bestMatch: 결과 key 문자열이나 null이어야 합니다';
    end if;
    if v_r -> 'color' is not null
       and (jsonb_typeof(v_r -> 'color') <> 'string' or (v_r ->> 'color') !~ '^#[0-9a-fA-F]{6}$') then
      return v_p || '.color: #RRGGBB 형식이어야 합니다 (' || (v_r -> 'color')::text || ')';
    end if;
  end loop;

  if jsonb_typeof(c -> 'questions') is distinct from 'array' then return 'questions 배열이 없습니다'; end if;
  v_n := jsonb_array_length(c -> 'questions');
  if v_n < 3 or v_n > 15 then return 'questions는 3~15개여야 합니다 (지금 ' || v_n || '개)'; end if;
  for i in 0 .. v_n - 1 loop
    v_q := c -> 'questions' -> i;
    v_p := 'questions[' || i || ']';
    if jsonb_typeof(v_q) <> 'object' then return v_p || ': 객체가 아닙니다'; end if;
    v_err := coalesce(
      ops.check_text(v_q, 'id', 20, true, v_p || '.id'),
      ops.check_text(v_q, 'text', 140, true, v_p || '.text'));
    if v_err is not null then return v_err; end if;
    if (v_q ->> 'id') = any(v_qids) then return '질문 id 중복: ' || (v_q ->> 'id'); end if;
    v_qids := v_qids || (v_q ->> 'id');
    if jsonb_typeof(v_q -> 'options') is distinct from 'array' then return v_p || '.options 배열이 없습니다'; end if;
    v_m := jsonb_array_length(v_q -> 'options');
    if v_m < 2 or v_m > 4 then return v_p || '.options: 보기는 2~4개여야 합니다 (지금 ' || v_m || '개)'; end if;
    v_oids := '{}';
    for j in 0 .. v_m - 1 loop
      v_o := v_q -> 'options' -> j;
      v_po := v_p || '.options[' || j || ']';
      if jsonb_typeof(v_o) <> 'object' then return v_po || ': 객체가 아닙니다'; end if;
      v_err := coalesce(
        ops.check_text(v_o, 'id', 20, true, v_po || '.id'),
        ops.check_text(v_o, 'text', 100, true, v_po || '.text'));
      if v_err is not null then return v_err; end if;
      if (v_o ->> 'id') = any(v_oids) then return v_po || '.id: 같은 질문 안에서 보기 id가 겹칩니다 (' || (v_o ->> 'id') || ')'; end if;
      v_oids := v_oids || (v_o ->> 'id');
      if jsonb_typeof(v_o -> 'weights') is distinct from 'array'
         or jsonb_array_length(v_o -> 'weights') not between 1 and 3 then
        return v_po || '.weights: 1~3개 배열이어야 합니다';
      end if;
      for k in 0 .. jsonb_array_length(v_o -> 'weights') - 1 loop
        v_w := v_o -> 'weights' -> k;
        if jsonb_typeof(v_w) <> 'object' then return v_po || '.weights[' || k || ']: 객체가 아닙니다'; end if;
        if jsonb_typeof(v_w -> 'key') is distinct from 'string' or not ((v_w ->> 'key') = any(v_keys)) then
          return v_po || '.weights[' || k || '].key: 없는 결과 key를 가리킵니다 (' || coalesce((v_w -> 'key')::text, '없음') || ')';
        end if;
        if (case when jsonb_typeof(v_w -> 'points') = 'number'
                 then (v_w ->> 'points')::numeric not in (1, 2, 3)
                 else true end) then
          return v_po || '.weights[' || k || '].points: 숫자 1, 2, 3 중 하나여야 합니다 (' || coalesce((v_w -> 'points')::text, '없음') || ')';
        end if;
        v_used := v_used || (v_w ->> 'key');
      end loop;
    end loop;
  end loop;

  for i in 1 .. coalesce(array_length(v_keys, 1), 0) loop
    if not (v_keys[i] = any(v_used)) then return '어떤 보기로도 나올 수 없는 결과: ' || v_keys[i]; end if;
  end loop;
  return null;
end
$$;

-- Returns null when the settings pass SettingsSchema (src/lib/schema.ts), otherwise a Korean
-- error. parseSettings() silently replaces the whole object with defaults on any error, so a
-- single bad field would switch off the lead form and coupon without anyone noticing.
-- With p_content, coupon.perResult keys must also be result keys of that content.
create or replace function ops.validate_settings(s jsonb, p_content jsonb default null) returns text
language plpgsql immutable as $$
declare
  v_err text;
  v_sec jsonb;
  v_x jsonb;
  v_k text;
begin
  if s is null then return null; end if;
  if jsonb_typeof(s) <> 'object' then return 'settings가 JSON 객체가 아닙니다'; end if;
  v_err := ops.check_text(s, 'brandName', 40, false, 'brandName');
  if v_err is not null then return v_err; end if;

  v_sec := s -> 'theme';
  if v_sec is not null then
    if jsonb_typeof(v_sec) <> 'object' then return 'theme: 객체여야 합니다'; end if;
    if v_sec -> 'accent' is not null
       and (jsonb_typeof(v_sec -> 'accent') <> 'string' or (v_sec ->> 'accent') !~ '^#[0-9a-fA-F]{6}$') then
      return 'theme.accent: #RRGGBB 형식이어야 합니다 (' || (v_sec -> 'accent')::text || ')';
    end if;
    v_err := ops.check_enum(v_sec, 'style', array['pop', 'calm', 'night'], 'theme.style');
    if v_err is not null then return v_err; end if;
  end if;

  v_sec := s -> 'lead';
  if v_sec is not null then
    if jsonb_typeof(v_sec) <> 'object' then return 'lead: 객체여야 합니다'; end if;
    v_err := coalesce(
      ops.check_bool(v_sec, 'enabled', 'lead.enabled'),
      ops.check_text(v_sec, 'purpose', 200, false, 'lead.purpose'),
      ops.check_int(v_sec, 'retentionDays', 30, 1095, 'lead.retentionDays'),
      ops.check_bool(v_sec, 'askMarketing', 'lead.askMarketing'),
      ops.check_enum(v_sec, 'placement', array['before_result', 'after_result'], 'lead.placement'),
      ops.check_text(v_sec, 'headline', 60, false, 'lead.headline'));
    if v_err is not null then return v_err; end if;
    if v_sec -> 'fields' is not null then
      if jsonb_typeof(v_sec -> 'fields') <> 'array' or jsonb_array_length(v_sec -> 'fields') < 1 then
        return 'lead.fields: name, phone, email 중 1개 이상을 담은 배열이어야 합니다';
      end if;
      for v_x in select value from jsonb_array_elements(v_sec -> 'fields') loop
        if jsonb_typeof(v_x) <> 'string' or not ((v_x #>> '{}') = any(array['name', 'phone', 'email'])) then
          return 'lead.fields: name, phone, email만 넣을 수 있습니다 (' || v_x::text || ')';
        end if;
      end loop;
    end if;
  end if;

  v_sec := s -> 'coupon';
  if v_sec is not null then
    if jsonb_typeof(v_sec) <> 'object' then return 'coupon: 객체여야 합니다'; end if;
    v_err := coalesce(
      ops.check_bool(v_sec, 'enabled', 'coupon.enabled'),
      ops.check_text(v_sec, 'title', 40, false, 'coupon.title'),
      ops.check_text(v_sec, 'code', 40, false, 'coupon.code'),
      ops.check_bool(v_sec, 'requireLead', 'coupon.requireLead'),
      ops.check_text(v_sec, 'note', 200, false, 'coupon.note'));
    if v_err is not null then return v_err; end if;
    if v_sec -> 'perResult' is not null then
      if jsonb_typeof(v_sec -> 'perResult') <> 'object' then return 'coupon.perResult: {"결과key": "코드"} 객체여야 합니다'; end if;
      for v_k, v_x in select key, value from jsonb_each(v_sec -> 'perResult') loop
        if jsonb_typeof(v_x) <> 'string' or ops.js_length(v_x #>> '{}') > 40 then
          return 'coupon.perResult.' || v_k || ': 40자 이하 문자열이어야 합니다';
        end if;
        if p_content is not null
           and not exists (select 1 from jsonb_array_elements(p_content -> 'results') r where r ->> 'key' = v_k) then
          return 'coupon.perResult.' || v_k || ': content에 없는 결과 key입니다';
        end if;
      end loop;
    end if;
    if (v_sec ->> 'enabled') = 'true'
       and coalesce(trim(v_sec ->> 'code'), '') = ''
       and not exists (select 1 from jsonb_each_text(coalesce(v_sec -> 'perResult', '{}'::jsonb)) e where trim(e.value) <> '') then
      return 'coupon: enabled인데 code와 perResult가 모두 비었습니다';
    end if;
  end if;

  v_sec := s -> 'cta';
  if v_sec is not null then
    if jsonb_typeof(v_sec) <> 'object' then return 'cta: 객체여야 합니다'; end if;
    v_err := coalesce(
      ops.check_bool(v_sec, 'enabled', 'cta.enabled'),
      ops.check_text(v_sec, 'label', 30, false, 'cta.label'),
      ops.check_text(v_sec, 'url', 500, false, 'cta.url'));
    if v_err is not null then return v_err; end if;
    if coalesce(v_sec ->> 'url', '') <> '' and (v_sec ->> 'url') !~ '^(https?://[^[:space:]]+|/([^/[:space:]][^[:space:]]*)?)$' then
      return 'cta.url: https:// 로 시작하는 주소나 /로 시작하는 사이트 안 경로여야 합니다';
    end if;
    if (v_sec ->> 'enabled') = 'true' and coalesce(v_sec ->> 'url', '') = '' then
      return 'cta: enabled인데 url이 비었습니다';
    end if;
  end if;
  return null;
end
$$;

-- ---------------------------------------------------------------- concierge & house tests

-- Returns the new test's id. The admin link goes only to the workspace owner's email
-- (and the draft is listed in their dashboard); the operator never sees it.
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
  v_err := ops.validate_settings(p_settings, p_content);
  if v_err is not null then raise exception 'invalid settings: %', v_err; end if;
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
  perform ops.log('fulfill_generation', jsonb_build_object('request', p_request, 'test', v_test, 'emailed', v_w.owner_email is not null));
  return v_test::text;
end
$$;

create or replace function ops.create_house_test(p_content jsonb, p_settings jsonb default '{}'::jsonb, p_gallery boolean default true)
returns text language plpgsql as $$
declare
  v_err text;
  v_slug text;
begin
  v_err := ops.validate_content(p_content);
  if v_err is not null then raise exception 'invalid content: %', v_err; end if;
  v_err := ops.validate_settings(p_settings, p_content);
  if v_err is not null then raise exception 'invalid settings: %', v_err; end if;
  v_slug := ops.new_slug();
  insert into public.tests (workspace_id, slug, status, content, settings, source, in_gallery, published_at)
  values (ops.house_workspace(), v_slug, 'published', p_content, coalesce(p_settings, '{}'::jsonb), 'ops', p_gallery, now());
  perform ops.log('create_house_test', jsonb_build_object('slug', v_slug, 'title', p_content->>'title'));
  return ops.app_url() || '/t/' || v_slug;
end
$$;

-- ---------------------------------------------------------------- support

-- Returned the admin link to the operator, who then pasted it into a ticket reply that the
-- (unverified) ticket author could read. Replaced by ops.send_dashboard_link.
drop function if exists ops.dashboard_link_for(text);

-- Lost admin link: mails the links straight to the stored owner address of every workspace
-- whose owner_email matches (case-insensitive). Returns how many workspaces matched, never a
-- link. At most one such mail per address per hour. Reply on the ticket with the same generic
-- sentence whatever the count is, so the reply does not reveal whether the address is registered.
create or replace function ops.send_dashboard_link(p_email text) returns int
language plpgsql as $$
declare
  v_email text := ops.norm_email(p_email);
  v_n int;
  v_links text;
  v_to text;
  v_queued boolean := false;
begin
  if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception '이메일 형식이 아닙니다: %', p_email;
  end if;
  select count(*),
         string_agg('- ' || coalesce(nullif(trim(brand_name), ''), '이름 없는 워크스페이스')
                    || ' (' || to_char(created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') || ' 생성)' || E'\n  '
                    || ops.app_url() || '/w/' || secret, E'\n' order by last_seen_at desc),
         (array_agg(trim(owner_email) order by last_seen_at desc))[1]
    into v_n, v_links, v_to
    from public.workspaces
   where owner_email is not null and lower(trim(owner_email)) = v_email and not is_house;
  if v_n > 0 and not exists (
    select 1 from public.outbox
     where ref = 'dashboard_link' and lower(trim(to_email)) = v_email and created_at > now() - interval '1 hour'
  ) then
    insert into public.outbox (to_email, subject, body_text, kind, ref)
    values (
      v_to,
      '[' || ops.brand() || '] 관리 링크 안내',
      '안녕하세요, ' || ops.brand() || '입니다.' || E'\n\n'
        || '요청에 따라 이 이메일 주소로 등록된 워크스페이스의 관리 링크를 보내 드려요.' || E'\n\n'
        || v_links || E'\n\n'
        || '이 링크만 있으면 누구나 테스트와 참여자 정보를 관리할 수 있어요. 다른 사람과 공유하지 마세요.' || E'\n'
        || '직접 요청하지 않으셨다면 이 메일은 지우셔도 됩니다. 링크는 이 주소로만 발송됩니다.' || E'\n\n'
        || '※ 발신 전용 메일입니다.',
      'transactional', 'dashboard_link'
    );
    v_queued := true;
  end if;
  perform ops.log('send_dashboard_link', jsonb_build_object('email', ops.mask_contact(v_email), 'workspaces', v_n, 'queued', v_queued));
  return v_n;
end
$$;

create or replace function ops.reply_ticket(p_ticket uuid, p_body text, p_status text default 'answered')
returns void language plpgsql as $$
declare
  v_t public.tickets;
begin
  if p_status not in ('answered', 'escalated', 'closed', 'open') then raise exception 'invalid status %', p_status; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'empty reply'; end if;
  perform ops.assert_no_admin_link(p_body);
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

-- ---------------------------------------------------------------- marketing consent

-- Generic email. Marketing mail (정보통신망법 제50조, 시행령 별표 6) only goes to addresses
-- that pass ops.marketing_allowed, at most once per 30 days, with "(광고)" at the start of the
-- subject and the sender's name, contact details (kv sender_contact) and a working opt-out
-- route in the body. Replies are not read, so the opt-out route is the support page.
create or replace function ops.queue_email(p_to text, p_subject text, p_body text, p_kind text default 'transactional')
returns bigint language plpgsql as $$
declare
  v_id bigint;
  v_to text := trim(p_to);
  v_norm text := ops.norm_email(p_to);
  v_subject text := p_subject;
  v_body text := p_body;
  v_contact text;
begin
  if p_kind not in ('transactional', 'support', 'sales', 'marketing') then raise exception 'invalid kind %', p_kind; end if;
  if v_norm is null or v_norm !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'invalid email %', p_to; end if;
  if coalesce(trim(p_subject), '') = '' or coalesce(trim(p_body), '') = '' then raise exception 'empty subject or body'; end if;
  perform ops.assert_no_admin_link(p_subject || E'\n' || p_body);
  if p_kind = 'marketing' then
    if not ops.marketing_allowed(v_to) then
      raise exception '% 주소에는 광고성 메일을 보낼 수 없습니다 (수신 동의가 없거나 2년이 지났거나 동의 후 확인 기간 전이거나, 수신을 거부함)', p_to;
    end if;
    if exists (
      select 1 from public.outbox
       where kind = 'marketing' and status in ('pending', 'sending', 'sent')
         and lower(trim(to_email)) = v_norm and created_at > now() - interval '30 days'
    ) then
      raise exception '% 주소에는 최근 30일 안에 광고성 메일을 이미 보냈습니다', p_to;
    end if;
    v_contact := trim(ops.setting('sender_contact', ''));
    if v_contact = '' then
      raise exception 'kv sender_contact(사업자명·주소·전화번호·이메일)가 등록되지 않아 광고성 메일을 보낼 수 없습니다. 대표에게 등록을 요청하세요';
    end if;
    v_subject := '(광고) ' || p_subject;
    v_body := p_body || E'\n\n' || '──────────' || E'\n'
      || '전송자: ' || ops.brand() || E'\n'
      || '연락처: ' || v_contact || E'\n'
      || '이 메일은 ' || ops.brand() || '의 새 기능·할인 소식 수신에 동의하신 분께 보내 드렸습니다.' || E'\n'
      || '수신거부(Unsubscribe): ' || ops.app_url() || '/support 에서 내용에 "수신거부"와 이 이메일 주소를 적어 보내 주시면 바로 발송을 멈춥니다. 비용은 들지 않습니다.' || E'\n'
      || '이 메일은 발신 전용이라 회신으로는 수신거부를 받을 수 없습니다.';
  end if;
  insert into public.outbox (to_email, subject, body_text, kind) values (v_to, v_subject, v_body, p_kind)
  returning id into v_id;
  perform ops.log('queue_email', jsonb_build_object('id', v_id, 'kind', p_kind));
  return v_id;
end
$$;

-- 수신거부 from a workspace owner (or anyone giving an email address). Puts the address on the
-- suppression list, turns marketing off on every workspace with that email (case-insensitive),
-- and cancels marketing mail still waiting in the outbox. Returns the number of workspaces with
-- that email; 0 means the address owns no workspace (check withdraw_lead_marketing next), but
-- the address is suppressed either way.
create or replace function ops.unsubscribe(p_email text) returns int
language plpgsql as $$
declare
  v_email text := ops.norm_email(p_email);
  v_n int;
  v_changed int;
  v_cancelled int;
begin
  if v_email is null or position('@' in v_email) = 0 then raise exception '이메일 주소가 필요합니다: %', p_email; end if;
  insert into public.marketing_suppressions (contact, reason) values (v_email, 'unsubscribe')
  on conflict (contact) do nothing;
  update public.workspaces
     set marketing_opt_in = false, marketing_opt_in_at = null, marketing_opt_in_source = 'unsubscribe'
   where lower(trim(owner_email)) = v_email and marketing_opt_in;
  get diagnostics v_changed = row_count;
  select count(*) into v_n from public.workspaces where lower(trim(owner_email)) = v_email and not is_house;
  update public.outbox set status = 'skipped', error = 'unsubscribed'
   where kind = 'marketing' and status = 'pending' and lower(trim(to_email)) = v_email;
  get diagnostics v_cancelled = row_count;
  perform ops.log('unsubscribe', jsonb_build_object('email', ops.mask_contact(v_email), 'workspaces', v_n, 'turned_off', v_changed, 'cancelled_mail', v_cancelled));
  return v_n;
end
$$;

-- 수신거부 from a test participant (a lead). p_contact is an email or a phone number in any
-- format. Withdraws marketing and night-time consent on every matching lead, suppresses the
-- contact, cancels queued marketing mail to it, and tells each affected creator (the
-- controller of that lead) by email so they can remove it from lists they already exported.
-- Returns the number of matching leads; 0 means no lead has that contact.
create or replace function ops.withdraw_lead_marketing(p_contact text) returns int
language plpgsql as $$
declare
  v_email text;
  v_phone text;
  v_n int;
  v_changed int;
  v_cancelled int := 0;
  v_date text := to_char(now() at time zone 'Asia/Seoul', 'YYYY"년" FMMM"월" FMDD"일"');
  r record;
begin
  if coalesce(trim(p_contact), '') = '' then raise exception '연락처(이메일 또는 전화번호)가 필요합니다'; end if;
  if position('@' in p_contact) > 0 then
    v_email := ops.norm_email(p_contact);
  else
    v_phone := ops.norm_phone(p_contact);
    if v_phone is null or length(v_phone) < 8 then raise exception '전화번호 형식이 아닙니다: %', p_contact; end if;
  end if;

  select count(*) into v_n from public.leads l
   where (v_email is not null and lower(trim(l.email)) = v_email)
      or (v_phone is not null and ops.norm_phone(l.phone) = v_phone);

  -- Suppress the contact as given and as stored on each lead (digits-only phone / lower email).
  insert into public.marketing_suppressions (contact, reason)
  select distinct x.c, 'lead_withdrawal'
    from (
      select coalesce(v_email, v_phone) as c
      union
      select regexp_replace(l.phone, '[^0-9]', '', 'g') from public.leads l
       where v_phone is not null and ops.norm_phone(l.phone) = v_phone
    ) x
   where coalesce(x.c, '') <> ''
  on conflict (contact) do nothing;

  for r in
    select w.owner_email,
           string_agg(distinct coalesce(t.content->>'title', '(제목 없음)'), '」, 「') as titles
      from public.leads l
      join public.workspaces w on w.id = l.workspace_id
      join public.tests t on t.id = l.test_id
     where (l.consent_marketing or l.consent_night)
       and ((v_email is not null and lower(trim(l.email)) = v_email)
         or (v_phone is not null and ops.norm_phone(l.phone) = v_phone))
       and w.owner_email is not null
     group by w.id, w.owner_email
  loop
    insert into public.outbox (to_email, subject, body_text, kind, ref)
    values (
      r.owner_email,
      '[' || ops.brand() || '] 참여자의 광고 수신 동의 철회 안내',
      '안녕하세요, ' || ops.brand() || '입니다.' || E'\n\n'
        || '운영 중인 테스트 「' || r.titles || '」에 참여한 ' || coalesce(v_email, p_contact) || ' 님이 '
        || v_date || '에 광고성 정보 수신 동의를 철회했습니다.' || E'\n'
        || '대시보드와 내려받기 파일에서 이 참여자의 광고 수신 동의는 이제 ''미동의''로 표시됩니다.' || E'\n\n'
        || '이미 내려받은 명단이나 문자·이메일 발송 도구에 이 연락처가 있다면 지금 발송 대상에서 빼 주세요. '
        || '동의를 철회한 분께 광고를 보내면 정보통신망법 위반이 될 수 있습니다.' || E'\n\n'
        || '※ 발신 전용 메일입니다.',
      'transactional', 'lead_withdrawal'
    );
  end loop;

  update public.leads set consent_marketing = false, consent_night = false
   where (consent_marketing or consent_night)
     and ((v_email is not null and lower(trim(email)) = v_email)
       or (v_phone is not null and ops.norm_phone(phone) = v_phone));
  get diagnostics v_changed = row_count;

  if v_email is not null then
    update public.outbox set status = 'skipped', error = 'unsubscribed'
     where kind = 'marketing' and status = 'pending' and lower(trim(to_email)) = v_email;
    get diagnostics v_cancelled = row_count;
  end if;
  perform ops.log('withdraw_lead_marketing', jsonb_build_object('contact', ops.mask_contact(coalesce(v_email, v_phone)), 'leads', v_n, 'withdrawn', v_changed, 'cancelled_mail', v_cancelled));
  return v_n;
end
$$;

-- Free workspaces worth a nudge: only addresses that pass ops.marketing_allowed and have not
-- had a marketing mail in the last 30 days. Same leading columns as before.
create or replace view ops.upgrade_candidates as
select
  w.id as workspace_id, w.owner_email, w.brand_name, w.plan, w.plan_expires_at, w.created_at,
  count(distinct t.id) filter (where t.status = 'published') as published_tests,
  (select count(*) from public.events e join public.tests t2 on t2.id = e.test_id where t2.workspace_id = w.id and e.type = 'view') as views,
  (select count(*) from public.leads l where l.workspace_id = w.id) as leads,
  bool_or((t.settings->'lead'->>'enabled')::boolean) as uses_lead_form,
  bool_or((t.settings->'coupon'->>'enabled')::boolean) as uses_coupon,
  w.marketing_opt_in_at,
  (select max(o.created_at) from public.outbox o
    where o.kind = 'marketing' and o.status in ('pending', 'sending', 'sent')
      and lower(trim(o.to_email)) = lower(trim(w.owner_email))) as last_marketing_at
from public.workspaces w
left join public.tests t on t.workspace_id = w.id
where not w.is_house
  and w.owner_email is not null
  and w.marketing_opt_in
  and ops.marketing_allowed(w.owner_email)
  and (w.plan = 'free' or w.plan_expires_at is null or w.plan_expires_at < now())
  and not exists (
    select 1 from public.outbox o
     where o.kind = 'marketing' and o.status in ('pending', 'sending', 'sent')
       and lower(trim(o.to_email)) = lower(trim(w.owner_email))
       and o.created_at > now() - interval '30 days')
group by w.id
having count(distinct t.id) filter (where t.status = 'published') > 0
order by leads desc, views desc;

-- Consent bookkeeping on the workspace row itself, so every path (app create/profile forms,
-- ops.unsubscribe, retention jobs) is covered:
--   * a withdrawal, or an address change, cancels marketing mail still queued for the old address;
--   * every opt-in and opt-out sends the result notice 정보통신망법 제50조 제7항 requires
--     (sender, date, result), at most one of each kind per address per day.
-- Lives in public with invoker rights because it fires inside the app role's own statements.
create or replace function public.workspaces_marketing_consent() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_brand text := coalesce((select value from public.kv where key = 'brand_name'), '유형공장');
  v_url text := coalesce((select value from public.kv where key = 'app_url'), 'http://localhost:3000');
  v_contact text := coalesce((select nullif(trim(value), '') from public.kv where key = 'sender_contact'), '');
  v_date text := to_char(now() at time zone 'Asia/Seoul', 'YYYY"년" FMMM"월" FMDD"일"');
  v_old_email text;
  v_new_email text := nullif(trim(new.owner_email), '');
  v_notice text;
  v_to text;
begin
  if new.is_house then return null; end if;
  if tg_op = 'UPDATE' then
    v_old_email := nullif(trim(old.owner_email), '');
    if old.marketing_opt_in and v_old_email is not null
       and (not new.marketing_opt_in or lower(v_old_email) is distinct from lower(v_new_email)) then
      update public.outbox set status = 'skipped', error = 'consent withdrawn'
       where kind = 'marketing' and status = 'pending' and lower(trim(to_email)) = lower(v_old_email);
    end if;
  end if;

  if new.marketing_opt_in and v_new_email is not null
     and (tg_op = 'INSERT' or not old.marketing_opt_in or lower(v_new_email) is distinct from lower(v_old_email)) then
    v_notice := 'in';
    v_to := v_new_email;
  elsif tg_op = 'UPDATE' and old.marketing_opt_in and not new.marketing_opt_in
        and v_old_email is not null and v_new_email is not null then
    v_notice := 'out';
    v_to := v_old_email;
  else
    return null;
  end if;

  if exists (
    select 1 from public.outbox
     where ref = 'consent:' || v_notice and lower(trim(to_email)) = lower(v_to) and created_at > now() - interval '1 day'
  ) then
    return null;
  end if;

  insert into public.outbox (to_email, subject, body_text, kind, ref)
  values (
    v_to,
    '[' || v_brand || '] 광고성 정보 수신 ' || case when v_notice = 'in' then '동의' else '거부' end || ' 처리 결과 안내',
    '안녕하세요, ' || v_brand || '입니다.' || E'\n\n'
      || case when v_notice = 'in' then
           v_date || '에 이 이메일 주소(' || v_to || ')로 ' || v_brand || '의 새 기능·할인 소식(광고성 정보) 이메일 수신 동의가 접수됐습니다.' || E'\n\n'
           || '- 전송자: ' || v_brand || E'\n' || '- 처리 일자: ' || v_date || E'\n' || '- 처리 결과: 수신 동의' || E'\n\n'
           || '동의한 적이 없거나 더 이상 받고 싶지 않으시면 ' || v_url || '/support 에서 내용에 "수신거부"와 이 이메일 주소를 적어 보내 주세요. 바로 처리해 드립니다.'
         else
           v_date || '에 이 이메일 주소(' || v_to || ')의 광고성 정보 수신 거부(동의 철회)가 처리됐습니다. 앞으로 광고성 메일은 보내지 않습니다.' || E'\n\n'
           || '- 전송자: ' || v_brand || E'\n' || '- 처리 일자: ' || v_date || E'\n' || '- 처리 결과: 수신 거부' || E'\n\n'
           || '결제 영수증, 문의 답변처럼 서비스 이용에 필요한 안내는 계속 보내 드립니다.'
         end
      || case when v_contact <> '' then E'\n\n' || '연락처: ' || v_contact else '' end
      || E'\n\n' || '※ 발신 전용 메일입니다.',
    'transactional', 'consent:' || v_notice
  );
  return null;
end
$$;

drop trigger if exists workspaces_marketing_consent on public.workspaces;
create trigger workspaces_marketing_consent
  after insert or update of marketing_opt_in, owner_email on public.workspaces
  for each row execute function public.workspaces_marketing_consent();

-- ---------------------------------------------------------------- sales, plans, refunds

create or replace function ops.update_sales_lead(
  p_id uuid, p_status text, p_note text default null, p_reply_subject text default null, p_reply_body text default null
) returns void language plpgsql as $$
declare
  v_s public.sales_leads;
begin
  select * into v_s from public.sales_leads where id = p_id for update;
  if not found then raise exception 'sales lead % not found', p_id; end if;
  if p_reply_body is not null then perform ops.assert_no_admin_link(coalesce(p_reply_subject, '') || E'\n' || p_reply_body); end if;
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

-- The old 4-argument version would make calls ambiguous next to the new one.
drop function if exists ops.grant_plan(uuid, text, int, text);

-- Extends (or sets) a plan. Changing the tier of a plan that is still running (agency -> pro,
-- pro -> agency, anything -> free) is refused unless p_force: with p_force the remaining days
-- carry over at the new tier, so only use it on the owner's explicit decision.
create or replace function ops.grant_plan(p_workspace uuid, p_plan text, p_days int, p_note text, p_force boolean default false)
returns timestamptz language plpgsql as $$
declare
  v_w public.workspaces;
  v_until timestamptz;
begin
  if p_plan not in ('free', 'pro', 'agency') then raise exception 'invalid plan %', p_plan; end if;
  if p_plan <> 'free' and (p_days is null or p_days < 1 or p_days > 3660) then
    raise exception 'p_days는 1~3660이어야 합니다 (지금 %)', p_days;
  end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'p_note에 대표 승인 근거를 적어 주세요'; end if;
  select * into v_w from public.workspaces where id = p_workspace for update;
  if not found then raise exception 'workspace % not found', p_workspace; end if;
  if v_w.plan <> 'free' and v_w.plan_expires_at > now() and v_w.plan <> p_plan and not p_force then
    raise exception '이 워크스페이스는 % 플랜을 %까지 이용 중입니다. %(으)로 바꾸면 남은 기간도 %(으)로 바뀝니다. 대표가 그렇게 하라고 한 경우에만 p_force => true로 다시 실행하세요',
      v_w.plan, to_char(v_w.plan_expires_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'), p_plan, p_plan;
  end if;
  update public.workspaces
     set plan = p_plan,
         plan_expires_at = case when p_plan = 'free' then null
                                else greatest(coalesce(plan_expires_at, now()), now()) + make_interval(days => p_days) end
   where id = p_workspace
  returning plan_expires_at into v_until;
  perform ops.log('grant_plan', jsonb_build_object(
    'workspace', p_workspace, 'plan', p_plan, 'days', p_days, 'note', p_note, 'force', p_force,
    'plan_before', v_w.plan, 'until_before', v_w.plan_expires_at, 'until_after', v_until));
  return v_until;
end
$$;

-- Bank-transfer purchase the owner has confirmed: records a paid order (so it shows in
-- ops.summary revenue and can be refunded with ops.refund_order) and applies the product's
-- plan and days from ops.product_info. For the campaign pass it also opens the concierge
-- sales lead, exactly like a card payment does. p_amount defaults to the list price.
create or replace function ops.fulfill_manual_order(
  p_workspace uuid, p_product text, p_note text, p_amount int default null, p_force boolean default false
) returns jsonb language plpgsql as $$
declare
  v_p record;
  v_w public.workspaces;
  v_amount int;
  v_order text;
  v_until timestamptz;
begin
  select * into v_p from ops.product_info(p_product);
  if v_p.plan is null then raise exception '알 수 없는 상품입니다: % (pro_month, pro_year, agency_month, campaign 중 하나)', p_product; end if;
  select * into v_w from public.workspaces where id = p_workspace;
  if not found then raise exception 'workspace % not found', p_workspace; end if;
  if v_w.is_house then raise exception '운영용 워크스페이스에는 주문을 넣을 수 없습니다'; end if;
  v_amount := coalesce(p_amount, v_p.amount);
  if v_amount < 1 or v_amount > v_p.amount then
    raise exception '입금액은 1~%원이어야 합니다 (지금 %원)', v_p.amount, v_amount;
  end if;
  v_until := ops.grant_plan(p_workspace, v_p.plan, v_p.days, coalesce(p_note, '') || ' (주문: ' || p_product || ')', p_force);
  v_order := 'bank_' || to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDD') || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  insert into public.orders (order_id, workspace_id, product, amount, status, provider, customer_email, raw, paid_at)
  values (v_order, p_workspace, p_product, v_amount, 'paid', 'bank_transfer', v_w.owner_email,
          jsonb_build_object('source', 'ops.fulfill_manual_order', 'note', p_note), now());
  if v_p.concierge then
    insert into public.sales_leads (workspace_id, email, product, message, source, status)
    values (p_workspace, coalesce(v_w.owner_email, 'unknown@invalid'), 'campaign', '캠페인 패스 계좌이체 입금 확인 — 기획 대행 착수 필요', 'order', 'new');
  end if;
  perform ops.log('fulfill_manual_order', jsonb_build_object('order', v_order, 'workspace', p_workspace, 'product', p_product, 'amount', v_amount));
  return jsonb_build_object('order_id', v_order, 'product', p_product, 'amount', v_amount, 'plan', v_p.plan, 'plan_until', v_until, 'concierge', v_p.concierge);
end
$$;

-- Owner-approved refund, after the money has been returned (Toss dashboard or bank). Marks the
-- order refunded (ops.summary stops counting it as revenue), takes back the days it added, and
-- drops the workspace to free when nothing is left. Refunding an agency order while the
-- workspace still has time left and no other agency order from the last 30 days turns the rest
-- into pro (the remaining time most likely came from pro purchases). A campaign-pass refund
-- also cancels its queued concierge work. Returns before/after so the owner can check it.
create or replace function ops.refund_order(p_order_id text, p_reason text) returns jsonb
language plpgsql as $$
declare
  v_o public.orders;
  v_p record;
  v_w public.workspaces;
  v_until timestamptz;
  v_plan text;
  v_note text;
  v_cancelled int := 0;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'p_reason에 환불 사유와 대표 승인 내용을 적어 주세요'; end if;
  select * into v_o from public.orders where order_id = p_order_id or id::text = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  if v_o.status = 'refunded' then raise exception '이미 환불 처리된 주문입니다 (%)', v_o.refunded_at; end if;
  if v_o.status <> 'paid' then raise exception '결제 완료(paid) 주문만 환불 처리할 수 있습니다 (지금 %)', v_o.status; end if;
  select * into v_p from ops.product_info(v_o.product);
  if v_p.plan is null then raise exception 'unknown product %', v_o.product; end if;
  select * into v_w from public.workspaces where id = v_o.workspace_id for update;

  update public.orders set status = 'refunded', refunded_at = now(), refund_note = p_reason where id = v_o.id;

  v_until := v_w.plan_expires_at - make_interval(days => v_p.days);
  if v_w.plan = 'free' or v_w.plan_expires_at is null or v_until <= now() then
    v_plan := 'free';
    v_until := null;
  elsif v_w.plan = 'agency' and v_p.plan = 'agency' and not exists (
    select 1 from public.orders o
     where o.workspace_id = v_w.id and o.id <> v_o.id and o.status = 'paid'
       and o.product = 'agency_month' and o.paid_at > now() - interval '30 days'
  ) then
    v_plan := 'pro';
    v_note := '대행사 결제를 환불해 남은 기간을 프로로 바꿨습니다. 다른 대행사 이용권(장애 보상 등)이 남아 있었다면 대표 확인 후 grant_plan(..., p_force => true)로 바로잡으세요';
  else
    v_plan := v_w.plan;
  end if;
  update public.workspaces set plan = v_plan, plan_expires_at = v_until where id = v_w.id;

  if v_p.concierge then
    update public.generation_requests set status = 'cancelled', note = concat_ws(' / ', note, '캠페인 패스 환불로 취소')
     where workspace_id = v_w.id and status = 'queued' and priority and created_at >= coalesce(v_o.paid_at, v_o.created_at);
    get diagnostics v_cancelled = row_count;
    update public.sales_leads set status = 'lost', note = concat_ws(' / ', note, '환불'), updated_at = now()
     where workspace_id = v_w.id and source = 'order' and product = 'campaign' and status in ('new', 'contacted')
       and created_at >= coalesce(v_o.paid_at, v_o.created_at) - interval '1 minute';
  end if;

  perform ops.log('refund_order', jsonb_build_object(
    'order', v_o.order_id, 'product', v_o.product, 'amount', v_o.amount, 'reason', p_reason,
    'plan_before', v_w.plan, 'until_before', v_w.plan_expires_at, 'plan_after', v_plan, 'until_after', v_until));
  return jsonb_build_object(
    'order_id', v_o.order_id, 'product', v_o.product, 'amount', v_o.amount,
    'plan_before', v_w.plan, 'until_before', v_w.plan_expires_at,
    'plan_after', v_plan, 'until_after', v_until,
    'concierge_requests_cancelled', v_cancelled, 'note', v_note);
end
$$;

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
    'orders_refunded', (select count(*) from public.orders where status = 'refunded' and refunded_at > v_since),
    'refunded_krw', (select coalesce(sum(amount), 0) from public.orders where status = 'refunded' and refunded_at > v_since),
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

-- ---------------------------------------------------------------- outbox & content

-- Mail status without bodies: some bodies (link recovery, concierge drafts) carry admin links.
create or replace view ops.outbox_recent as
select id, to_email, kind, status, subject, attempts, error, ref, created_at, sent_at
from public.outbox
order by id desc;

create or replace function ops.add_content(
  p_channel text, p_body text, p_title text default null, p_test_slug text default null,
  p_asset_url text default null, p_scheduled_for timestamptz default null
) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  perform ops.assert_no_admin_link(concat_ws(E'\n', p_title, p_body, p_asset_url));
  insert into public.content_queue (channel, test_id, title, body, asset_url, scheduled_for)
  values (p_channel, (select id from public.tests where slug = p_test_slug), p_title, p_body, p_asset_url, p_scheduled_for)
  returning id into v_id;
  perform ops.log('add_content', jsonb_build_object('id', v_id, 'channel', p_channel));
  return v_id;
end
$$;

-- ---------------------------------------------------------------- search_path

-- Pin search_path on every operator function (Supabase linter 0011), as in 003_harden.sql.
do $$
declare
  f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'ops' loop
    execute format('alter function %s set search_path = pg_catalog, public', f);
  end loop;
end
$$;
