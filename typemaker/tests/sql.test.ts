import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRODUCTS, type ProductId } from "@/lib/config";
import { applyMigrations, migrationFiles } from "@/lib/migrate";
import { nextPlan, SettingsSchema, TestContentSchema } from "@/lib/schema";

// The operator functions (db/migrations, schema "ops") against a fresh PGlite database with
// every migration applied in order, the same way src/lib/db.ts boots it.

const root = path.join(__dirname, "..");
const migrationsDir = path.join(root, "db", "migrations");
const houseDir = path.join(root, "ops", "house-tests");
const houseFiles = readdirSync(houseDir).filter((f) => f.endsWith(".json")).sort();

let pg: PGlite;
const q = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await pg.query<T>(sql, params)).rows;
const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => {
  const rows = await q<T>(sql, params);
  if (!rows[0]) throw new Error(`no row from ${sql}`);
  return rows[0];
};
const validate = async (c: unknown): Promise<string | null> =>
  (await one<{ e: string | null }>("select ops.validate_content($1::jsonb) as e", [JSON.stringify(c)])).e;
const validateSettings = async (s: unknown, c?: unknown): Promise<string | null> =>
  (await one<{ e: string | null }>("select ops.validate_settings($1::jsonb, $2::jsonb) as e", [JSON.stringify(s), c === undefined ? null : JSON.stringify(c)])).e;
const errorOf = async (sql: string, params: unknown[] = []): Promise<string> => {
  try {
    await q(sql, params);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return "";
};

type Json = Record<string, unknown>;

function validContent(): Json {
  return {
    title: "커피 취향 테스트",
    subtitle: "",
    intro: "",
    questions: [1, 2, 3].map((i) => ({
      id: `q${i}`,
      text: `질문 ${i}`,
      options: [
        { id: "a", text: "가", weights: [{ key: "r1", points: 2 }] },
        { id: "b", text: "나", weights: [{ key: "r2", points: 1 }] },
      ],
    })),
    results: [
      { key: "r1", name: "라떼형", color: "#f2a900", traits: ["부드러움"] },
      { key: "r2", name: "아메리카노형", bestMatch: "r1" },
    ],
  };
}

/** A copy of the valid content with one change applied. */
type Draft = Json & { questions?: Json[]; results: Json[] };

function mutate(fn: (c: Draft & { questions: Json[] }) => void): Json {
  const c = structuredClone(validContent()) as Draft & { questions: Json[] };
  fn(c);
  return c;
}
const firstOption = (c: { questions: Json[] }) => ((c.questions[0] as { options: Json[] }).options[0] as Json);

beforeAll(async () => {
  pg = await PGlite.create();
  await applyMigrations(pg, migrationsDir);
});

afterAll(async () => {
  await pg.close();
});

describe("migrations", () => {
  it("applies every file once, in order, and records it", async () => {
    const rows = await q<{ name: string }>("select name from schema_migrations order by name");
    expect(rows.map((r) => r.name)).toEqual(migrationFiles(migrationsDir));
    expect(await applyMigrations(pg, migrationsDir)).toEqual([]);
  });
});

describe("ops.validate_content", () => {
  it("accepts valid content", async () => {
    expect(TestContentSchema.safeParse(validContent()).success).toBe(true);
    expect(await validate(validContent())).toBeNull();
  });

  for (const f of houseFiles) {
    it(`accepts the house test ${f}`, async () => {
      const content: unknown = JSON.parse(readFileSync(path.join(houseDir, f), "utf8"));
      expect(await validate(content)).toBeNull();
    });
  }

  // Finding 21: missing arrays and keys used to fall through NULL comparisons as "valid".
  const missing: [string, Json, string][] = [
    ["only a title", { title: "x" }, "results 배열이 없습니다"],
    ["no questions", mutate((c) => delete (c as Draft).questions), "questions 배열이 없습니다"],
    ["no options", mutate((c) => delete (c.questions[0] as Json).options), "options 배열이 없습니다"],
    ["no weights", mutate((c) => delete firstOption(c).weights), "weights"],
    ["a weight without a key", mutate((c) => (firstOption(c).weights = [{ points: 1 }])), "없는 결과 key"],
    ["a weight without points", mutate((c) => (firstOption(c).weights = [{ key: "r1" }])), "points"],
    ["results that is not an array", mutate((c) => ((c as Json).results = { r1: "x" })), "results 배열이 없습니다"],
  ];
  // Finding 22: everything TestContentSchema rejects must be rejected here too.
  const stricter: [string, Json, string][] = [
    ["a question without an id", mutate((c) => delete (c.questions[0] as Json).id), "questions[0].id"],
    ["an option without an id", mutate((c) => delete firstOption(c).id), "options[0].id"],
    ["duplicate question ids", mutate((c) => ((c.questions[1] as Json).id = "q1")), "질문 id 중복"],
    ["a 61-character title", mutate((c) => (c.title = "가".repeat(61))), "title"],
    ["a 121-character subtitle", mutate((c) => (c.subtitle = "x".repeat(121))), "subtitle"],
    ["a 141-character question", mutate((c) => ((c.questions[0] as Json).text = "x".repeat(141))), "questions[0].text"],
    ["a 41-character result name", mutate((c) => ((c.results[0] as Json).name = "x".repeat(41))), "results[0].name"],
    ["a 901-character description", mutate((c) => ((c.results[0] as Json).description = "설".repeat(901))), "description"],
    ["seven traits", mutate((c) => ((c.results[0] as Json).traits = ["a", "b", "c", "d", "e", "f", "g"])), "traits"],
    ["a short hex color", mutate((c) => ((c.results[0] as Json).color = "#f60")), "color"],
    ["four weights on one option", mutate((c) => (firstOption(c).weights = [1, 1, 1, 1].map(() => ({ key: "r1", points: 1 })))), "weights"],
    ["points as a string", mutate((c) => (firstOption(c).weights = [{ key: "r1", points: "2" }])), "points"],
    ["points of 1.5", mutate((c) => (firstOption(c).weights = [{ key: "r1", points: 1.5 }])), "points"],
    ["points of 4", mutate((c) => (firstOption(c).weights = [{ key: "r1", points: 4 }])), "points"],
    ["an explicit null subtitle", mutate((c) => (c.subtitle = null)), "subtitle"],
    ["one result", mutate((c) => (c.results = [c.results[0] as Json])), "results"],
    ["a result no option can reach", mutate((c) => c.results.push({ key: "r3", name: "숨은 유형" })), "r3"],
    ["an emoji title over 60 UTF-16 units", mutate((c) => (c.title = "😀".repeat(31))), "title"],
  ];

  for (const [name, content, needle] of [...missing, ...stricter]) {
    it(`rejects ${name}, like TestContentSchema`, async () => {
      expect(TestContentSchema.safeParse(content).success).toBe(false);
      const err = await validate(content);
      expect(err).not.toBeNull();
      expect(err).toContain(needle);
    });
  }

  it("keeps broken content out of the gallery and out of concierge deliveries", async () => {
    expect(await errorOf(`select ops.create_house_test('{"title":"broken"}'::jsonb)`)).toContain("invalid content");
    expect((await one<{ n: number }>("select count(*)::int as n from tests")).n).toBe(0);
  });
});

describe("ops.validate_settings", () => {
  it("accepts what the app writes and what the seed script uses", async () => {
    expect(await validateSettings(SettingsSchema.parse({}))).toBeNull();
    expect(await validateSettings({ cta: { enabled: true, label: "우리 브랜드 테스트 만들기", url: "/create" } })).toBeNull();
  });

  const bad: [string, Json, string][] = [
    ["a short hex accent", { theme: { accent: "#f60" } }, "theme.accent"],
    ["a retention below 30 days", { lead: { retentionDays: 10 } }, "lead.retentionDays"],
    ["an unknown lead field", { lead: { fields: ["address"] } }, "lead.fields"],
    ["a string boolean", { lead: { enabled: "true" } }, "lead.enabled"],
    ["a javascript: CTA", { cta: { enabled: true, url: "javascript:alert(1)" } }, "cta.url"],
    ["a protocol-relative CTA", { cta: { enabled: true, url: "//evil.example" } }, "cta.url"],
    ["an enabled coupon without a code", { coupon: { enabled: true } }, "coupon"],
  ];
  for (const [name, s, needle] of bad) {
    it(`rejects ${name}`, async () => {
      expect(await validateSettings(s)).toContain(needle);
    });
  }

  it("checks per-result coupon keys against the content", async () => {
    expect(await validateSettings({ coupon: { enabled: true, perResult: { r9: "X" } } }, validContent())).toContain("r9");
    expect(await validateSettings({ coupon: { enabled: true, perResult: { r1: "X" } } }, validContent())).toBeNull();
  });
});

describe("ops.plan_after_purchase mirrors nextPlan", () => {
  const now = new Date("2026-10-11T03:00:00Z");
  const cases: { plan: "free" | "pro" | "agency"; days: number | null; product: ProductId }[] = [];
  for (const plan of ["free", "pro", "agency"] as const) {
    for (const days of [null, -3, 1, 20, 300]) {
      for (const product of Object.keys(PRODUCTS) as ProductId[]) cases.push({ plan, days, product });
    }
  }

  it(`agrees on all ${cases.length} cases`, async () => {
    for (const c of cases) {
      const expires = c.days === null ? null : new Date(now.getTime() + c.days * 86_400_000);
      const ts = nextPlan({ plan: c.plan, expiresAt: expires }, PRODUCTS[c.product], now);
      const sql = await one<{ plan: string; expires_at: Date; kind: string; converted_days: string }>(
        "select * from ops.plan_after_purchase($1, $2::timestamptz, $3, $4::timestamptz)",
        [c.plan, expires?.toISOString() ?? null, c.product, now.toISOString()],
      );
      const label = JSON.stringify(c);
      expect(sql.plan, label).toBe(ts.plan);
      expect(sql.kind, label).toBe(ts.kind);
      expect(Math.abs(new Date(sql.expires_at).getTime() - ts.expiresAt.getTime()), label).toBeLessThan(1000);
      expect(Number(sql.converted_days), label).toBeCloseTo(ts.convertedDays, 4);
    }
  });
});

describe("bank transfer orders and refunds", () => {
  it("records the plan change and refund_order takes back exactly what the order added", async () => {
    const ws = await one<{ id: string }>(
      `insert into workspaces (secret, owner_email, plan, plan_expires_at) values ('ab12', 'buyer@example.com', 'agency', now() + interval '20 days') returning id`,
    );
    const before = await one<{ plan_expires_at: Date }>("select plan_expires_at from workspaces where id = $1", [ws.id]);
    const order = await one<{ r: { order_id: string; kind: string; plan: string } }>(
      "select ops.fulfill_manual_order($1, 'pro_month', '입금 확인 (테스트)') as r",
      [ws.id],
    );
    expect(order.r).toMatchObject({ kind: "pro_as_agency", plan: "agency" });
    const refund = await one<{ r: { kind: string; inferred: boolean; plan_after: string; until_after: string } }>(
      "select ops.refund_order($1, '전액 환불 (테스트)') as r",
      [order.r.order_id],
    );
    expect(refund.r).toMatchObject({ kind: "pro_as_agency", inferred: false, plan_after: "agency" });
    expect(Math.abs(new Date(refund.r.until_after).getTime() - new Date(before.plan_expires_at).getTime())).toBeLessThan(5000);
    expect((await one<{ status: string }>("select status from orders where order_id = $1", [order.r.order_id])).status).toBe("refunded");
    expect(await errorOf("select ops.refund_order($1, '두 번째')", [order.r.order_id])).toContain("이미 환불");
  });

  it("refuses to change a running plan's tier without p_force", async () => {
    const ws = await one<{ id: string }>(
      `insert into workspaces (secret, plan, plan_expires_at) values ('cd34', 'agency', now() + interval '10 days') returning id`,
    );
    expect(await errorOf("select ops.grant_plan($1, 'pro', 30, '장애 보상')", [ws.id])).toContain("p_force");
    expect(await errorOf("select ops.grant_plan($1, 'agency', 30, '')", [ws.id])).toContain("p_note");
    const until = await one<{ u: Date }>("select ops.grant_plan($1, 'agency', 7, '장애 보상') as u", [ws.id]);
    expect(new Date(until.u).getTime()).toBeGreaterThan(Date.now() + 16 * 86_400_000);
  });
});

describe("operator text guard", () => {
  it("refuses admin links and secret-looking strings in replies and mail", async () => {
    const t = await one<{ id: string }>(`insert into tickets (token, email, subject) values ('0123456789abcdef', 'a@example.com', '링크') returning id`);
    expect(await errorOf("select ops.reply_ticket($1, 'http://x/w/abcdef')", [t.id])).toContain("관리 링크");
    expect(await errorOf("select ops.queue_email('a@example.com', '제목', $1)", ["비밀 " + "a".repeat(40)])).toContain("관리 링크");
  });
});
