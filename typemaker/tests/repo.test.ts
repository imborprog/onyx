import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  addCustomerMessageLimited,
  createTicketLimited,
  insertEventLimited,
  insertLeadLimited,
  reserveGeneration,
} from "@/lib/limits";
import {
  claimEmails,
  createOrder,
  createTest,
  createWorkspace,
  fulfillOrder,
  getWorkspaceBySecret,
  OrderClosedError,
  purgeRetention,
  updateWorkspaceProfile,
  type Workspace,
} from "@/lib/repo";
import { TestContentSchema } from "@/lib/schema";

// App-side SQL (repo.ts, limits.ts) against an in-memory PGlite database booted by db().
process.env.PGLITE_DIR = ":memory:";
delete process.env.DATABASE_URL;
delete process.env.RATE_LIMIT_SCALE;

const content = TestContentSchema.parse(JSON.parse(readFileSync(path.join(__dirname, "..", "ops", "house-tests", "autumn-cafe.json"), "utf8")));

async function q<T>(sql: string, params: (string | number | boolean | null)[] = []): Promise<T[]> {
  return (await db()).query<T>(sql, params);
}
async function one<T>(sql: string, params: (string | number | boolean | null)[] = []): Promise<T> {
  const rows = await q<T>(sql, params);
  if (!rows[0]) throw new Error(`no row from ${sql}`);
  return rows[0];
}
async function wsById(id: string): Promise<Workspace> {
  return one<Workspace>("select * from workspaces where id = $1", [id]);
}
async function outboxRefs(to: string): Promise<string[]> {
  return (await q<{ ref: string | null }>("select ref from outbox where lower(to_email) = $1 order by id", [to])).map((r) => r.ref ?? "");
}

beforeAll(async () => {
  await db();
});

describe("workspace profile and marketing consent (C4)", () => {
  it("records consent only with an address, with its date and source, and the trigger sends the result notice", async () => {
    const ws = await createWorkspace({ email: " Owner@Example.com ", marketingOptIn: true, optInSource: "create_form" });
    expect(ws.owner_email).toBe("owner@example.com");
    expect(ws.marketing_opt_in).toBe(true);
    expect(ws.marketing_opt_in_at).not.toBeNull();
    expect(ws.marketing_opt_in_source).toBe("create_form");
    expect(await outboxRefs("owner@example.com")).toEqual(["consent:in"]);

    const noEmail = await createWorkspace({ marketingOptIn: true, optInSource: "create_form" });
    expect(noEmail.marketing_opt_in).toBe(false);
    expect(noEmail.marketing_opt_in_at).toBeNull();
  });

  it("treats undefined as unchanged, null as clear, and never lets a new address inherit consent", async () => {
    const ws = await createWorkspace({ email: "first@example.com", brandName: "카페", marketingOptIn: true, optInSource: "create_form" });

    await updateWorkspaceProfile(ws.id, { brandName: "새 카페" });
    let cur = await wsById(ws.id);
    expect(cur).toMatchObject({ owner_email: "first@example.com", brand_name: "새 카페", marketing_opt_in: true });

    await updateWorkspaceProfile(ws.id, { email: "second@example.com" });
    cur = await wsById(ws.id);
    expect(cur).toMatchObject({ owner_email: "second@example.com", marketing_opt_in: false, marketing_opt_in_at: null });

    await updateWorkspaceProfile(ws.id, { marketingOptIn: true, optInSource: "dashboard" });
    cur = await wsById(ws.id);
    expect(cur.marketing_opt_in).toBe(true);
    expect(cur.marketing_opt_in_source).toBe("dashboard");

    await updateWorkspaceProfile(ws.id, { marketingOptIn: false, optInSource: "dashboard" });
    cur = await wsById(ws.id);
    expect(cur).toMatchObject({ marketing_opt_in: false, marketing_opt_in_at: null });
    expect(await outboxRefs("second@example.com")).toEqual(["consent:in", "consent:out"]);

    await updateWorkspaceProfile(ws.id, { email: null, brandName: null });
    cur = await wsById(ws.id);
    expect(cur).toMatchObject({ owner_email: null, brand_name: null, marketing_opt_in: false });
  });
});

describe("orders", () => {
  it("applies nextPlan, stores the plan change for ops.refund_order, and is idempotent", async () => {
    const ws = await createWorkspace({ email: "agency@example.com" });
    await q(`update workspaces set plan = 'agency', plan_expires_at = now() + interval '20 days' where id = $1`, [ws.id]);
    const before = await wsById(ws.id);
    const order = await createOrder(ws.id, "pro_month", "agency@example.com");

    const res = await fulfillOrder(order.order_id, "pay_1", { status: "DONE" });
    expect(res.alreadyPaid).toBe(false);
    expect(res.change).toMatchObject({ plan: "agency", kind: "pro_as_agency" });
    const raw = (await one<{ raw: { toss: unknown; plan_change: Record<string, unknown> } }>("select raw from orders where id = $1", [order.id])).raw;
    expect(raw.toss).toEqual({ status: "DONE" });
    expect(raw.plan_change).toMatchObject({ kind: "pro_as_agency", plan_before: "agency", plan_after: "agency" });
    expect(Number(raw.plan_change.converted_days)).toBeCloseTo((30 * 49000) / 149000, 3);

    expect((await fulfillOrder(order.order_id, "pay_1", {})).alreadyPaid).toBe(true);

    const refund = await one<{ r: { kind: string; inferred: boolean; until_after: string } }>("select ops.refund_order($1, '테스트 환불') as r", [order.order_id]);
    expect(refund.r).toMatchObject({ kind: "pro_as_agency", inferred: false });
    expect(Math.abs(new Date(refund.r.until_after).getTime() - new Date(before.plan_expires_at ?? 0).getTime())).toBeLessThan(5000);
    await expect(fulfillOrder(order.order_id, "pay_1", {})).rejects.toBeInstanceOf(OrderClosedError);
  });
});

describe("outbox", () => {
  it("sends receipts before auto-acknowledgements and skips marketing without consent", async () => {
    await q("update outbox set status = 'sent'");
    await createTicketLimited({
      workspaceId: null,
      email: "asker@example.com",
      name: null,
      category: "general",
      subject: "질문",
      body: "질문이 있어요",
      ipHash: "ip-outbox",
      ack: { to: "asker@example.com", subject: "접수", body: (t) => `접수됐어요 ${t}` },
    });
    await q(`insert into outbox (to_email, subject, body_text, kind, ref) values ('buyer@example.com', '영수증', '본문', 'transactional', 'order:1')`);
    await q(`insert into outbox (to_email, subject, body_text, kind) values ('stranger@example.com', '(광고) 할인', '본문', 'marketing')`);

    const claimed = await claimEmails(10);
    expect(claimed.map((m) => m.ref)).toEqual(["order:1", expect.stringMatching(/^ack:ticket:/)]);
    expect(claimed.every((m) => m.kind !== "marketing")).toBe(true);
    const skipped = await one<{ status: string; error: string }>("select status, error from outbox where to_email = 'stranger@example.com'");
    expect(skipped).toEqual({ status: "skipped", error: "no marketing consent" });
    expect(await claimEmails(10)).toEqual([]);
  });
});

describe("abuse limits", () => {
  it("caps free generations per IP, even for concurrent requests, and refusals keep counting", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => reserveGeneration({ ipHash: "ip-gen", workspaceId: null, plan: "free", kind: "template" })));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false, reason: "ip", limit: 5 });
  });

  it("caps concierge requests per IP and generations per free workspace", async () => {
    const c = [];
    for (let i = 0; i < 3; i++) c.push(await reserveGeneration({ ipHash: "ip-concierge", workspaceId: null, plan: "free", kind: "concierge" }));
    expect(c.map((r) => r.ok)).toEqual([true, true, false]);
    expect(c[2]).toMatchObject({ reason: "concierge_ip" });

    const ws = await createWorkspace({});
    const w = [];
    for (let i = 0; i < 4; i++) w.push(await reserveGeneration({ ipHash: `ip-ws-${i}`, workspaceId: ws.id, plan: "free", kind: "template" }));
    expect(w.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(w[3]).toMatchObject({ reason: "workspace", limit: 3 });
  });

  it("caps leads per browser session and per IP, and events per session and type", async () => {
    const ws = await createWorkspace({});
    const test = await createTest({ workspaceId: ws.id, content, source: "ops" });
    const lead = (sessionId: string | null, ipHash: string) =>
      insertLeadLimited({
        testId: test.id,
        workspaceId: ws.id,
        resultKey: "r1",
        name: "홍길동",
        phone: "010-1234-5678",
        email: null,
        consentMarketing: false,
        consentNight: false,
        retentionDays: 90,
        sessionId,
        ipHash,
      });
    const bySession = [];
    for (let i = 0; i < 4; i++) bySession.push(await lead("sess-1", `ip-lead-s${i}`));
    expect(bySession.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(bySession[3]).toEqual({ ok: false, reason: "session" });
    // The old shared fallback id is not a session.
    for (let i = 0; i < 4; i++) expect((await lead("nosession", `ip-lead-n${i}`)).ok).toBe(true);

    const byIp = [];
    for (let i = 0; i < 11; i++) byIp.push(await lead(null, "ip-lead-flood"));
    expect(byIp.filter((r) => r.ok)).toHaveLength(10);
    expect(byIp[10]).toEqual({ ok: false, reason: "ip" });

    const events = [];
    for (let i = 0; i < 11; i++) events.push(await insertEventLimited({ testId: test.id, type: "view", sessionId: "sess-ev", ipHash: "ip-ev" }));
    expect(events.filter(Boolean)).toHaveLength(10);
    expect(await insertEventLimited({ testId: test.id, type: "start", sessionId: "sess-ev", ipHash: "ip-ev" })).toBe(true);
  });

  it("caps tickets per IP, acknowledgements per recipient, and follow-ups per ticket", async () => {
    const ticket = (to: string) =>
      createTicketLimited({
        workspaceId: null,
        email: to,
        name: null,
        category: "general",
        subject: "문의",
        body: "내용입니다",
        ipHash: "ip-tickets",
        ack: { to, subject: "접수", body: (t) => `접수 ${t}` },
      });
    const made = [];
    for (let i = 0; i < 11; i++) made.push(await ticket("victim@example.com"));
    expect(made.filter((t) => t.ok)).toHaveLength(10);
    expect(made.map((t) => (t.ok ? t.ackQueued : null)).slice(0, 3)).toEqual([true, true, false]);
    expect((await outboxRefs("victim@example.com")).filter((r) => r.startsWith("ack:"))).toHaveLength(2);

    const first = made[0];
    if (!first?.ok) throw new Error("first ticket missing");
    const replies = [];
    for (let i = 0; i < 21; i++) replies.push(await addCustomerMessageLimited(first.id, `추가 ${i}`));
    // The ticket's first message is the customer's too, so 19 more fit under the cap of 20.
    expect(replies.filter(Boolean)).toHaveLength(19);
  });
});

describe("purgeRetention (C7)", () => {
  it("deletes and blanks exactly what the privacy policy promises", async () => {
    const old = await createWorkspace({ email: "gone@example.com" });
    const paying = await createWorkspace({ email: "paid@example.com" });
    const fresh = await createWorkspace({ email: "fresh@example.com" });
    await q(`update workspaces set last_seen_at = now() - interval '400 days', created_at = now() - interval '400 days', ip_hash = 'h' where id in ($1, $2)`, [old.id, paying.id]);
    await q(`insert into orders (order_id, workspace_id, product, amount, status, paid_at) values ('o_recent', $1, 'pro_month', 49000, 'paid', now() - interval '2 years')`, [paying.id]);
    await q(`insert into orders (order_id, workspace_id, product, amount, status, paid_at, created_at) values ('o_ancient', $1, 'pro_month', 49000, 'paid', now() - interval '6 years', now() - interval '6 years')`, [fresh.id]);
    const test = await createTest({ workspaceId: fresh.id, content, source: "ops" });
    await q(`insert into events (test_id, type, created_at, ip_hash) values ($1, 'view', now() - interval '3 years', 'h'), ($1, 'view', now() - interval '100 days', 'h'), ($1, 'view', now(), 'h')`, [test.id]);
    await q(
      `insert into tickets (token, subject, status, updated_at, created_at) values
         ('aaaaaaaaaaaaaaaa', 'old answered', 'answered', now() - interval '13 months', now() - interval '13 months'),
         ('bbbbbbbbbbbbbbbb', 'old escalated', 'escalated', now() - interval '13 months', now() - interval '13 months')`,
    );
    await q(`insert into sales_leads (email, updated_at, created_at) values ('lead@example.com', now() - interval '13 months', now() - interval '13 months')`);
    await q(`insert into outbox (to_email, subject, body_text, status, sent_at) values ('x@example.com', 's', 'b', 'sent', now() - interval '100 days')`);
    await q(`insert into generation_attempts (ip_hash, kind, created_at) values ('h', 'ai', now() - interval '100 days')`);
    await q(
      `insert into leads (test_id, workspace_id, consent_privacy, age_over_14, delete_after, ip_hash, created_at)
       values ($1, $2, true, true, now() - interval '1 day', 'h', now() - interval '100 days')`,
      [test.id, fresh.id],
    );

    const { counts, errors } = await purgeRetention();
    expect(errors).toEqual([]);
    expect(counts).toMatchObject({
      leads_deleted: 1,
      tickets_deleted: 1,
      sales_leads_deleted: 1,
      events_deleted: 1,
      event_ip_hashes_removed: 1,
      generation_attempts_deleted: 1,
      inactive_owner_emails_cleared: 1,
      orders_deleted: 1,
    });
    expect(counts.outbox_deleted).toBeGreaterThanOrEqual(1);
    expect(counts.workspace_ip_hashes_removed).toBeGreaterThanOrEqual(2);
    expect((await wsById(old.id)).owner_email).toBeNull();
    expect((await wsById(paying.id)).owner_email).toBe("paid@example.com");
    expect((await q("select 1 from tickets where subject = 'old escalated'")).length).toBe(1);
    expect((await one<{ v: string }>("select value as v from kv where key = 'retention_last_run'")).v).toBeTruthy();
  });
});

describe("workspace secrets", () => {
  it("rejects malformed secrets without touching the database", async () => {
    expect(await getWorkspaceBySecret("not-hex")).toBeNull();
    expect(await getWorkspaceBySecret(null)).toBeNull();
  });
});
