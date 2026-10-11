-- Pin search_path on every operator function (Supabase linter 0011).
-- The functions already schema-qualify tables, so pg_catalog + public is enough.
do $$
declare
  f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'ops' loop
    execute format('alter function %s set search_path = pg_catalog, public', f);
  end loop;
end
$$;
