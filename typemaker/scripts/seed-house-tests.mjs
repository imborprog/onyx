// Publishes the example house tests in ops/house-tests into the local PGlite DB
// (stop `next dev`/`next start` first: PGlite allows one process at a time).
// With --sql it prints the statements to run on Supabase instead.
import { PGlite } from "@electric-sql/pglite";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "ops", "house-tests");
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
// Relative CTA so the link keeps working if the domain changes.
const settings = () => ({ cta: { enabled: true, label: "우리 브랜드 테스트 만들기", url: "/create" } });
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

if (process.argv.includes("--sql")) {
  for (const f of files) {
    const content = readFileSync(path.join(dir, f), "utf8");
    const q = (s) => `'${s.replace(/'/g, "''")}'`;
    console.log(`select ops.create_house_test(${q(JSON.stringify(JSON.parse(content)))}::jsonb, ${q(JSON.stringify(settings(appUrl)))}::jsonb);`);
  }
  process.exit(0);
}

const dataDir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
mkdirSync(path.dirname(path.resolve(dataDir)), { recursive: true });
const db = await PGlite.create(dataDir);
for (const f of readdirSync(path.join(process.cwd(), "db", "migrations")).filter((x) => x.endsWith(".sql")).sort()) {
  await db.exec(readFileSync(path.join(process.cwd(), "db", "migrations", f), "utf8"));
}
await db.query(`insert into kv (key, value) values ('app_url', $1) on conflict (key) do update set value = excluded.value`, [appUrl]);
for (const f of files) {
  const content = readFileSync(path.join(dir, f), "utf8");
  const res = await db.query(`select ops.create_house_test($1::jsonb, $2::jsonb) as url`, [content, JSON.stringify(settings(appUrl))]);
  console.log(f, "->", res.rows[0].url);
}
await db.close();
