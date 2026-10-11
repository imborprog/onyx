import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Applies db/migrations/*.sql to a PGlite database once each, in file order, recording them in
// schema_migrations. Re-running an already-applied file is not safe (002's views cannot be
// recreated after 004 added columns to the tables behind them). Supabase migrations are applied
// by hand, so this table only exists locally. scripts/pglite-migrate.mjs is the same logic for
// the Node scripts; keep the two in sync.

export interface MigrationTarget {
  exec(sql: string): Promise<unknown>;
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export function migrationFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Returns the files applied by this call. */
export async function applyMigrations(pg: MigrationTarget, dir: string): Promise<string[]> {
  const existing = await pg.query<{ legacy: boolean }>(
    `select to_regclass('public.schema_migrations') is null and to_regclass('public.workspaces') is not null as legacy`,
  );
  // A local database from before this table existed: every file was re-run on each boot, so the
  // files that now fail were applied back then.
  const legacy = existing.rows[0]?.legacy ?? false;
  await pg.exec(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await pg.query<{ name: string }>(`select name from schema_migrations`)).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const file of migrationFiles(dir)) {
    if (done.has(file)) continue;
    await pg.exec("begin");
    try {
      await pg.exec(readFileSync(path.join(dir, file), "utf8"));
      await pg.query(`insert into schema_migrations (name) values ($1)`, [file]);
      await pg.exec("commit");
      applied.push(file);
    } catch (e) {
      await pg.exec("rollback");
      if (!legacy) throw new Error(`migration ${file} failed: ${e instanceof Error ? e.message : String(e)}`);
      console.warn(`migration ${file} could not be re-run on this older local database; recording it as applied (${e instanceof Error ? e.message : String(e)})`);
      await pg.query(`insert into schema_migrations (name) values ($1) on conflict do nothing`, [file]);
    }
  }
  return applied;
}
