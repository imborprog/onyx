-- Run once on Supabase (as postgres) after the migrations.
-- Creates the login role the app uses through the Supavisor pooler, and keeps the
-- Supabase REST API (anon / authenticated) away from app data and the ops schema.
-- Replace REPLACE_WITH_STRONG_PASSWORD with a generated secret; never commit it.

create role app_user login password 'REPLACE_WITH_STRONG_PASSWORD' noinherit;

grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant usage, select on all sequences in schema public to app_user;
alter default privileges in schema public grant select, insert, update, delete on tables to app_user;
alter default privileges in schema public grant usage, select on sequences to app_user;

-- RLS is enabled on every table; only the app role gets through.
-- (Explicit statements: the Supabase MCP execute_sql hung on a dynamic DO loop here.)
create policy app_all on public.workspaces for all to app_user using (true) with check (true);
create policy app_all on public.tests for all to app_user using (true) with check (true);
create policy app_all on public.events for all to app_user using (true) with check (true);
create policy app_all on public.leads for all to app_user using (true) with check (true);
create policy app_all on public.generation_requests for all to app_user using (true) with check (true);
create policy app_all on public.tickets for all to app_user using (true) with check (true);
create policy app_all on public.ticket_messages for all to app_user using (true) with check (true);
create policy app_all on public.sales_leads for all to app_user using (true) with check (true);
create policy app_all on public.orders for all to app_user using (true) with check (true);
create policy app_all on public.outbox for all to app_user using (true) with check (true);
create policy app_all on public.content_queue for all to app_user using (true) with check (true);
create policy app_all on public.ops_log for all to app_user using (true) with check (true);
create policy app_all on public.kv for all to app_user using (true) with check (true);

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on schema ops from public, anon, authenticated;
revoke all on all functions in schema ops from public, anon, authenticated;
