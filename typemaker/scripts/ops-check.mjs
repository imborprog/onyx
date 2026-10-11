// Exercises the operator functions Claude uses (ops schema) against the local PGlite DB.
// Run after the e2e smoke test with the server stopped (PGlite allows one process).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = await PGlite.create(process.env.PGLITE_DIR ?? ".data/pglite");
let failures = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "  ok " : "  FAIL"} ${name} ${cond ? "" : detail}`);
  if (!cond) failures++;
};
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const throws = async (sql, needle) => {
  try {
    await q(sql);
    return false;
  } catch (e) {
    return String(e).includes(needle);
  }
};

const s = (await q("select ops.summary(7) as s"))[0].s;
check("summary counts the e2e activity", s.tickets_waiting >= 2 && s.sales_leads_new >= 1 && s.generation_queue >= 1 && s.leads >= 1, JSON.stringify(s));

const tickets = await q("select * from ops.open_tickets");
const general = tickets.find((t) => t.category === "general");
const refund = tickets.find((t) => t.category === "refund");
check("open_tickets lists the general ticket with its messages", general && general.messages.length >= 2);
check("refund ticket starts escalated", refund?.status === "escalated");
await q("select ops.reply_ticket($1, $2, 'answered')", [general.id, "네, 결과마다 다른 코드를 줄 수 있어요. 설정 탭에서 '결과마다 다른 코드 주기'를 열어 입력하세요."]);
check("reply_ticket marks answered", (await q("select status from tickets where id = $1", [general.id]))[0].status === "answered");
const mail = await q("select * from outbox where ref = $1 and subject like '%문의 답변%'", [`ticket:${general.id}`]);
check("reply queues an email with the thread link", mail.length === 1 && mail[0].body_text.includes("/support/"));

const inbox = await q("select * from ops.sales_inbox");
const agency = inbox.find((l) => l.email === "agency@example.com");
check("sales_inbox has the agency inquiry", Boolean(agency));
await q("select ops.update_sales_lead($1, 'contacted', '대행사 플랜 안내', '[유형공장] 대행사 플랜 안내', $2)", [agency.id, "안녕하세요, 대행사 플랜은 월 149,000원이에요."]);
check("update_sales_lead queues the reply", (await q("select count(*)::int as n from outbox where ref = $1", [`sales:${agency.id}`]))[0].n === 1);

const queue = await q("select * from ops.generation_queue");
check("generation_queue has the concierge request", queue.length >= 1);
const content = readFileSync("ops/house-tests/autumn-cafe.json", "utf8");
const link = (await q("select ops.fulfill_generation($1, $2::jsonb) as url", [queue[0].id, content]))[0].url;
check("fulfill_generation returns the dashboard link", link.includes("/w/") && link.includes("/t/"));
check("fulfill queues a ready email", (await q("select count(*)::int as n from outbox where ref = $1", [`generation:${queue[0].id}`]))[0].n === 1);
check("fulfill_generation rejects an unknown request", await throws("select ops.fulfill_generation(gen_random_uuid(), '{}'::jsonb)", "not found"));
check("create_house_test validates content", await throws(`select ops.create_house_test('{"title":"x","questions":[],"results":[]}'::jsonb)`, "invalid content"));

const cands = await q("select * from ops.upgrade_candidates");
check("upgrade_candidates lists the opted-in owner", cands.some((c) => c.owner_email === "owner@example.com" && Number(c.leads) >= 1));
check("marketing mail to a non-opted-in address is blocked", await throws("select ops.queue_email('buyer@example.com', '할인', '본문', 'marketing')", "opted in"));
await q("select ops.queue_email('owner@example.com', '리드가 쌓였어요', '본문', 'marketing')");
const mk = await q("select subject, body_text from outbox where kind = 'marketing' order by id desc limit 1");
check("marketing mail gets the (광고) prefix and opt-out line", mk[0].subject.startsWith("(광고)") && mk[0].body_text.includes("수신거부"));
await q("select ops.unsubscribe('owner@example.com')");
check("unsubscribe removes the candidate", !(await q("select * from ops.upgrade_candidates")).some((c) => c.owner_email === "owner@example.com"));

const ws = (await q("select id from workspaces where owner_email = 'owner@example.com' limit 1"))[0];
const until = (await q("select ops.grant_plan($1, 'pro', 30, 'e2e test') as u", [ws.id]))[0].u;
check("grant_plan extends the plan", new Date(until) > new Date());
check("dashboard_link_for matches email case-insensitively", (await q("select * from ops.dashboard_link_for('OWNER@example.com')")).length >= 1);
check("every write is logged", (await q("select count(*)::int as n from ops_log"))[0].n >= 8);

await db.close();
console.log(failures === 0 ? "\nOPS CHECK PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
