import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import { PLAN_LIMITS, PRODUCTS, type Plan, type Product, type ProductId } from "./config";
import { nextPlan, parseSettings, TestContentSchema, type Brief, type PaidPlan, type PlanChange, type Settings, type TestContent } from "./schema";

// All SQL for the app lives here (abuse-limit SQL lives in limits.ts). Operator-side SQL lives in db/migrations.

export function newToken(bytes = 20): string {
  return randomBytes(bytes).toString("hex");
}

function newSlug(): string {
  return randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8).padEnd(8, "x");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids from URLs must be checked before they reach a uuid column, or Postgres raises and the route 500s. */
export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

/** Emails are stored trimmed and lower-cased so opt-outs and lookups match however they were typed. */
function normEmail(email: string | null | undefined): string | null {
  const v = (email ?? "").trim().toLowerCase();
  return v || null;
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
  marketing_opt_in_at: Date | null;
  marketing_opt_in_source: string | null;
  is_house: boolean;
  created_at: Date;
  last_seen_at: Date;
}

export function effectivePlan(ws: Pick<Workspace, "plan" | "plan_expires_at">): Plan {
  if (ws.plan === "free") return "free";
  if (ws.plan_expires_at && new Date(ws.plan_expires_at).getTime() > Date.now()) return ws.plan;
  return "free";
}

/** Marketing consent is only recorded with an address to send to, and always with its date and source. */
export async function createWorkspace(input: { email?: string | null; brandName?: string | null; marketingOptIn?: boolean; optInSource?: string; ipHash?: string }): Promise<Workspace> {
  const d = await db();
  const email = normEmail(input.email);
  const optIn = Boolean(input.marketingOptIn && email);
  const rows = await d.query<Workspace>(
    `insert into workspaces (secret, owner_email, brand_name, marketing_opt_in, marketing_opt_in_at, marketing_opt_in_source, ip_hash)
     values ($1, $2, $3, $4::boolean, case when $4::boolean then now() end, case when $4::boolean then $5::text end, $6)
     returning *`,
    [newToken(), email, input.brandName?.trim() || null, optIn, input.optInSource ?? null, input.ipHash ?? null],
  );
  return rows[0] as Workspace;
}

export async function getWorkspaceBySecret(secret: string | null | undefined): Promise<Workspace | null> {
  if (!secret || !/^[a-f0-9]{20,64}$/.test(secret)) return null;
  const d = await db();
  const rows = await d.query<Workspace>(`update workspaces set last_seen_at = now() where secret = $1 returning *`, [secret]);
  return rows[0] ?? null;
}

export interface WorkspaceProfilePatch {
  /** undefined leaves it unchanged, null clears it. */
  email?: string | null;
  /** undefined leaves it unchanged, null clears it. */
  brandName?: string | null;
  /** true records a fresh consent (dated now), false withdraws it. */
  marketingOptIn?: boolean;
  /** Where the consent change came from, e.g. 'dashboard' or 'create_form'. */
  optInSource?: string;
}

export async function updateWorkspaceProfile(id: string, patch: WorkspaceProfilePatch): Promise<void> {
  const d = await db();
  await d.tx(async (q) => {
    const rows = await q.query<Pick<Workspace, "owner_email" | "brand_name" | "marketing_opt_in">>(
      `select owner_email, brand_name, marketing_opt_in from workspaces where id = $1 for update`,
      [id],
    );
    const cur = rows[0];
    if (!cur) return;
    const email = patch.email === undefined ? normEmail(cur.owner_email) : normEmail(patch.email);
    const brandName = patch.brandName === undefined ? cur.brand_name : patch.brandName?.trim() || null;
    // Consent belongs to an address: no address means no consent, and a new address never inherits the old one's.
    let consent: "now" | "clear" | "keep" = "keep";
    if (email && patch.marketingOptIn === true) consent = "now";
    else if (!email || patch.marketingOptIn === false || email !== normEmail(cur.owner_email)) consent = cur.marketing_opt_in ? "clear" : "keep";
    await q.query(
      `update workspaces set
         owner_email = $2,
         brand_name = $3,
         marketing_opt_in = case $4::text when 'now' then true when 'clear' then false else marketing_opt_in end,
         marketing_opt_in_at = case $4::text when 'now' then now() when 'clear' then null else marketing_opt_in_at end,
         marketing_opt_in_source = case $4::text when 'keep' then marketing_opt_in_source else coalesce($5::text, marketing_opt_in_source) end
       where id = $1`,
      [id, email, brandName, consent, patch.optInSource ?? null],
    );
  });
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

/** Null when the stored content no longer passes TestContentSchema; callers treat that as not found. */
function toRecord(row: TestRow): TestRecord | null {
  const content = TestContentSchema.safeParse(row.content);
  if (!content.success) {
    const issue = content.error.issues[0];
    console.error(`test ${row.id} has invalid stored content${issue ? ` (${issue.path.join(".")}: ${issue.message})` : ""}`);
    return null;
  }
  return { ...row, content: content.data, settings: parseSettings(row.settings) };
}

class InvalidStoredTest extends Error {}

/** Runs a single-row test UPDATE ... RETURNING and rolls it back when the stored content is unplayable. */
async function updateTestRow(sql: string, params: (string | null)[]): Promise<TestRecord | null> {
  const d = await db();
  try {
    return await d.tx(async (q) => {
      const rows = await q.query<TestRow>(sql, params);
      if (!rows[0]) return null;
      const rec = toRecord(rows[0]);
      if (!rec) throw new InvalidStoredTest();
      return rec;
    });
  } catch (e) {
    if (e instanceof InvalidStoredTest) return null;
    throw e;
  }
}

export async function createTest(input: {
  workspaceId: string;
  content: TestContent;
  settings?: Partial<Settings>;
  brief?: Brief;
  source: TestSource;
}): Promise<TestRecord> {
  const d = await db();
  const settings = parseSettings(input.settings ?? {});
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const rows = await d.query<TestRow>(
        `insert into tests (workspace_id, slug, content, settings, brief, source)
         values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6) returning *`,
        [input.workspaceId, newSlug(), JSON.stringify(input.content), JSON.stringify(settings), JSON.stringify(input.brief ?? {}), input.source],
      );
      const rec = toRecord(rows[0] as TestRow);
      if (!rec) throw new Error("created test failed validation");
      return rec;
    } catch (e) {
      if (!String(e).includes("tests_slug_key") || attempt === 4) throw e;
    }
  }
  throw new Error("unreachable");
}

export async function getTestForWorkspace(workspaceId: string, testId: string): Promise<TestRecord | null> {
  if (!isUuid(testId)) return null;
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
            (select count(*)::int from leads l where l.test_id = t.id and l.delete_after > now()) as leads
       from tests t
      where t.workspace_id = $1 and t.status <> 'archived'
      order by t.created_at desc`,
    [workspaceId],
  );
}

export async function updateTest(workspaceId: string, testId: string, patch: { content?: TestContent; settings?: Settings }): Promise<TestRecord | null> {
  if (!isUuid(testId)) return null;
  return updateTestRow(
    `update tests set
       content = coalesce($3::jsonb, content),
       settings = coalesce($4::jsonb, settings),
       updated_at = now()
     where id = $1 and workspace_id = $2 returning *`,
    [testId, workspaceId, patch.content ? JSON.stringify(patch.content) : null, patch.settings ? JSON.stringify(patch.settings) : null],
  );
}

export async function setTestStatus(workspaceId: string, testId: string, status: TestStatus): Promise<TestRecord | null> {
  if (!isUuid(testId)) return null;
  return updateTestRow(
    `update tests set status = $3, updated_at = now(),
       published_at = case when $3 = 'published' then coalesce(published_at, now()) else published_at end
     where id = $1 and workspace_id = $2 returning *`,
    [testId, workspaceId, status],
  );
}

export interface PublicTest {
  test: TestRecord;
  plan: Plan;
  isHouse: boolean;
}

/** Published tests only. Drafts are previewed inside the editor, never through a public URL. */
export async function getPublicTest(slug: string): Promise<PublicTest | null> {
  if (!/^[a-z0-9]{4,16}$/.test(slug)) return null;
  const d = await db();
  const rows = await d.query<TestRow & { ws_plan: Plan; ws_expires: Date | null; ws_house: boolean }>(
    `select t.*, w.plan as ws_plan, w.plan_expires_at as ws_expires, w.is_house as ws_house
       from tests t join workspaces w on w.id = t.workspace_id
      where t.slug = $1 and t.status = 'published'`,
    [slug],
  );
  const row = rows[0];
  if (!row) return null;
  const { ws_plan, ws_expires, ws_house, ...testRow } = row;
  const test = toRecord(testRow);
  if (!test) return null;
  return { test, plan: effectivePlan({ plan: ws_plan, plan_expires_at: ws_expires }), isHouse: ws_house };
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

// ---------------------------------------------------------------- events & stats

export const EVENT_TYPES = ["view", "start", "complete", "share", "watermark_click", "cta_click", "lead_submit", "coupon_reveal"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

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
  const leads = await d.query<{ n: number }>(`select count(*)::int as n from leads where test_id = $1 and delete_after > now()`, [testId]);
  // Grouped and ordered by the KST calendar date itself, so late December sorts before early January.
  const byDay = await d.query<{ day: string; views: number; completes: number }>(
    `select to_char(s.d, 'MM-DD') as day,
            count(*) filter (where s.type = 'view')::int as views,
            count(*) filter (where s.type = 'complete')::int as completes
       from (select (created_at at time zone 'Asia/Seoul')::date as d, type
               from events where test_id = $1 and created_at > now() - interval '14 days') s
      group by s.d order by s.d`,
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

/** Leads past their retention date are hidden even before the purge job deletes them. */
export async function listLeads(testId: string, workspaceId: string, plan: Plan): Promise<{ rows: LeadRow[]; total: number; hidden: number }> {
  const d = await db();
  const limit = PLAN_LIMITS[plan].visibleLeads;
  const total =
    (await d.query<{ n: number }>(`select count(*)::int as n from leads where test_id = $1 and workspace_id = $2 and delete_after > now()`, [testId, workspaceId]))[0]?.n ?? 0;
  const rows = await d.query<LeadRow>(
    `select id, result_key, name, phone, email, consent_marketing, consent_night, created_at
       from leads where test_id = $1 and workspace_id = $2 and delete_after > now()
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
// Tickets and sales inquiries are created through limits.ts, which applies the per-IP caps.

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

// ---------------------------------------------------------------- orders

export interface OrderRow {
  id: string;
  order_id: string;
  workspace_id: string;
  product: ProductId;
  amount: number;
  status: "pending" | "paid" | "failed" | "cancelled" | "refunded";
  payment_key: string | null;
  customer_email: string | null;
  paid_at: Date | null;
}

export async function createOrder(workspaceId: string, product: ProductId, email: string | null): Promise<OrderRow> {
  const d = await db();
  const orderId = `tm_${Date.now().toString(36)}_${newToken(6)}`;
  const rows = await d.query<OrderRow>(
    `insert into orders (order_id, workspace_id, product, amount, customer_email) values ($1, $2, $3, $4, $5) returning *`,
    [orderId, workspaceId, product, PRODUCTS[product].amount, normEmail(email)],
  );
  return rows[0] as OrderRow;
}

export async function getOrder(orderId: string): Promise<OrderRow | null> {
  const d = await db();
  const rows = await d.query<OrderRow>(`select * from orders where order_id = $1`, [orderId]);
  return rows[0] ?? null;
}

/** Stored before Toss is asked to confirm, so a charge that later fails to fulfil can still be traced and reconciled. */
export async function attachPaymentKey(orderId: string, paymentKey: string): Promise<void> {
  const d = await db();
  await d.query(`update orders set payment_key = $2 where order_id = $1 and status in ('pending', 'failed')`, [orderId, paymentKey]);
}

/** The order is refunded or cancelled, so it must not grant a plan again. */
export class OrderClosedError extends Error {
  constructor(readonly status: OrderRow["status"]) {
    super(`order is ${status}`);
  }
}

export interface FulfilResult {
  alreadyPaid: boolean;
  plan: Plan;
  planUntil: Date | null;
  /** How the plan changed; null when the order was already paid. */
  change: PlanChange | null;
  workspaceSecret: string;
  ownerEmail: string | null;
}

/** Marks the order paid and applies the plan (rules in nextPlan) in one transaction. Idempotent. */
export async function fulfillOrder(orderId: string, paymentKey: string, raw: unknown): Promise<FulfilResult> {
  const d = await db();
  return d.tx(async (q) => {
    const order = (await q.query<OrderRow>(`select * from orders where order_id = $1 for update`, [orderId]))[0];
    if (!order) throw new Error(`order ${orderId} not found`);
    const ws = (
      await q.query<{ secret: string; owner_email: string | null; plan: Plan; plan_expires_at: Date | null; now: Date }>(
        `select secret, owner_email, plan, plan_expires_at, now() as now from workspaces where id = $1 for update`,
        [order.workspace_id],
      )
    )[0];
    if (!ws) throw new Error(`workspace for order ${orderId} not found`);
    const base = { workspaceSecret: ws.secret, ownerEmail: ws.owner_email };
    if (order.status === "paid") return { ...base, alreadyPaid: true, plan: ws.plan, planUntil: ws.plan_expires_at, change: null };
    if (order.status !== "pending" && order.status !== "failed") throw new OrderClosedError(order.status);
    const product = PRODUCTS[order.product];
    if (!product) throw new Error(`order ${orderId} has unknown product ${order.product}`);
    const change = nextPlan({ plan: ws.plan, expiresAt: ws.plan_expires_at }, product, new Date(ws.now));
    // plan_change has the shape ops.fulfill_manual_order writes, so ops.refund_order can reverse exactly what this order added.
    const planChange = {
      kind: change.kind,
      plan_before: ws.plan,
      until_before: ws.plan_expires_at ? new Date(ws.plan_expires_at).toISOString() : null,
      plan_after: change.plan,
      until_after: change.expiresAt.toISOString(),
      converted_days: Math.round(change.convertedDays * 10_000) / 10_000,
    };
    await q.query(`update orders set status = 'paid', payment_key = $2, raw = $3::jsonb, paid_at = now() where id = $1`, [
      order.id,
      paymentKey,
      JSON.stringify({ toss: raw, plan_change: planChange }),
    ]);
    await q.query(`update workspaces set plan = $2, plan_expires_at = $3::timestamptz where id = $1`, [order.workspace_id, change.plan, change.expiresAt.toISOString()]);
    if (product.concierge) {
      await q.query(
        `insert into sales_leads (workspace_id, email, product, message, source, status)
         values ($1, coalesce($2, 'unknown@invalid'), 'campaign', '캠페인 패스 결제 완료 — 기획 대행 착수 필요', 'order', 'new')`,
        [order.workspace_id, order.customer_email],
      );
    }
    return { ...base, alreadyPaid: false, plan: change.plan, planUntil: change.expiresAt, change };
  });
}

/**
 * Pending orders whose confirm already reached Toss (the payment key is stored first) but never
 * finished, e.g. fulfilment failed and the buyer closed the tab. Checkouts abandoned in the Toss
 * window have no payment key and are not listed.
 */
export async function ordersToReconcile(limit = 50): Promise<OrderRow[]> {
  const d = await db();
  return d.query<OrderRow>(
    `select * from orders
      where status = 'pending' and payment_key is not null
        and created_at between now() - interval '7 days' and now() - interval '10 minutes'
      order by created_at desc limit $1`,
    [limit],
  );
}

/** Only for a definitive rejection; a later successful confirm still fulfils a failed order. */
export async function markOrderFailed(orderId: string, raw: unknown): Promise<void> {
  const d = await db();
  await d.query(`update orders set status = 'failed', raw = $2::jsonb where order_id = $1 and status = 'pending'`, [orderId, JSON.stringify(raw)]);
}

export interface CheckoutTarget {
  brandName: string | null;
  /** Masked owner email, enough for the owner to recognise the workspace. */
  emailHint: string | null;
  tests: number;
  plan: Plan;
  planUntil: string | null;
  /** What paying for the product would do now. */
  after: { plan: PaidPlan; until: string; kind: PlanChange["kind"]; convertedDays: number };
}

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at < 1) return "***";
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}

/** The checkout screen's description of the workspace that will receive the plan. */
export async function checkoutTarget(ws: Workspace, product: Product): Promise<CheckoutTarget> {
  const d = await db();
  const rows = await d.query<{ n: number }>(`select count(*)::int as n from tests where workspace_id = $1 and status <> 'archived'`, [ws.id]);
  const plan = effectivePlan(ws);
  const change = nextPlan({ plan: ws.plan, expiresAt: ws.plan_expires_at }, product, new Date());
  return {
    brandName: ws.brand_name,
    emailHint: maskEmail(ws.owner_email),
    tests: rows[0]?.n ?? 0,
    plan,
    planUntil: plan !== "free" && ws.plan_expires_at ? new Date(ws.plan_expires_at).toISOString() : null,
    after: { plan: change.plan, until: change.expiresAt.toISOString(), kind: change.kind, convertedDays: change.convertedDays },
  };
}

// ---------------------------------------------------------------- outbox & kv

export type OutboxKind = "transactional" | "support" | "sales" | "marketing";

export async function enqueueEmail(input: { to: string; subject: string; body: string; kind: Exclude<OutboxKind, "marketing">; ref?: string }): Promise<void> {
  const d = await db();
  await d.query(`insert into outbox (to_email, subject, body_text, kind, ref) values ($1, $2, $3, $4, $5)`, [input.to, input.subject, input.body, input.kind, input.ref ?? null]);
}

export interface OutboxRow {
  id: number;
  to_email: string;
  subject: string;
  body_text: string;
  attempts: number;
  kind: OutboxKind;
  ref: string | null;
}

/** Auto-acknowledgements (ref 'ack:…', see limits.ts) go last, so a burst of them never delays receipts or operator replies. */
function sendOrder(a: OutboxRow, b: OutboxRow): number {
  const ackA = a.ref?.startsWith("ack:") ? 1 : 0;
  const ackB = b.ref?.startsWith("ack:") ? 1 : 0;
  return ackA - ackB || Number(a.id) - Number(b.id);
}

// Marketing consent for outbox row `o` at send time, the same rule as ops.marketing_allowed
// (005_ops_fixes.sql) minus its confirmation delay, which queue_email already enforced: not
// suppressed, opted in within the last 2 years, and not opted out on any workspace with that address.
const MARKETING_CONSENT_SQL = `
  not exists (select 1 from marketing_suppressions s where s.contact = lower(trim(o.to_email)))
  and exists (select 1 from workspaces w
               where lower(trim(w.owner_email)) = lower(trim(o.to_email)) and not w.is_house
                 and w.marketing_opt_in and w.marketing_opt_in_at > now() - interval '2 years')
  and not exists (select 1 from workspaces w
                   where lower(trim(w.owner_email)) = lower(trim(o.to_email)) and not w.is_house and not w.marketing_opt_in)`;

/**
 * Claims up to `limit` pending emails for one sender: they move to 'sending' under
 * FOR UPDATE SKIP LOCKED, so overlapping flushes (cron plus after() hooks) never get the same row.
 * Marketing mail whose recipient has since withdrawn consent is skipped instead of claimed, and
 * rows left in 'sending' by a flush that died count as a failed attempt after 15 minutes.
 */
export async function claimEmails(limit = 20): Promise<OutboxRow[]> {
  const d = await db();
  const rows = await d.tx(async (q) => {
    await q.query(
      `update outbox set attempts = attempts + 1, claimed_at = null, error = 'delivery interrupted',
         status = case when attempts + 1 >= 5 then 'failed' else 'pending' end
       where status = 'sending' and claimed_at < now() - interval '15 minutes'`,
    );
    await q.query(
      `update outbox o set status = 'skipped',
         error = case when exists (select 1 from marketing_suppressions s where s.contact = lower(trim(o.to_email))) then 'suppressed' else 'no marketing consent' end
       where o.status = 'pending' and o.kind = 'marketing' and not (${MARKETING_CONSENT_SQL})`,
    );
    return q.query<OutboxRow>(
      `update outbox set status = 'sending', claimed_at = now()
        where id in (select id from outbox where status = 'pending' and attempts < 5
                      order by (coalesce(ref, '') like 'ack:%'), id limit $1 for update skip locked)
       returning id, to_email, subject, body_text, attempts, kind, ref`,
      [limit],
    );
  });
  return rows.sort(sendOrder);
}

export async function markEmail(id: number, ok: boolean, error?: string): Promise<void> {
  const d = await db();
  await d.query(
    `update outbox set attempts = attempts + 1,
       status = case when $2 then 'sent' when attempts + 1 >= 5 then 'failed' else 'pending' end,
       sent_at = case when $2 then now() else sent_at end,
       claimed_at = null,
       error = $3
     where id = $1 and status = 'sending'`,
    [id, ok, error ?? null],
  );
}

/** Returns a claimed row untouched (no attempt counted), e.g. when the flush ran out of time. */
export async function releaseEmail(id: number): Promise<void> {
  const d = await db();
  await d.query(`update outbox set status = 'pending', claimed_at = null where id = $1 and status = 'sending'`, [id]);
}

export async function kvSet(key: string, value: string): Promise<void> {
  const d = await db();
  await d.query(
    `insert into kv (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, value],
  );
}

/**
 * Atomic "at most once per `seconds`" guard for periodic work. Concurrent callers serialise on
 * the kv row, and the loser re-checks the updated row, so exactly one of them gets true.
 */
export async function claimInterval(key: string, seconds: number): Promise<boolean> {
  const d = await db();
  const rows = await d.query<{ key: string }>(
    `insert into kv (key, value, updated_at) values ($1, now()::text, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()
       where kv.updated_at <= now() - $2::int * interval '1 second'
     returning key`,
    [key, Math.max(1, Math.floor(seconds))],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------- retention
// What the privacy policy promises, enforced here (src/app/legal/privacy must say the same):
//   leads                     per-test retentionDays (delete_after)
//   tickets + messages        1 year after updated_at, once answered or closed
//   sales_leads               1 year after updated_at
//   events                    deleted after 2 years; ip_hash removed after 90 days
//   generation_attempts       deleted after 90 days
//   ip_hash on workspaces, leads, tickets, sales_leads, and tests.brief.ipHash: removed after 90 days
//   workspaces.owner_email    cleared after 1 year without activity (last_seen_at), unless the
//                             workspace has a paid order from the last 5 years
//   outbox                    deleted 90 days after it was sent, skipped or failed
//   orders                    kept 5 years (전자상거래법), then deleted

export interface RetentionResult {
  counts: Record<string, number>;
  errors: string[];
}

// Large tables are trimmed in batches so a daily run stays well inside a serverless time limit.
const BATCH = 20000;

const RETENTION_STEPS: [name: string, sql: string][] = [
  ["leads_deleted", `delete from leads where delete_after < now()`],
  ["tickets_deleted", `delete from tickets where status in ('answered', 'closed') and updated_at < now() - interval '1 year'`],
  ["sales_leads_deleted", `delete from sales_leads where updated_at < now() - interval '1 year'`],
  ["events_deleted", `delete from events where id in (select id from events where created_at < now() - interval '2 years' limit ${BATCH})`],
  [
    "event_ip_hashes_removed",
    `update events set ip_hash = null where id in (select id from events where ip_hash is not null and created_at < now() - interval '90 days' limit ${BATCH})`,
  ],
  ["lead_ip_hashes_removed", `update leads set ip_hash = null where ip_hash is not null and created_at < now() - interval '90 days'`],
  ["ticket_ip_hashes_removed", `update tickets set ip_hash = null where ip_hash is not null and created_at < now() - interval '90 days'`],
  ["sales_lead_ip_hashes_removed", `update sales_leads set ip_hash = null where ip_hash is not null and created_at < now() - interval '90 days'`],
  ["generation_attempts_deleted", `delete from generation_attempts where created_at < now() - interval '90 days'`],
  ["test_brief_ip_hashes_removed", `update tests set brief = brief - 'ipHash' where brief ? 'ipHash' and created_at < now() - interval '90 days'`],
  ["workspace_ip_hashes_removed", `update workspaces set ip_hash = null where ip_hash is not null and created_at < now() - interval '90 days'`],
  [
    "inactive_owner_emails_cleared",
    `update workspaces w
        set owner_email = null, marketing_opt_in = false, marketing_opt_in_at = null, marketing_opt_in_source = 'retention'
      where w.owner_email is not null and not w.is_house and w.last_seen_at < now() - interval '1 year'
        and not exists (select 1 from orders o
                         where o.workspace_id = w.id and o.status in ('paid', 'refunded')
                           and coalesce(o.paid_at, o.created_at) > now() - interval '5 years')`,
  ],
  [
    "outbox_deleted",
    `delete from outbox where status in ('sent', 'skipped', 'failed') and coalesce(sent_at, claimed_at, created_at) < now() - interval '90 days'`,
  ],
  ["orders_deleted", `delete from orders where coalesce(paid_at, created_at) < now() - interval '5 years'`],
];

/** Runs every retention step; one failing step is reported and does not stop the others. */
export async function purgeRetention(): Promise<RetentionResult> {
  const d = await db();
  const counts: Record<string, number> = {};
  const errors: string[] = [];
  for (const [name, sql] of RETENTION_STEPS) {
    try {
      const rows = await d.query<{ n: number }>(`with x as (${sql} returning 1) select count(*)::int as n from x`);
      counts[name] = rows[0]?.n ?? 0;
    } catch (e) {
      errors.push(`${name}: ${String(e).slice(0, 200)}`);
    }
  }
  await kvSet("retention_last_run", new Date().toISOString());
  return { counts, errors };
}

/** Opportunistic daily run for when the cron is missing or failing; null when it already ran in the last 24 hours. */
export async function purgeRetentionIfDue(): Promise<RetentionResult | null> {
  if (!(await claimInterval("retention_last_run", 86_400))) return null;
  return purgeRetention();
}
