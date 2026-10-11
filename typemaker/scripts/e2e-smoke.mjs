// End-to-end smoke test against a running server (default http://localhost:3100) on a fresh
// PGlite database (seed the house tests first). Walks the main flows a creator, a participant, a
// support customer and a buyer go through, then checks that the abuse limits refuse floods.
// Each logical client sends its own x-forwarded-for, because the limits are keyed per IP.
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
let failures = 0;

function check(name, cond, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

const IP = {
  creator: "198.51.100.10",
  participant: "198.51.100.20",
  participant2: "198.51.100.21",
  support: "198.51.100.30",
  buyer: "198.51.100.40",
  visitor: "198.51.100.45",
  genFlood: "198.51.100.60",
  leadFlood: "198.51.100.61",
  ticketFlood: "198.51.100.62",
  salesFlood: "198.51.100.63",
};

async function call(path, { method = "GET", body, ws, ip = IP.visitor, headers = {} } = {}) {
  const h = { "x-forwarded-for": ip, ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (ws) h["x-workspace"] = ws;
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, text, json, headers: res.headers };
}

console.log(`E2E against ${BASE}`);

// 1. Public pages
for (const p of ["/", "/pricing", "/gallery", "/create", "/my", "/support", "/contact", "/legal/privacy", "/legal/terms", "/robots.txt", "/sitemap.xml"]) {
  const r = await call(p);
  check(`GET ${p} -> 200`, r.status === 200, String(r.status));
}
const gallery = await call("/gallery");
const houseSlug = gallery.text.match(/href="\/t\/([a-z0-9]{8})"/)?.[1];
check("gallery lists seeded house tests", Boolean(houseSlug));

// 2. Creator: create a test (template mode, no AI key)
const created = await call("/api/tests", {
  method: "POST",
  ip: IP.creator,
  body: { brief: { topic: "커피 취향", brandName: "오늘의커피", goal: "coupon", resultCount: 4, questionCount: 6, tone: "playful" }, email: "owner@example.com", marketingOptIn: true },
});
check("POST /api/tests creates a test", created.status === 200 && created.json?.mode === "ready", created.text.slice(0, 200));
const ws = created.json?.workspaceSecret;
const testId = created.json?.testId;

const dash = await call(`/w/${ws}`);
check("dashboard renders", dash.status === 200 && dash.text.includes("커피 취향") && dash.text.includes("오늘의커피의 테스트"));
check("dashboard upgrade link carries the workspace to pricing", dash.text.includes(`/pricing?ws=${ws}`));
const editor = await call(`/w/${ws}/t/${testId}`);
check("editor renders", editor.status === 200 && editor.text.includes("질문·결과"));
check("editor has no public preview link with the secret", !editor.text.includes(`?preview=${ws}`));
check("bad workspace secret -> 404", (await call(`/w/${"0".repeat(40)}`)).status === 404);

const unauth = await call(`/api/tests/${testId}`, { method: "PATCH", body: { settings: {} } });
check("PATCH without workspace -> 401", unauth.status === 401);
check("malformed test id -> 404, not 500", (await call("/api/tests/not-a-uuid", { method: "PATCH", ws, body: { settings: {} } })).status === 404);

// 3. Enable lead form + gated coupon + CTA, then publish
const settings = {
  brandName: "오늘의커피",
  theme: { accent: "#ff5a36", style: "pop" },
  lead: { enabled: true, fields: ["name", "phone"], purpose: "쿠폰 안내", retentionDays: 90, askMarketing: true, placement: "after_result", headline: "쿠폰 받기" },
  coupon: { enabled: true, title: "아메리카노 1+1", code: "COFFEE11", perResult: { spark: "SPARK20" }, requireLead: true, note: "12/31까지" },
  cta: { enabled: true, label: "매장 위치 보기", url: "https://example.com/store" },
};
const patched = await call(`/api/tests/${testId}`, { method: "PATCH", ws, body: { settings } });
check("PATCH settings", patched.status === 200, patched.text);
const badCta = await call(`/api/tests/${testId}`, { method: "PATCH", ws, body: { settings: { ...settings, cta: { enabled: true, label: "x", url: "javascript:alert(1)" } } } });
check("rejects non-http CTA url", badCta.status === 400);

const published = await call(`/api/tests/${testId}/publish`, { method: "POST", ws, body: { status: "published" } });
check("publish", published.status === 200 && published.json?.status === "published", published.text);
const slug = published.json?.slug;

// 4. Participant: view, play, lead, share. Coupon codes never reach the page source (C3).
const page = await call(`/t/${slug}`, { ip: IP.participant });
check("public test page renders", page.status === 200 && page.text.includes("커피 취향"));
check("og meta present", page.text.includes(`/api/og?slug=${slug}`));
check("page source has no coupon codes", !page.text.includes("COFFEE11") && !page.text.includes("SPARK20"));
const gatedCoupon = await call(`/api/coupon?slug=${slug}&key=spark`, { ip: IP.participant });
check("GET /api/coupon withholds a lead-gated code", gatedCoupon.status === 200 && gatedCoupon.json?.code === null, gatedCoupon.text);

const sid = "e2e" + Date.now();
for (const type of ["view", "start", "complete", "share", "watermark_click"]) {
  const r = await call("/api/events", { method: "POST", ip: IP.participant, body: { slug, type, resultKey: type === "complete" || type === "share" ? "spark" : null, channel: type === "share" ? "copy" : null, sessionId: sid } });
  check(`event ${type}`, r.status === 200, r.text);
}
const botEvent = await fetch(`${BASE}/api/events`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "kakaotalk-scrap/1.0", "x-forwarded-for": IP.participant }, body: JSON.stringify({ slug, type: "view" }) });
check("bot events are ignored", botEvent.status === 200);

const leadBody = { slug, resultKey: "spark", name: "홍길동", phone: "010-1234-5678", email: null, consentPrivacy: true, ageOver14: true, consentMarketing: true, consentNight: false };
const noConsent = await call("/api/leads", { method: "POST", ip: IP.participant, body: { ...leadBody, consentPrivacy: false } });
check("lead without consent -> 400", noConsent.status === 400);
const lead = await call("/api/leads", { method: "POST", ip: IP.participant, body: { ...leadBody, sessionId: sid } });
check("lead with consent releases the per-result coupon (C1)", lead.status === 200 && lead.json?.ok === true && lead.json?.coupon === "SPARK20", lead.text);
const csv = await call(`/api/tests/${testId}/leads?ws=${ws}`);
check("lead CSV download", csv.status === 200 && csv.text.includes("홍길동") && csv.headers.get("content-type")?.includes("text/csv"));
check("lead CSV requires secret", (await call(`/api/tests/${testId}/leads`)).status === 401);

const shared = await call(`/t/${slug}/r/spark`, { ip: IP.participant });
check("shared result page", shared.status === 200 && shared.text.includes("친구의 결과"));
const og = await fetch(`${BASE}/api/og?slug=${slug}&key=spark`);
check("OG image renders png", og.status === 200 && (og.headers.get("content-type") ?? "").includes("image/png"), String(og.status));
const story = await fetch(`${BASE}/api/og?slug=${slug}&key=spark&format=story`);
check("story OG image renders png", story.status === 200 && (story.headers.get("content-type") ?? "").includes("image/png"), String(story.status));

const stats = await call(`/w/${ws}/t/${testId}`);
check("editor shows lead", stats.text.includes("리드 1건") || stats.text.includes("홍길동"));

// Ungated coupons come from GET /api/coupon (C2): the per-result code, else the common one.
const ungated = await call(`/api/tests/${testId}`, { method: "PATCH", ws, body: { settings: { ...settings, coupon: { ...settings.coupon, requireLead: false } } } });
check("PATCH coupon to ungated", ungated.status === 200, ungated.text);
check("GET /api/coupon gives the per-result code", (await call(`/api/coupon?slug=${slug}&key=spark`)).json?.code === "SPARK20");
check("GET /api/coupon falls back to the common code", (await call(`/api/coupon?slug=${slug}&key=planner`)).json?.code === "COFFEE11");
await call(`/api/tests/${testId}`, { method: "PATCH", ws, body: { settings } });

// 5. Drafts are only previewed inside the editor (C5)
await call(`/api/tests/${testId}/publish`, { method: "POST", ws, body: { status: "draft" } });
check("unpublished test hidden", (await call(`/t/${slug}`)).status === 404);
check("no draft preview by URL secret", (await call(`/t/${slug}?preview=${ws}`)).status === 404);
check("no coupon for an unpublished test", (await call(`/api/coupon?slug=${slug}&key=spark`)).json?.code === null);
await call(`/api/tests/${testId}/publish`, { method: "POST", ws, body: { status: "published" } });

// 6. Concierge request (keeps the owner's opt-in: the checkbox value is authoritative)
const concierge = await call("/api/tests", {
  method: "POST",
  ws,
  ip: IP.creator,
  body: { brief: { topic: "신학기 공부 습관", goal: "leads", resultCount: 4, questionCount: 8, tone: "warm" }, email: "owner@example.com", marketingOptIn: true, mode: "concierge" },
});
check("concierge request queued", concierge.status === 200 && concierge.json?.mode === "queued", concierge.text);
const noContact = await call("/api/tests", { method: "POST", ip: IP.visitor, body: { brief: { topic: "연락처 없는 요청" }, mode: "concierge" } });
check("concierge request without an email -> 400", noContact.status === 400, noContact.text);

// 7. Profile: '' clears, a missing key leaves it, opting in needs an email
const clearBrand = await call("/api/workspace", { method: "PATCH", ws, body: { brandName: "" } });
check("PATCH workspace clears the brand name", clearBrand.status === 200 && !(await call(`/w/${ws}`)).text.includes("오늘의커피의 테스트"), clearBrand.text);
await call("/api/workspace", { method: "PATCH", ws, body: { brandName: "오늘의커피" } });
const optInNoEmail = await call("/api/workspace", { method: "PATCH", ws, body: { email: "", marketingOptIn: true } });
check("opting in without an email -> 400", optInNoEmail.status === 400 && (optInNoEmail.json?.error ?? "").includes("이메일"), optInNoEmail.text);

// 8. Support
const ticket = await call("/api/support", { method: "POST", ws, ip: IP.support, body: { category: "general", email: "owner@example.com", subject: "쿠폰 코드 질문", body: "결과마다 다른 쿠폰 코드를 줄 수 있나요?" } });
check("support ticket created", ticket.status === 200 && Boolean(ticket.json?.token), ticket.text);
const thread = await call(`/support/${ticket.json?.token}`);
check("ticket page shows FAQ auto-answer", thread.status === 200 && thread.text.includes("자동") && thread.text.includes("쿠폰"));
const reply = await call(`/api/support/${ticket.json?.token}`, { method: "POST", ip: IP.support, body: { body: "고맙습니다. 한 가지 더 물어볼게요." } });
check("customer follow-up", reply.status === 200);
const refund = await call("/api/support", { method: "POST", ip: IP.support, body: { category: "refund", email: "buyer@example.com", subject: "환불 요청", body: "결제한 프로 이용권 환불 부탁드립니다." } });
check("refund ticket created", refund.status === 200);

// 9. Sales & payments
const sales = await call("/api/sales", { method: "POST", ip: IP.buyer, body: { email: "agency@example.com", company: "브랜드랩", product: "agency_month", message: "고객사 5곳에 쓰고 싶어요", source: "contact", consent: true } });
check("sales inquiry", sales.status === 200, sales.text);
check("sales inquiry needs consent", (await call("/api/sales", { method: "POST", ip: IP.buyer, body: { email: "a@b.co", source: "contact" } })).status === 400);

const pricing = await call(`/pricing?ws=${ws}`);
check("pricing passes the dashboard's workspace on to checkout", pricing.status === 200 && pricing.text.includes(`/checkout?product=pro_month&amp;ws=${ws}`));
check("plain pricing links carry no workspace", !(await call("/pricing")).text.includes("&amp;ws="));
const checkout = await call(`/checkout?product=agency_month&ws=${ws}`);
check("checkout ?ws= shows the target workspace", checkout.status === 200 && checkout.text.includes("오늘의커피") && checkout.text.includes("ow***@example.com"));
check("checkout explains card payments are off", checkout.text.includes("카드 결제는 준비 중"));
const badLink = await call(`/checkout?product=pro_month&ws=${"0".repeat(40)}`);
check("checkout with an unknown ?ws= asks for the admin link", badLink.status === 200 && badLink.text.includes("관리 링크를 찾을 수 없어요"));
const target = await call("/api/workspace?product=agency_month", { ws });
check(
  "GET /api/workspace describes the checkout target",
  target.status === 200 && target.json?.brandName === "오늘의커피" && target.json?.tests >= 1 && target.json?.plan === "free" && target.json?.after?.plan === "agency",
  target.text,
);
check("GET /api/workspace rejects an unknown product", (await call("/api/workspace?product=nope", { ws })).status === 400);
const order = await call("/api/orders", { method: "POST", ws, ip: IP.buyer, body: { product: "pro_month", email: "owner@example.com" } });
check("orders disabled without Toss keys -> 503", order.status === 503, String(order.status));
const badOrderWs = await call("/api/orders", { method: "POST", ws: "f".repeat(40), ip: IP.buyer, body: { product: "pro_month", email: "owner@example.com" } });
check("orders never fall back to a new workspace", badOrderWs.status === 503 || badOrderWs.status === 400, String(badOrderWs.status));
const confirm = await call("/api/payments/confirm", { method: "POST", ip: IP.buyer, body: { paymentKey: "x", orderId: "tm_missing_x", amount: 49000 } });
check("confirm unknown order -> 404", confirm.status === 404);
const fail = await call(`/checkout/fail?code=PAY_PROCESS_CANCELED&message=${encodeURIComponent("<b>피싱 문구</b>")}`);
// Next's router state still carries the query string as escaped JSON; what matters is that it is never rendered.
check("fail page shows fixed copy, never the message in the URL", fail.status === 200 && fail.text.includes("결제된 금액은 없어요") && !fail.text.includes("<b>피싱"));

// 10. Abuse limits refuse floods
const genCodes = [];
for (let i = 0; i < 6; i++) {
  const r = await call("/api/tests", { method: "POST", ip: IP.genFlood, body: { brief: { topic: `도배 테스트 ${i}` } } });
  genCodes.push(r.status);
}
check("free generations stop at 5 per IP per day", genCodes.slice(0, 5).every((s) => s === 200) && genCodes[5] === 429, genCodes.join(","));

const sid2 = "e2e-sess-" + Date.now();
const leadCodes = [];
for (let i = 0; i < 4; i++) {
  const r = await call("/api/leads", { method: "POST", ip: IP.participant2, body: { ...leadBody, name: `참여자${i}`, sessionId: sid2 } });
  leadCodes.push(r.status);
  if (i === 3) check("over-limit lead gets a Korean message", /[가-힣]/.test(r.json?.error ?? ""), r.text);
}
check("leads stop at 3 per browser session per test per day", leadCodes.join(",") === "200,200,200,429", leadCodes.join(","));

const ipLeadCodes = [];
for (let i = 0; i < 11; i++) {
  const r = await call("/api/leads", { method: "POST", ip: IP.leadFlood, body: { ...leadBody, name: `도배${i}` } });
  ipLeadCodes.push(r.status);
}
check("leads stop at 10 per IP per test per hour", ipLeadCodes.slice(0, 10).every((s) => s === 200) && ipLeadCodes[10] === 429, ipLeadCodes.join(","));

const ticketCodes = [];
for (let i = 0; i < 11; i++) {
  const r = await call("/api/support", { method: "POST", ip: IP.ticketFlood, body: { category: "bug", subject: `화면 깨짐 ${i}`, body: "버튼 위치가 이상해요 확인 부탁" } });
  ticketCodes.push(r.status);
}
check("tickets stop at 10 per IP per hour", ticketCodes.slice(0, 10).every((s) => s === 200) && ticketCodes[10] === 429, ticketCodes.join(","));

const followCodes = [];
for (let i = 0; i < 19; i++) {
  const r = await call(`/api/support/${ticket.json?.token}`, { method: "POST", ip: IP.support, body: { body: `추가 메시지 ${i}` } });
  followCodes.push(r.status);
}
// The first message and the follow-up above already count: 20 customer messages per ticket per day.
check("ticket follow-ups stop at 20 per day", followCodes.slice(0, 18).every((s) => s === 200) && followCodes[18] === 429, followCodes.join(","));

const salesCodes = [];
for (let i = 0; i < 6; i++) {
  const r = await call("/api/sales", { method: "POST", ip: IP.salesFlood, body: { email: `flood${i}@example.com`, source: "contact", consent: true } });
  salesCodes.push(r.status);
}
check("sales inquiries stop at 5 per IP per hour", salesCodes.slice(0, 5).every((s) => s === 200) && salesCodes[5] === 429, salesCodes.join(","));

// 11. Cron is protected
check("cron requires secret", (await call("/api/cron/outbox")).status === 401);

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
console.log(JSON.stringify({ ws, testId, slug }));
process.exit(failures === 0 ? 0 : 1);
