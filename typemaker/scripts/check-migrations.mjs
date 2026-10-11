import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
const db = new PGlite();
for (const f of readdirSync("db/migrations").filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(readFileSync(`db/migrations/${f}`, "utf8"));
  console.log("applied", f);
}
const content = {
  title: "t", subtitle: "", intro: "",
  questions: [1, 2, 3].map((i) => ({ id: `q${i}`, text: `q${i}`, options: [
    { id: "a", text: "a", weights: [{ key: "r1", points: 1 }] },
    { id: "b", text: "b", weights: [{ key: "r2", points: 2 }] },
  ] })),
  results: [{ key: "r1", name: "R1" }, { key: "r2", name: "R2" }],
};
console.log((await db.query("select ops.validate_content($1::jsonb) as e", [JSON.stringify(content)])).rows);
console.log((await db.query("select ops.validate_content($1::jsonb) as e", [JSON.stringify({ ...content, results: [{ key: "r1", name: "R1" }, { key: "r2", name: "R2" }, { key: "r3", name: "R3" }] })])).rows);
console.log((await db.query("select ops.create_house_test($1::jsonb) as url", [JSON.stringify(content)])).rows);
console.log((await db.query("select ops.summary(7) as s")).rows[0].s);
console.log((await db.query("select slug, title, views from ops.test_performance")).rows);
