// Same logic as src/lib/migrate.ts, for the Node scripts: applies db/migrations/*.sql to a PGlite
// database once each, in file order, recording them in schema_migrations. Keep the two in sync.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

export async function applyMigrations(pg, dir = MIGRATIONS_DIR) {
  const existing = await pg.query(
    `select to_regclass('public.schema_migrations') is null and to_regclass('public.workspaces') is not null as legacy`,
  );
  const legacy = existing.rows[0]?.legacy ?? false;
  await pg.exec(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await pg.query(`select name from schema_migrations`)).rows.map((r) => r.name));
  const applied = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
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
