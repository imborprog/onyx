// Exercises the operator functions Claude uses (ops schema) against the local PGlite DB.
// Run after the e2e smoke test with the server stopped (PGlite allows one process).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { applyMigrations } from "./pglite-migrate.mjs";

const db = await PGlite.create(process.env.PGLITE_DIR ?? ".data/pglite");
await applyMigrations(db);
let failures = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "  ok " : "  FAIL"} ${name} ${cond ? "" : detail}`);
  if (!cond) failures++;
};
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];
const throws = async (sql, needle, params = []) => {
  try {
    await q(sql, params);
    return false;
  } catch (e) {
    return String(e).includes(needle);
  }
};
const count = async (sql, params = []) => (await one(`select count(*)::int as n from (${sql}) x`, params)).n;

// Marketing needs the sender's contact details and, normally, a 7-day wait after the opt-in.
await q(`insert into kv (key, value) values ('sender_contact', '테스트 사업자 · 서울시 어딘가 · 02-000-0000 · help@example.com'), ('marketing_confirm_days', '0')
         on conflict (key) do update set value = excluded.value`);

const s = (await one("select ops.summary(7) as s")).s;
check("summary counts the e2e activity", s.tickets_waiting >= 2 && s.sales_leads_new >= 1 && s.generation_queue >= 1 && s.leads >= 1, JSON.stringify(s));
check("summary reports overdue leads and the last purge", s.leads_overdue === 0 && typeof s.retention_last_run === "string", JSON.stringify(s));

// ---------------------------------------------------------------- tickets
const tickets = await q("select * from ops.open_tickets");
const general = tickets.find((t) => t.category === "general");
const refund = tickets.find((t) => t.category === "refund");
check("open_tickets lists the general ticket with its messages", general && general.messages.length >= 2);
check("refund ticket starts escalated", refund?.status === "escalated");
await q("select ops.reply_ticket($1, $2, 'answered')", [general.id, "네, 결과마다 다른 코드를 줄 수 있어요. 설정 탭에서 '결과마다 다른 코드 주기'를 열어 입력하세요."]);
check("reply_ticket marks answered", (await one("select status from tickets where id = $1", [general.id])).status === "answered");
const mail = await q("select * from outbox where ref = $1 and subject like '%문의 답변%'", [`ticket:${general.id}`]);
check("reply queues an email with the thread link", mail.length === 1 && mail[0].body_text.includes("/support/"));
check("reply_ticket refuses an admin link", await throws(`select ops.reply_ticket('${general.id}', 'http://x/w/abcdef')`, "관리 링크"));
check("reply_ticket refuses a secret-looking string", await throws(`select ops.reply_ticket('${general.id}', '${"ab".repeat(20)}')`, "관리 링크"));

// ---------------------------------------------------------------- lost admin link
check("dashboard_link_for is gone", (await one("select to_regprocedure('ops.dashboard_link_for(text)') is null as gone")).gone);
const n = (await one("select ops.send_dashboard_link('OWNER@example.com') as n")).n;
check("send_dashboard_link matches email case-insensitively", n >= 1, String(n));
const linkMail = await q("select * from outbox where ref = 'dashboard_link'");
check("send_dashboard_link mails the links only to the stored owner address", linkMail.length === 1 && linkMail[0].to_email === "owner@example.com" && linkMail[0].body_text.includes("/w/"));
await q("select ops.send_dashboard_link('owner@example.com')");
check("send_dashboard_link sends at most one mail per hour", (await count("select 1 from outbox where ref = 'dashboard_link'")) === 1);
check("send_dashboard_link returns 0 for an unknown address", (await one("select ops.send_dashboard_link('nobody@example.com') as n")).n === 0);
check("outbox_recent has no bodies", !(await q("select * from ops.outbox_recent limit 1")).some((r) => "body_text" in r));

// ---------------------------------------------------------------- sales
const inbox = await q("select * from ops.sales_inbox");
const agency = inbox.find((l) => l.email === "agency@example.com");
check("sales_inbox has the agency inquiry", Boolean(agency));
await q("select ops.update_sales_lead($1, 'contacted', '대행사 플랜 안내', '[유형공장] 대행사 플랜 안내', $2)", [agency.id, "안녕하세요, 대행사 플랜은 월 149,000원이에요."]);
check("update_sales_lead queues the reply", (await count("select 1 from outbox where ref = $1", [`sales:${agency.id}`])) === 1);
check("update_sales_lead refuses an admin link", await throws(`select ops.update_sales_lead('${agency.id}', 'contacted', null, '안내', 'https://x/w/0123abcd')`, "관리 링크"));

// ---------------------------------------------------------------- concierge & house tests
const queue = await q("select * from ops.generation_queue");
check("generation_queue has the concierge request", queue.length >= 1);
const content = readFileSync("ops/house-tests/autumn-cafe.json", "utf8");
const testId = (await one("select ops.fulfill_generation($1, $2::jsonb) as id", [queue[0].id, content])).id;
check("fulfill_generation returns the new test id, not a link", /^[0-9a-f-]{36}$/.test(testId), testId);
const ready = await q("select body_text from outbox where ref = $1", [`generation:${queue[0].id}`]);
check("fulfill queues a ready email with the admin link to the owner", ready.length === 1 && ready[0].body_text.includes("/w/") && ready[0].body_text.includes(testId));
check("fulfill_generation rejects an unknown request", await throws("select ops.fulfill_generation(gen_random_uuid(), '{}'::jsonb)", "not found"));
check("create_house_test validates content", await throws(`select ops.create_house_test('{"title":"x","questions":[],"results":[]}'::jsonb)`, "invalid content"));
check("validate_content rejects missing arrays", await throws(`select ops.create_house_test('{"title":"x"}'::jsonb)`, "results 배열이 없습니다"));
check("create_house_test validates settings", await throws("select ops.create_house_test($1::jsonb, '{\"theme\":{\"accent\":\"#f60\"}}'::jsonb)", "theme.accent", [content]));

// ---------------------------------------------------------------- marketing consent
const cands = await q("select * from ops.upgrade_candidates");
check("upgrade_candidates lists the opted-in owner", cands.some((c) => c.owner_email === "owner@example.com" && Number(c.leads) >= 1), JSON.stringify(cands));
check("marketing mail to a non-opted-in address is blocked", await throws("select ops.queue_email('buyer@example.com', '할인', '본문', 'marketing')", "보낼 수 없습니다"));
await q("select ops.queue_email('OWNER@example.com', '리드가 쌓였어요', '본문', 'marketing')");
const mk = await one("select subject, body_text, status from outbox where kind = 'marketing' order by id desc limit 1");
check(
  "marketing mail gets the (광고) prefix, sender contact and opt-out route",
  mk.subject.startsWith("(광고)") && mk.body_text.includes("수신거부") && mk.body_text.includes("02-000-0000") && mk.body_text.includes("/support"),
);
check("a second ad within 30 days is refused", await throws("select ops.queue_email('owner@example.com', '또 할인', '본문', 'marketing')", "30일"));

const ws = await one("select id from workspaces where owner_email = 'owner@example.com' limit 1");
const unsubscribed = (await one("select ops.unsubscribe(' Owner@Example.com ') as n")).n;
check("unsubscribe matches case-insensitively and returns the workspace count", unsubscribed === 1, String(unsubscribed));
check("unsubscribe removes the candidate", !(await q("select * from ops.upgrade_candidates")).some((c) => c.owner_email === "owner@example.com"));
check("unsubscribe cancels queued marketing mail", (await one("select status from outbox where kind = 'marketing' order by id desc limit 1")).status === "skipped");
check("unsubscribe suppresses the address", (await count("select 1 from marketing_suppressions where contact = 'owner@example.com'")) === 1);
check("the consent trigger mails the opt-out result notice", (await count("select 1 from outbox where ref = 'consent:out' and to_email = 'owner@example.com'")) === 1);

// Suppression outlives a fresh opt-in; only an owner-approved lift removes it.
await q("update workspaces set marketing_opt_in = true, marketing_opt_in_at = now(), marketing_opt_in_source = 'dashboard' where id = $1", [ws.id]);
check("a re-tick does not undo 수신거부", !(await one("select ops.marketing_allowed('owner@example.com') as ok")).ok);
check("lift_suppression needs the owner's approval note", await throws("select ops.lift_suppression('owner@example.com', '')", "p_note"));
check("lift_suppression removes the address", (await one("select ops.lift_suppression('owner@example.com', '본인 요청, 대표 승인 (e2e)') as n")).n === 1);
check("marketing is allowed again after the lift", (await one("select ops.marketing_allowed('owner@example.com') as ok")).ok);
await q("update kv set value = '7' where key = 'marketing_confirm_days'");
check("marketing waits marketing_confirm_days after an opt-in", !(await one("select ops.marketing_allowed('owner@example.com') as ok")).ok);
await q("update kv set value = '0' where key = 'marketing_confirm_days'");
await q("update workspaces set marketing_opt_in_at = now() - interval '25 months' where id = $1", [ws.id]);
check("an opt-in older than 2 years no longer counts", !(await one("select ops.marketing_allowed('owner@example.com') as ok")).ok);
await q("update workspaces set marketing_opt_in_at = now() where id = $1", [ws.id]);
const other = await one("insert into workspaces (secret, owner_email, marketing_opt_in) values ('e2eother0000000000000000', 'Owner@Example.com', false) returning id");
check("opting out on any workspace with the same email wins", !(await one("select ops.marketing_allowed('owner@example.com') as ok")).ok);
await q("delete from workspaces where id = $1", [other.id]);

// Participants withdraw through ops.withdraw_lead_marketing (phone in any format).
const leadsBefore = await count("select 1 from leads where phone = '010-1234-5678' and consent_marketing");
const withdrawn = (await one("select ops.withdraw_lead_marketing('+82 10-1234-5678') as n")).n;
check("withdraw_lead_marketing finds the participant's leads by phone", leadsBefore >= 1 && withdrawn >= leadsBefore, `${leadsBefore} -> ${withdrawn}`);
check("withdraw_lead_marketing clears marketing consent", (await count("select 1 from leads where phone = '010-1234-5678' and (consent_marketing or consent_night)")) === 0);
check("withdraw_lead_marketing suppresses the phone", (await count("select 1 from marketing_suppressions where contact = '01012345678'")) === 1);
check("withdraw_lead_marketing tells the creator", (await count("select 1 from outbox where ref = 'lead_withdrawal' and to_email = 'owner@example.com'")) >= 1);
check("withdraw_lead_marketing returns 0 for an unknown contact", (await one("select ops.withdraw_lead_marketing('010-0000-0000') as n")).n === 0);

// ---------------------------------------------------------------- plans, bank transfers, refunds
const until = (await one("select ops.grant_plan($1, 'pro', 30, 'e2e test') as u", [ws.id])).u;
check("grant_plan extends the plan", new Date(until) > new Date());
check("grant_plan refuses a silent tier change", await throws(`select ops.grant_plan('${ws.id}', 'agency', 30, 'e2e test')`, "p_force"));
check("grant_plan requires a note", await throws(`select ops.grant_plan('${ws.id}', 'pro', 30, '')`, "p_note"));
const manual = (await one("select ops.fulfill_manual_order($1, 'agency_month', '계좌이체 입금 확인 (e2e)') as r", [ws.id])).r;
check("fulfill_manual_order applies the product like a card payment", manual.kind === "upgrade" && manual.plan === "agency", JSON.stringify(manual));
const s2 = (await one("select ops.summary(1) as s")).s;
check("bank transfers count as revenue", s2.orders_paid >= 1 && s2.revenue_krw >= 149000, JSON.stringify(s2));
const refunded = (await one("select ops.refund_order($1, 'e2e 전액 환불 (대표 승인)') as r", [manual.order_id])).r;
check(
  "refund_order reverses exactly what the order added",
  refunded.kind === "upgrade" && refunded.inferred === false && refunded.plan_after === "pro" && Math.abs(new Date(refunded.until_after) - new Date(until)) < 60_000,
  JSON.stringify(refunded),
);
const s3 = (await one("select ops.summary(1) as s")).s;
check("refunds leave revenue and are counted", s3.orders_refunded >= 1 && s3.refunded_krw >= 149000 && s3.revenue_krw === s2.revenue_krw - 149000, JSON.stringify(s3));
check("refund_order refuses a second refund", await throws(`select ops.refund_order('${manual.order_id}', '또')`, "이미 환불"));
const campaign = (await one("select ops.fulfill_manual_order($1, 'campaign', '캠페인 패스 입금 확인 (e2e)') as r", [ws.id])).r;
check("a campaign pass opens the concierge sales lead", (await count("select 1 from sales_leads where workspace_id = $1 and source = 'order' and status = 'new'", [ws.id])) === 1);
await q("select ops.refund_order($1, '캠페인 패스 환불 (e2e)')", [campaign.order_id]);
check("refunding a campaign pass closes its sales lead", (await count("select 1 from sales_leads where workspace_id = $1 and source = 'order' and status = 'lost'", [ws.id])) === 1);

check("every write is logged", (await one("select count(*)::int as n from ops_log")).n >= 15);

await db.close();
console.log(failures === 0 ? "\nOPS CHECK PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
