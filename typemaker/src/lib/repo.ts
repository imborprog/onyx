import "server-only";
import { randomBytes } from "node:crypto";
import { db, type Queryable } from "./db";
import { PLAN_LIMITS, PRODUCTS, type Plan, type ProductId } from "./config";
import { parseSettings, TestContentSchema, type Brief, type Settings, type TestContent } from "./schema";

// All SQL for the app lives here. Operator-side SQL lives in db/migrations/002_ops.sql.

export function newToken(bytes = 20): string {
  return randomBytes(bytes).toString("hex");
}

function newSlug(): string {
  return randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8).padEnd(8, "x");
}

// ---------------------------------------------------------------- workspaces

export interface Workspace {
  id: string;
  secret: string;
  owner_email: string | null;
  brand_name: string | null;
  plan: Plan;
  plan_expires_at: Date | null;
  marketing_opt_in: boolean;
  is_house: boolean;
  created_at: Date;
}

export function effectivePlan(ws: Pick<Workspace, "plan" | "plan_expires_at">): Plan {
  if (ws.plan === "free") return "free";
  if (ws.plan_expires_at && new Date(ws.plan_expires_at).getTime() > Date.now()) return ws.plan;
  return "free";
}

export async function createWorkspace(input: { email?: string; brandName?: string; marketingOptIn?: boolean; ipHash?: string }): Promise<Workspace> {
  const d = await db();
  const rows = await d.query<Workspace>(
    `insert into workspaces (secret, owner_email, brand_name, marketing_opt_in, ip_hash)
     values ($1, $2, $3, $4, $5) returning *`,
    [newToken(), input.email || null, input.brandName || null, input.marketingOptIn ?? false, input.ipHash ?? null],
  );
  return rows[0] as Workspace;
}

export async function getWorkspaceBySecret(secret: string | null | undefined): Promise<Workspace | null> {
  if (!secret || !/^[a-f0-9]{20,64}$/.test(secret)) return null;
  const d = await db();
  const rows = await d.query<Workspace>(`update workspaces set last_seen_at = now() where secret = $1 returning *`, [secret]);
  return rows[0] ?? null;
}

export async function updateWorkspaceProfile(id: string, input: { email?: string | null; brandName?: string | null; marketingOptIn?: boolean }): Promise<void> {
  const d = await db();
  await d.query(
    `update workspaces set
       owner_email = coalesce($2, owner_email),
       brand_name = coalesce($3, brand_name),
       marketing_opt_in = coalesce($4, marketing_opt_in)
     where id = $1`,
    [id, input.email ?? null, input.brandName ?? null, input.marketingOptIn ?? null],
  );
}

// ---------------------------------------------------------------- tests

export type TestStatus = "draft" | "published" | "archived";
export type TestSource = "ai" | "template" | "ops" | "concierge";

interface TestRow {
  id: string;
  workspace_id: string;
  slug: string;
  status: TestStatus;
  content: unknown;
  settings: unknown;
  brief: unknown;
  source: TestSource;
  in_gallery: boolean;
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
}

export interface TestRecord extends Omit<TestRow, "content" | "settings"> {
  content: TestContent;
  settings: Settings;
}

function toRecord(row: TestRow): TestRecord {
  return { ...row, content: TestContentSchema.parse(row.content), settings: parseSettings(row.settings) };
}

export async function createTest(input: {
  workspaceId: string;
  content: TestContent;
  settings?: Partial<Settings>;
  brief?: Brief;
  source: TestSource;
  ipHash?: string;
}): Promise<TestRecord> {
  const d = await db();
  const settings = parseSettings(input.settings ?? {});
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const rows = await d.query<TestRow>(
        `insert into tests (workspace_id, slug, content, settings, brief, source)
         values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6) returning *`,
        [input.workspaceId, newSlug(), JSON.stringify(input.content), JSON.stringify(settings), JSON.stringify({ ...(input.brief ?? {}), ipHash: input.ipHash ?? null }), input.source],
      );
      return toRecord(rows[0] as TestRow);
    } catch (e) {
      if (!String(e).includes("tests_slug_key") || attempt === 4) throw e;
    }
  }
  throw new Error("unreachable");
}

export async function getTestForWorkspace(workspaceId: string, testId: string): Promise<TestRecord | null> {
  if (!/^[0-9a-f-]{36}$/.test(testId)) return null;
  const d = await db();
  const rows = await d.query<TestRow>(`select * from tests where id = $1 and workspace_id = $2`, [testId, workspaceId]);
  return rows[0] ? toRecord(rows[0]) : null;
}

export interface TestListItem {
  id: string;
  slug: string;
  status: TestStatus;
  title: string;
  created_at: Date;
  views: number;
  completes: number;
  leads: number;
}

export async function listTests(workspaceId: string): Promise<TestListItem[]> {
  const d = await db();
  return d.query<TestListItem>(
    `select t.id, t.slug, t.status, t.content->>'title' as title, t.created_at,
            (select count(*)::int from events e where e.test_id = t.id and e.type = 'view') as views,
            (select count(*)::int from events e where e.test_id = t.id and e.type = 'complete') as completes,
            (select count(*)::int from leads l where l.test_id = t.id) as leads
       from tests t
      where t.workspace_id = $1 and t.status <> 'archived'
      order by t.created_at desc`,
    [workspaceId],
  );
}

export async function updateTest(workspaceId: string, testId: string, patch: { content?: TestContent; settings?: Settings }): Promise<TestRecord | null> {
  const d = await db();
  const rows = await d.query<TestRow>(
    `update tests set
       content = coalesce($3::jsonb, content),
       settings = coalesce($4::jsonb, settings),
       updated_at = now()
     where id = $1 and workspace_id = $2 returning *`,
    [testId, workspaceId, patch.content ? JSON.stringify(patch.content) : null, patch.settings ? JSON.stringify(patch.settings) : null],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function setTestStatus(workspaceId: string, testId: string, status: TestStatus): Promise<TestRecord | null> {
  const d = await db();
  const rows = await d.query<TestRow>(
    `update tests set status = $3, updated_at = now(),
       published_at = case when $3 = 'published' then coalesce(published_at, now()) else published_at end
     where id = $1 and workspace_id = $2 returning *`,
    [testId, workspaceId, status],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

export interface PublicTest {
  test: TestRecord;
  plan: Plan;
  isHouse: boolean;
}

export async function getPublicTest(slug: string, previewSecret?: string | null): Promise<PublicTest | null> {
  if (!/^[a-z0-9]{4,16}$/.test(slug)) return null;
  const d = await db();
  const rows = await d.query<TestRow & { ws_plan: Plan; ws_expires: Date | null; ws_house: boolean; ws_secret: string }>(
    `select t.*, w.plan as ws_plan, w.plan_expires_at as ws_expires, w.is_house as ws_house, w.secret as ws_secret
       from tests t join workspaces w on w.id = t.workspace_id
      where t.slug = $1 and t.status <> 'archived'`,
    [slug],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.status !== "published" && (!previewSecret || previewSecret !== row.ws_secret)) return null;
  const { ws_plan, ws_expires, ws_house, ws_secret: _secret, ...testRow } = row;
  return { test: toRecord(testRow), plan: effectivePlan({ plan: ws_plan, plan_expires_at: ws_expires }), isHouse: ws_house };
}

export interface GalleryItem {
  slug: string;
  title: string;
  subtitle: string;
  accent: string;
  plays: number;
}

export async function galleryTests(limit = 30): Promise<GalleryItem[]> {
  const d = await db();
  return d.query<GalleryItem>(
    `select t.slug, t.content->>'title' as title, coalesce(t.content->>'subtitle', '') as subtitle,
            coalesce(t.content->'results'->0->>'color', '#ff5a36') as accent,
            (select count(*)::int from events e where e.test_id = t.id and e.type = 'complete') as plays
       from tests t
      where t.status = 'published' and t.in_gallery
      order by plays desc, t.published_at desc
      limit $1`,
    [limit],
  );
}

export async function countRecentGenerations(workspaceId: string, ipHash: string | null): Promise<{ workspace: number; ip: number }> {
  const d = await db();
  const rows = await d.query<{ workspace: number; ip: number }>(
    `select
       (select count(*)::int from tests where workspace_id = $1 and source in ('ai', 'template') and created_at > now() - interval '1 day')
       + (select count(*)::int from generation_requests where workspace_id = $1 and created_at > now() - interval '1 day') as workspace,
       (select count(*)::int from tests where brief->>'ipHash' = $2 and created_at > now() - interval '1 day') as ip`,
    [workspaceId, ipHash ?? "none"],
  );
  return rows[0] ?? { workspace: 0, ip: 0 };
}

// ---------------------------------------------------------------- events & stats

export const EVENT_TYPES = ["view", "start", "complete", "share", "watermark_click", "cta_click", "lead_submit", "coupon_reveal"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export async function insertEvent(input: { testId: string; type: EventType; resultKey?: string | null; channel?: string | null; sessionId?: string | null }): Promise<void> {
  const d = await db();
  await d.query(`insert into events (test_id, type, result_key, channel, session_id) values ($1, $2, $3, $4, $5)`, [
    input.testId,
    input.type,
    input.resultKey ?? null,
    input.channel ?? null,
    input.sessionId ?? null,
  ]);
}

export async function testIdForSlug(slug: string): Promise<string | null> {
  const d = await db();
  const rows = await d.query<{ id: string }>(`select id from tests where slug = $1 and status = 'published'`, [slug]);
  return rows[0]?.id ?? null;
}

export interface TestStats {
  views: number;
  starts: number;
  completes: number;
  shares: number;
  watermarkClicks: number;
  ctaClicks: number;
  leads: number;
  byResult: Record<string, number>;
  byDay: { day: string; views: number; completes: number }[];
}

export async function testStats(testId: string): Promise<TestStats> {
  const d = await db();
  const counts = await d.query<{ type: string; n: number }>(`select type, count(*)::int as n from events where test_id = $1 group by type`, [testId]);
  const byResultRows = await d.query<{ result_key: string; n: number }>(
    `select result_key, count(*)::int as n from events where test_id = $1 and type = 'complete' and result_key is not null group by result_key`,
    [testId],
  );
  const leads = await d.query<{ n: number }>(`select count(*)::int as n from leads where test_id = $1`, [testId]);
  const byDay = await d.query<{ day: string; views: number; completes: number }>(
    `select to_char(date_trunc('day', created_at at time zone 'Asia/Seoul'), 'MM-DD') as day,
            count(*) filter (where type = 'view')::int as views,
            count(*) filter (where type = 'complete')::int as completes
       from events where test_id = $1 and created_at > now() - interval '14 days'
      group by 1 order by 1`,
    [testId],
  );
  const get = (t: string) => counts.find((c) => c.type === t)?.n ?? 0;
  return {
    views: get("view"),
    starts: get("start"),
    completes: get("complete"),
    shares: get("share"),
    watermarkClicks: get("watermark_click"),
    ctaClicks: get("cta_click"),
    leads: leads[0]?.n ?? 0,
    byResult: Object.fromEntries(byResultRows.map((r) => [r.result_key, r.n])),
    byDay,
  };
}

// ---------------------------------------------------------------- leads

export interface LeadRow {
  id: string;
  result_key: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  consent_marketing: boolean;
  consent_night: boolean;
  created_at: Date;
}

export async function insertLead(input: {
  testId: string;
  workspaceId: string;
  resultKey: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  consentMarketing: boolean;
  consentNight: boolean;
  retentionDays: number;
}): Promise<void> {
  const d = await db();
  await d.query(
    `insert into leads (test_id, workspace_id, result_key, name, phone, email, consent_privacy, consent_marketing, consent_night, age_over_14, delete_after)
     values ($1, $2, $3, $4, $5, $6, true, $7, $8, true, now() + make_interval(days => $9::int))`,
    [input.testId, input.workspaceId, input.resultKey, input.name, input.phone, input.email, input.consentMarketing, input.consentNight, input.retentionDays],
  );
}

export async function listLeads(testId: string, workspaceId: string, plan: Plan): Promise<{ rows: LeadRow[]; total: number; hidden: number }> {
  const d = await db();
  const limit = PLAN_LIMITS[plan].visibleLeads;
  const total = (await d.query<{ n: number }>(`select count(*)::int as n from leads where test_id = $1 and workspace_id = $2`, [testId, workspaceId]))[0]?.n ?? 0;
  const rows = await d.query<LeadRow>(
    `select id, result_key, name, phone, email, consent_marketing, consent_night, created_at
       from leads where test_id = $1 and workspace_id = $2
      order by created_at asc limit $3`,
    [testId, workspaceId, Number.isFinite(limit) ? limit : 100000],
  );
  return { rows, total, hidden: Math.max(0, total - rows.length) };
}

// ---------------------------------------------------------------- concierge generation requests

export async function createGenerationRequest(workspaceId: string, brief: Brief, priority = false): Promise<string> {
  const d = await db();
  const rows = await d.query<{ id: string }>(
    `insert into generation_requests (workspace_id, brief, priority) values ($1, $2::jsonb, $3) returning id`,
    [workspaceId, JSON.stringify(brief), priority],
  );
  return (rows[0] as { id: string }).id;
}

export interface GenerationRequestRow {
  id: string;
  status: "queued" | "done" | "failed" | "cancelled";
  brief: Brief;
  test_id: string | null;
  created_at: Date;
}

export async function listGenerationRequests(workspaceId: string): Promise<GenerationRequestRow[]> {
  const d = await db();
  return d.query<GenerationRequestRow>(
    `select id, status, brief, test_id, created_at from generation_requests
      where workspace_id = $1 and status in ('queued', 'failed') order by created_at desc`,
    [workspaceId],
  );
}

// ---------------------------------------------------------------- support tickets

export type TicketCategory = "general" | "billing" | "bug" | "sales" | "refund" | "privacy";

export interface TicketView {
  id: string;
  token: string;
  subject: string;
  status: "open" | "answered" | "escalated" | "closed";
  category: TicketCategory;
  created_at: Date;
  messages: { role: "customer" | "ai" | "operator"; body: string; created_at: Date }[];
}

export async function createTicket(input: {
  workspaceId: string | null;
  email: string | null;
  name: string | null;
  category: TicketCategory;
  subject: string;
  body: string;
}): Promise<{ id: string; token: string }> {
  const d = await db();
  const token = newToken(16);
  const status = input.category === "refund" || input.category === "privacy" ? "escalated" : "open";
  return d.tx(async (q: Queryable) => {
    const rows = await q.query<{ id: string }>(
      `insert into tickets (token, workspace_id, email, name, category, subject, status)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [token, input.workspaceId, input.email, input.name, input.category, input.subject, status],
    );
    const id = (rows[0] as { id: string }).id;
    await q.query(`insert into ticket_messages (ticket_id, role, body) values ($1, 'customer', $2)`, [id, input.body]);
    return { id, token };
  });
}

export async function addTicketMessage(ticketId: string, role: "customer" | "ai" | "operator", body: string): Promise<void> {
  const d = await db();
  await d.query(`insert into ticket_messages (ticket_id, role, body) values ($1, $2, $3)`, [ticketId, role, body]);
  if (role === "customer") {
    await d.query(`update tickets set status = case when status = 'escalated' then 'escalated' else 'open' end, updated_at = now() where id = $1`, [ticketId]);
  }
}

export async function getTicketByToken(token: string): Promise<TicketView | null> {
  if (!/^[a-f0-9]{16,64}$/.test(token)) return null;
  const d = await db();
  const rows = await d.query<Omit<TicketView, "messages">>(`select id, token, subject, status, category, created_at from tickets where token = $1`, [token]);
  const t = rows[0];
  if (!t) return null;
  const messages = await d.query<TicketView["messages"][number]>(
    `select role, body, created_at from ticket_messages where ticket_id = $1 order by id`,
    [t.id],
  );
  return { ...t, messages };
}

// ---------------------------------------------------------------- sales inquiries

export async function createSalesLead(input: {
  workspaceId: string | null;
  name: string | null;
  company: string | null;
  email: string;
  phone: string | null;
  product: string | null;
  message: string | null;
  source: string;
}): Promise<string> {
  const d = await db();
  const rows = await d.query<{ id: string }>(
    `insert into sales_leads (workspace_id, name, company, email, phone, product, message, source)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [input.workspaceId, input.name, input.company, input.email, input.phone, input.product, input.message, input.source],
  );
  return (rows[0] as { id: string }).id;
}

// ---------------------------------------------------------------- orders

export interface OrderRow {
  id: string;
  order_id: string;
  workspace_id: string;
  product: ProductId;
  amount: number;
  status: "pending" | "paid" | "failed" | "cancelled" | "refunded";
  customer_email: string | null;
  paid_at: Date | null;
}

export async function createOrder(workspaceId: string, product: ProductId, email: string | null): Promise<OrderRow> {
  const d = await db();
  const orderId = `tm_${Date.now().toString(36)}_${newToken(6)}`;
  const rows = await d.query<OrderRow>(
    `insert into orders (order_id, workspace_id, product, amount, customer_email) values ($1, $2, $3, $4, $5) returning *`,
    [orderId, workspaceId, product, PRODUCTS[product].amount, email],
  );
  return rows[0] as OrderRow;
}

export async function getOrder(orderId: string): Promise<OrderRow | null> {
  const d = await db();
  const rows = await d.query<OrderRow>(`select * from orders where order_id = $1`, [orderId]);
  return rows[0] ?? null;
}

/** Marks the order paid and extends the plan in one transaction. Idempotent. */
export async function fulfillOrder(orderId: string, paymentKey: string, raw: unknown): Promise<{ planUntil: Date | null; alreadyPaid: boolean }> {
  const d = await db();
  return d.tx(async (q) => {
    const rows = await q.query<OrderRow>(`select * from orders where order_id = $1 for update`, [orderId]);
    const order = rows[0];
    if (!order) throw new Error("order not found");
    if (order.status === "paid") {
      const ws = await q.query<{ plan_expires_at: Date | null }>(`select plan_expires_at from workspaces where id = $1`, [order.workspace_id]);
      return { planUntil: ws[0]?.plan_expires_at ?? null, alreadyPaid: true };
    }
    const product = PRODUCTS[order.product];
    await q.query(`update orders set status = 'paid', payment_key = $2, raw = $3::jsonb, paid_at = now() where order_id = $1`, [orderId, paymentKey, JSON.stringify(raw)]);
    const ws = await q.query<{ plan_expires_at: Date | null }>(
      `update workspaces set
         plan = case when plan = 'agency' and $2 = 'pro' and plan_expires_at > now() then 'agency' else $2 end,
         plan_expires_at = greatest(coalesce(plan_expires_at, now()), now()) + make_interval(days => $3::int)
       where id = $1 returning plan_expires_at`,
      [order.workspace_id, product.plan, product.days],
    );
    if (product.concierge) {
      await q.query(
        `insert into sales_leads (workspace_id, email, product, message, source, status)
         values ($1, coalesce($2, 'unknown@invalid'), 'campaign', '캠페인 패스 결제 완료 — 기획 대행 착수 필요', 'order', 'new')`,
        [order.workspace_id, order.customer_email],
      );
    }
    return { planUntil: ws[0]?.plan_expires_at ?? null, alreadyPaid: false };
  });
}

export async function markOrderFailed(orderId: string, raw: unknown): Promise<void> {
  const d = await db();
  await d.query(`update orders set status = 'failed', raw = $2::jsonb where order_id = $1 and status = 'pending'`, [orderId, JSON.stringify(raw)]);
}

// ---------------------------------------------------------------- outbox & kv

export async function enqueueEmail(input: { to: string; subject: string; body: string; kind: "transactional" | "support" | "sales"; ref?: string }): Promise<void> {
  const d = await db();
  await d.query(`insert into outbox (to_email, subject, body_text, kind, ref) values ($1, $2, $3, $4, $5)`, [input.to, input.subject, input.body, input.kind, input.ref ?? null]);
}

export interface OutboxRow {
  id: number;
  to_email: string;
  subject: string;
  body_text: string;
  attempts: number;
}

export async function pendingEmails(limit = 20): Promise<OutboxRow[]> {
  const d = await db();
  return d.query<OutboxRow>(`select id, to_email, subject, body_text, attempts from outbox where status = 'pending' and attempts < 5 order by id limit $1`, [limit]);
}

export async function markEmail(id: number, ok: boolean, error?: string): Promise<void> {
  const d = await db();
  await d.query(
    `update outbox set attempts = attempts + 1,
       status = case when $2 then 'sent' when attempts + 1 >= 5 then 'failed' else 'pending' end,
       sent_at = case when $2 then now() else sent_at end,
       error = $3
     where id = $1`,
    [id, ok, error ?? null],
  );
}

export async function kvGet(key: string): Promise<string | null> {
  const d = await db();
  const rows = await d.query<{ value: string }>(`select value from kv where key = $1`, [key]);
  return rows[0]?.value ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  const d = await db();
  await d.query(
    `insert into kv (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, value],
  );
}

export async function purgeExpiredLeads(): Promise<number> {
  const d = await db();
  const rows = await d.query<{ id: string }>(`delete from leads where delete_after < now() returning id`);
  return rows.length;
}
