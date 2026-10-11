// End-to-end smoke test against a running server (default http://localhost:3100).
// Walks the main flows a creator, a participant, a support customer and a buyer go through.
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
let failures = 0;

function check(name, cond, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

async function call(path, { method = "GET", body, ws, headers = {} } = {}) {
  const h = { ...headers };
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
for (const p of ["/", "/pricing", "/gallery", "/create", "/support", "/contact", "/legal/privacy", "/legal/terms", "/robots.txt", "/sitemap.xml"]) {
  const r = await call(p);
  check(`GET ${p} -> 200`, r.status === 200, String(r.status));
}
const gallery = await call("/gallery");
const houseSlug = gallery.text.match(/href="\/t\/([a-z0-9]{8})"/)?.[1];
check("gallery lists seeded house tests", Boolean(houseSlug));

// 2. Creator: create a test (template mode, no AI key)
const created = await call("/api/tests", {
  method: "POST",
  body: { brief: { topic: "커피 취향", brandName: "오늘의커피", goal: "coupon", resultCount: 4, questionCount: 6, tone: "playful" }, email: "owner@example.com", marketingOptIn: true },
});
check("POST /api/tests creates a test", created.status === 200 && created.json?.mode === "ready", created.text.slice(0, 200));
const ws = created.json?.workspaceSecret;
const testId = created.json?.testId;

const dash = await call(`/w/${ws}`);
check("dashboard renders", dash.status === 200 && dash.text.includes("커피 취향"));
const editor = await call(`/w/${ws}/t/${testId}`);
check("editor renders", editor.status === 200 && editor.text.includes("질문·결과"));
check("bad workspace secret -> 404", (await call(`/w/${"0".repeat(40)}`)).status === 404);

// Unauthorised edit is rejected
const unauth = await call(`/api/tests/${testId}`, { method: "PATCH", body: { settings: {} } });
check("PATCH without workspace -> 401", unauth.status === 401);

// 3. Enable lead form + coupon + CTA, then publish
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

const draftView = await call(`/api/tests/${testId}/publish`, { method: "POST", ws, body: { status: "published" } });
check("publish", draftView.status === 200 && draftView.json?.status === "published", draftView.text);
const slug = draftView.json?.slug;

// 4. Participant: view, play, lead, share
const page = await call(`/t/${slug}`);
check("public test page renders", page.status === 200 && page.text.includes("커피 취향"));
check("og meta present", page.text.includes(`/api/og?slug=${slug}`));
const sid = "e2e" + Date.now();
for (const type of ["view", "start", "complete", "share", "watermark_click"]) {
  const r = await call("/api/events", { method: "POST", body: { slug, type, resultKey: type === "complete" || type === "share" ? "spark" : null, channel: type === "share" ? "copy" : null, sessionId: sid } });
  check(`event ${type}`, r.status === 200, r.text);
}
const botEvent = await fetch(`${BASE}/api/events`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "kakaotalk-scrap/1.0" }, body: JSON.stringify({ slug, type: "view" }) });
check("bot events are ignored", botEvent.status === 200);

const noConsent = await call("/api/leads", { method: "POST", body: { slug, resultKey: "spark", name: "홍길동", phone: "010-1234-5678", email: null, consentPrivacy: false, ageOver14: true } });
check("lead without consent -> 400", noConsent.status === 400);
const lead = await call("/api/leads", {
  method: "POST",
  body: { slug, resultKey: "spark", name: "홍길동", phone: "010-1234-5678", email: null, consentPrivacy: true, ageOver14: true, consentMarketing: true, consentNight: false },
});
check("lead with consent", lead.status === 200, lead.text);
const csv = await call(`/api/tests/${testId}/leads?ws=${ws}`);
check("lead CSV download", csv.status === 200 && csv.text.includes("홍길동") && csv.headers.get("content-type")?.includes("text/csv"));
check("lead CSV requires secret", (await call(`/api/tests/${testId}/leads`)).status === 401);

const shared = await call(`/t/${slug}/r/spark`);
check("shared result page", shared.status === 200 && shared.text.includes("친구의 결과"));
const og = await fetch(`${BASE}/api/og?slug=${slug}&key=spark`);
check("OG image renders png", og.status === 200 && (og.headers.get("content-type") ?? "").includes("image/png"), String(og.status));

const stats = await call(`/w/${ws}/t/${testId}`);
check("editor shows lead", stats.text.includes("리드 1건") || stats.text.includes("홍길동"));

// 5. Draft preview requires the secret
await call(`/api/tests/${testId}/publish`, { method: "POST", ws, body: { status: "draft" } });
check("unpublished test hidden", (await call(`/t/${slug}`)).status === 404);
check("preview with secret works", (await call(`/t/${slug}?preview=${ws}`)).status === 200);
await call(`/api/tests/${testId}/publish`, { method: "POST", ws, body: { status: "published" } });

// 6. Concierge request
const concierge = await call("/api/tests", {
  method: "POST",
  ws,
  body: { brief: { topic: "신학기 공부 습관", goal: "leads", resultCount: 4, questionCount: 8, tone: "warm" }, email: "owner@example.com", mode: "concierge" },
});
check("concierge request queued", concierge.status === 200 && concierge.json?.mode === "queued", concierge.text);

// 7. Support
const ticket = await call("/api/support", { method: "POST", ws, body: { category: "general", email: "owner@example.com", subject: "쿠폰 코드 질문", body: "결과마다 다른 쿠폰 코드를 줄 수 있나요?" } });
check("support ticket created", ticket.status === 200 && Boolean(ticket.json?.token), ticket.text);
const thread = await call(`/support/${ticket.json?.token}`);
check("ticket page shows FAQ auto-answer", thread.status === 200 && thread.text.includes("자동") && thread.text.includes("쿠폰"));
const reply = await call(`/api/support/${ticket.json?.token}`, { method: "POST", body: { body: "고맙습니다. 한 가지 더 물어볼게요." } });
check("customer follow-up", reply.status === 200);
const refund = await call("/api/support", { method: "POST", body: { category: "refund", email: "buyer@example.com", subject: "환불 요청", body: "결제한 프로 이용권 환불 부탁드립니다." } });
check("refund ticket created", refund.status === 200);

// 8. Sales & payments
const sales = await call("/api/sales", { method: "POST", body: { email: "agency@example.com", company: "브랜드랩", product: "agency_month", message: "고객사 5곳에 쓰고 싶어요", source: "contact", consent: true } });
check("sales inquiry", sales.status === 200, sales.text);
check("sales inquiry needs consent", (await call("/api/sales", { method: "POST", body: { email: "a@b.co", source: "contact" } })).status === 400);
const order = await call("/api/orders", { method: "POST", ws, body: { product: "pro_month", email: "owner@example.com" } });
check("orders disabled without Toss keys -> 503", order.status === 503, String(order.status));
const confirm = await call("/api/payments/confirm", { method: "POST", body: { paymentKey: "x", orderId: "tm_missing_x", amount: 49000 } });
check("confirm unknown order -> 404", confirm.status === 404);

// 9. Cron is protected
check("cron requires secret", (await call("/api/cron/outbox")).status === 401);

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
console.log(JSON.stringify({ ws, testId, slug }));
process.exit(failures === 0 ? 0 : 1);
