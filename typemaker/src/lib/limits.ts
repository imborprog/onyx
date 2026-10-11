import "server-only";
import { abuseLimits, aiDailyCapDefault, PLAN_LIMITS, type Plan } from "./config";
import { db, type Queryable } from "./db";
import { newToken, type EventType, type TicketCategory } from "./repo";

// Abuse limits for the anonymous endpoints. Each check runs in the same
// transaction as the write it guards, behind a pg_advisory_xact_lock on the
// counter's key, so concurrent requests cannot all read "under the limit" and
// all go through. Only transaction-scoped locks are used: they are safe behind
// the Supavisor transaction pooler and trivially granted on PGlite.
// Never call db().query (or a repo function) inside a tx callback here: on
// PGlite the open transaction holds the only connection.

async function lock(q: Queryable, key: string): Promise<void> {
  await q.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [key]);
}

// ---------------------------------------------------------------- paid model calls & generations

export type GenerationKind = "ai" | "template" | "concierge";
export type AttemptOutcome = "ok" | "refused" | "failed";

export type GenerationReservation =
  | { ok: true; attemptId: string; kind: GenerationKind; aiCapped: boolean }
  | { ok: false; reason: "workspace" | "ip" | "concierge_ip"; limit: number };

/** The operator can change the cap without a deploy: `insert into kv (key, value) values ('ai_daily_cap', '500') on conflict ...`. */
async function aiDailyCap(q: Queryable): Promise<number> {
  const rows = await q.query<{ value: string }>(`select value from kv where key = 'ai_daily_cap'`);
  const raw = rows[0]?.value.trim() ?? "";
  const n = Number(raw);
  return raw !== "" && Number.isInteger(n) && n >= 0 ? n : aiDailyCapDefault();
}

async function aiCallsLastDay(q: Queryable): Promise<number> {
  const rows = await q.query<{ n: number }>(
    `select count(*)::int as n from generation_attempts where kind in ('ai', 'support_ai') and created_at > now() - interval '1 day'`,
  );
  return rows[0]?.n ?? 0;
}

/**
 * Reserves one generation before any work starts. Refused and failed attempts
 * keep counting, so a brief built to be refused cannot be retried for free.
 * When the service-wide AI cap is reached, free-plan requests are downgraded to
 * the template (kind 'template', aiCapped true). Paid plans keep AI: they are
 * bounded by their per-workspace plan limit, but their calls count toward the cap.
 */
export async function reserveGeneration(input: { ipHash: string; workspaceId: string | null; plan: Plan; kind: GenerationKind }): Promise<GenerationReservation> {
  const limits = abuseLimits();
  const d = await db();
  return d.tx(async (q) => {
    await lock(q, `gen:ip:${input.ipHash}`);
    if (input.workspaceId) {
      await lock(q, `gen:ws:${input.workspaceId}`);
      const limit = PLAN_LIMITS[input.plan].aiGenerationsPerDay;
      const rows = await q.query<{ n: number }>(
        `select count(*)::int as n from generation_attempts
          where workspace_id = $1 and kind <> 'support_ai' and created_at > now() - interval '1 day'`,
        [input.workspaceId],
      );
      if ((rows[0]?.n ?? 0) >= limit) return { ok: false, reason: "workspace", limit };
    }
    if (input.plan === "free") {
      const rows = await q.query<{ total: number; concierge: number }>(
        `select count(*)::int as total, count(*) filter (where kind = 'concierge')::int as concierge
           from generation_attempts
          where ip_hash = $1 and kind <> 'support_ai' and created_at > now() - interval '1 day'`,
        [input.ipHash],
      );
      if ((rows[0]?.total ?? 0) >= limits.generationsPerIpPerDay) return { ok: false, reason: "ip", limit: limits.generationsPerIpPerDay };
      if (input.kind === "concierge" && (rows[0]?.concierge ?? 0) >= limits.conciergePerIpPerDay) {
        return { ok: false, reason: "concierge_ip", limit: limits.conciergePerIpPerDay };
      }
    }
    let kind = input.kind;
    let aiCapped = false;
    if (kind === "ai" && input.plan === "free") {
      await lock(q, "gen:ai-global");
      if ((await aiCallsLastDay(q)) >= (await aiDailyCap(q))) {
        kind = "template";
        aiCapped = true;
      }
    }
    const rows = await q.query<{ id: string }>(
      `insert into generation_attempts (ip_hash, workspace_id, kind) values ($1, $2, $3) returning id::text as id`,
      [input.ipHash, input.workspaceId, kind],
    );
    return { ok: true, attemptId: (rows[0] as { id: string }).id, kind, aiCapped };
  });
}

/** Reserves one support auto-answer model call, or returns null when the IP or the service is over its cap. */
export async function reserveSupportAi(ipHash: string): Promise<string | null> {
  const limits = abuseLimits();
  const d = await db();
  return d.tx(async (q) => {
    await lock(q, `gen:ip:${ipHash}`);
    const mine = await q.query<{ n: number }>(
      `select count(*)::int as n from generation_attempts where ip_hash = $1 and kind = 'support_ai' and created_at > now() - interval '1 day'`,
      [ipHash],
    );
    if ((mine[0]?.n ?? 0) >= limits.supportAiPerIpPerDay) return null;
    await lock(q, "gen:ai-global");
    if ((await aiCallsLastDay(q)) >= (await aiDailyCap(q))) return null;
    const rows = await q.query<{ id: string }>(
      `insert into generation_attempts (ip_hash, kind) values ($1, 'support_ai') returning id::text as id`,
      [ipHash],
    );
    return (rows[0] as { id: string }).id;
  });
}

/** Records how a reserved attempt ended, and the workspace it ended up in (new workspaces are created after the reservation). */
export async function finishAttempt(attemptId: string, outcome: AttemptOutcome, workspaceId?: string | null): Promise<void> {
  const d = await db();
  await d.query(`update generation_attempts set outcome = $2, workspace_id = coalesce($3::uuid, workspace_id) where id = $1::bigint`, [
    attemptId,
    outcome,
    workspaceId ?? null,
  ]);
}

// ---------------------------------------------------------------- acknowledgement mail

/**
 * Auto-acknowledgements go to addresses nobody has verified, so they use fixed
 * text only (never the submitter's subject, name or company) and are capped per
 * submitting IP and per recipient. `submissionsToday` is how many earlier
 * submissions this IP made today on the calling form.
 */
async function queueAck(q: Queryable, input: { to: string; subject: string; body: string; kind: "support" | "sales"; ref: string; submissionsToday: number }): Promise<boolean> {
  const limits = abuseLimits();
  if (input.submissionsToday >= limits.acksPerIpPerDay) return false;
  const to = input.to.trim().toLowerCase();
  await lock(q, `ack:to:${to}`);
  const rows = await q.query<{ n: number }>(
    `select count(*)::int as n from outbox where lower(to_email) = $1 and ref like 'ack:%' and created_at > now() - interval '1 day'`,
    [to],
  );
  if ((rows[0]?.n ?? 0) >= limits.acksPerRecipientPerDay) return false;
  await q.query(`insert into outbox (to_email, subject, body_text, kind, ref) values ($1, $2, $3, $4, $5)`, [input.to, input.subject, input.body, input.kind, input.ref]);
  return true;
}

// ---------------------------------------------------------------- support tickets

export type LimitedTicket = { ok: true; id: string; token: string; ackQueued: boolean } | { ok: false };

/** Creates a ticket (and its first message) unless the IP is over its ticket limit. The ack body gets the ticket token. */
export async function createTicketLimited(input: {
  workspaceId: string | null;
  email: string | null;
  name: string | null;
  category: TicketCategory;
  subject: string;
  body: string;
  ipHash: string;
  ack: { to: string; subject: string; body: (token: string) => string } | null;
}): Promise<LimitedTicket> {
  const limits = abuseLimits();
  const d = await db();
  return d.tx(async (q): Promise<LimitedTicket> => {
    await lock(q, `ticket:ip:${input.ipHash}`);
    const recent = await q.query<{ hour: number; day: number }>(
      `select count(*) filter (where created_at > now() - interval '1 hour')::int as hour, count(*)::int as day
         from tickets where ip_hash = $1 and created_at > now() - interval '1 day'`,
      [input.ipHash],
    );
    const hour = recent[0]?.hour ?? 0;
    const day = recent[0]?.day ?? 0;
    if (hour >= limits.ticketsPerIpPerHour || day >= limits.ticketsPerIpPerDay) return { ok: false };
    const token = newToken(16);
    const status = input.category === "refund" || input.category === "privacy" ? "escalated" : "open";
    const rows = await q.query<{ id: string }>(
      `insert into tickets (token, workspace_id, email, name, category, subject, status, ip_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [token, input.workspaceId, input.email, input.name, input.category, input.subject, status, input.ipHash],
    );
    const id = (rows[0] as { id: string }).id;
    await q.query(`insert into ticket_messages (ticket_id, role, body) values ($1, 'customer', $2)`, [id, input.body]);
    const ackQueued = input.ack
      ? await queueAck(q, { to: input.ack.to, subject: input.ack.subject, body: input.ack.body(token), kind: "support", ref: `ack:ticket:${id}`, submissionsToday: day })
      : false;
    return { ok: true, id, token, ackQueued };
  });
}

/** Customer follow-up on an existing ticket (POST /api/support/[token]), capped per ticket per day. Returns false when over the cap. */
export async function addCustomerMessageLimited(ticketId: string, body: string): Promise<boolean> {
  const limits = abuseLimits();
  const d = await db();
  return d.tx(async (q) => {
    await lock(q, `ticket:msg:${ticketId}`);
    const rows = await q.query<{ n: number }>(
      `select count(*)::int as n from ticket_messages where ticket_id = $1 and role = 'customer' and created_at > now() - interval '1 day'`,
      [ticketId],
    );
    if ((rows[0]?.n ?? 0) >= limits.customerMessagesPerTicketPerDay) return false;
    await q.query(`insert into ticket_messages (ticket_id, role, body) values ($1, 'customer', $2)`, [ticketId, body]);
    await q.query(`update tickets set status = case when status = 'escalated' then 'escalated' else 'open' end, updated_at = now() where id = $1`, [ticketId]);
    return true;
  });
}

// ---------------------------------------------------------------- sales inquiries

export type LimitedSalesLead = { ok: true; id: string; ackQueued: boolean } | { ok: false };

export async function createSalesLeadLimited(input: {
  workspaceId: string | null;
  name: string | null;
  company: string | null;
  email: string;
  phone: string | null;
  product: string | null;
  message: string | null;
  source: string;
  ipHash: string;
  ack: { subject: string; body: string } | null;
}): Promise<LimitedSalesLead> {
  const limits = abuseLimits();
  const d = await db();
  return d.tx(async (q): Promise<LimitedSalesLead> => {
    await lock(q, `sales:ip:${input.ipHash}`);
    const recent = await q.query<{ hour: number; day: number }>(
      `select count(*) filter (where created_at > now() - interval '1 hour')::int as hour, count(*)::int as day
         from sales_leads where ip_hash = $1 and created_at > now() - interval '1 day'`,
      [input.ipHash],
    );
    const hour = recent[0]?.hour ?? 0;
    const day = recent[0]?.day ?? 0;
    if (hour >= limits.salesPerIpPerHour || day >= limits.salesPerIpPerDay) return { ok: false };
    const rows = await q.query<{ id: string }>(
      `insert into sales_leads (workspace_id, name, company, email, phone, product, message, source, ip_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [input.workspaceId, input.name, input.company, input.email, input.phone, input.product, input.message, input.source, input.ipHash],
    );
    const id = (rows[0] as { id: string }).id;
    const ackQueued = input.ack
      ? await queueAck(q, { to: input.email, subject: input.ack.subject, body: input.ack.body, kind: "sales", ref: `ack:sales:${id}`, submissionsToday: day })
      : false;
    return { ok: true, id, ackQueued };
  });
}

// ---------------------------------------------------------------- participant events & leads

/**
 * Inserts a participant event unless the IP or the (test, session, type) is over
 * its hourly cap. Both counts read the (ip_hash, created_at) index, so the cost
 * stays bounded by the cap. Returns false when the event was dropped.
 */
export async function insertEventLimited(input: {
  testId: string;
  type: EventType;
  resultKey?: string | null;
  channel?: string | null;
  sessionId?: string | null;
  ipHash: string;
}): Promise<boolean> {
  const limits = abuseLimits();
  const d = await db();
  return d.tx(async (q) => {
    await lock(q, `event:ip:${input.ipHash}`);
    const rows = await q.query<{ id: string }>(
      `with recent as (
         select count(*)::int as ip_n,
                count(*) filter (where test_id = $1::uuid and session_id = $5::text and type = $2::text)::int as session_n
           from events where ip_hash = $6::text and created_at > now() - interval '1 hour'
       )
       insert into events (test_id, type, result_key, channel, session_id, ip_hash)
       select $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text from recent
        where recent.ip_n < $7::int and recent.session_n < $8::int
       returning id::text as id`,
      [
        input.testId,
        input.type,
        input.resultKey ?? null,
        input.channel ?? null,
        input.sessionId ?? null,
        input.ipHash,
        limits.eventsPerIpPerHour,
        limits.eventsPerSessionTypePerHour,
      ],
    );
    return rows.length > 0;
  });
}

export type LimitedLead = { ok: true } | { ok: false; reason: "ip" | "session" };

/** Inserts a lead and its lead_submit event unless the IP, or the browser session when known, is over its cap for this test. */
export async function insertLeadLimited(input: {
  testId: string;
  workspaceId: string;
  resultKey: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  consentMarketing: boolean;
  consentNight: boolean;
  retentionDays: number;
  sessionId: string | null;
  ipHash: string;
}): Promise<LimitedLead> {
  const limits = abuseLimits();
  const d = await db();
  return d.tx(async (q): Promise<LimitedLead> => {
    await lock(q, `lead:ip:${input.ipHash}`);
    const recent = await q.query<{ day: number; test_hour: number }>(
      `select count(*)::int as day,
              count(*) filter (where test_id = $2 and created_at > now() - interval '1 hour')::int as test_hour
         from leads where ip_hash = $1 and created_at > now() - interval '1 day'`,
      [input.ipHash, input.testId],
    );
    if ((recent[0]?.day ?? 0) >= limits.leadsPerIpPerDay || (recent[0]?.test_hour ?? 0) >= limits.leadsPerIpPerTestPerHour) {
      return { ok: false, reason: "ip" };
    }
    if (input.sessionId) {
      const mine = await q.query<{ n: number }>(
        `select count(*)::int as n from events
          where test_id = $1 and type = 'lead_submit' and session_id = $2 and created_at > now() - interval '1 day'`,
        [input.testId, input.sessionId],
      );
      if ((mine[0]?.n ?? 0) >= limits.leadsPerSessionPerTestPerDay) return { ok: false, reason: "session" };
    }
    await q.query(
      `insert into leads (test_id, workspace_id, result_key, name, phone, email, consent_privacy, consent_marketing, consent_night, age_over_14, delete_after, ip_hash)
       values ($1, $2, $3, $4, $5, $6, true, $7, $8, true, now() + make_interval(days => $9::int), $10)`,
      [input.testId, input.workspaceId, input.resultKey, input.name, input.phone, input.email, input.consentMarketing, input.consentNight, input.retentionDays, input.ipHash],
    );
    await q.query(`insert into events (test_id, type, result_key, session_id, ip_hash) values ($1, 'lead_submit', $2, $3, $4)`, [
      input.testId,
      input.resultKey,
      input.sessionId,
      input.ipHash,
    ]);
    return { ok: true };
  });
}
