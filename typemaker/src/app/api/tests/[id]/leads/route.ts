import { effectivePlan, getTestForWorkspace, getWorkspaceBySecret, listLeads } from "@/lib/repo";

export const runtime = "nodejs";

function csvCell(v: string | null | boolean): string {
  const s = v === null ? "" : String(v);
  // Neutralise spreadsheet formula injection and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

// Download link, so the workspace secret comes as a query parameter.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const url = new URL(req.url);
  const ws = await getWorkspaceBySecret(url.searchParams.get("ws"));
  if (!ws) return new Response("관리 링크가 올바르지 않습니다", { status: 401 });
  const { id } = await ctx.params;
  const test = await getTestForWorkspace(ws.id, id);
  if (!test) return new Response("테스트를 찾을 수 없어요", { status: 404 });
  const { rows, hidden } = await listLeads(test.id, ws.id, effectivePlan(ws));
  const names = Object.fromEntries(test.content.results.map((r) => [r.key, r.name]));
  const header = ["참여일시", "결과", "이름", "연락처", "이메일", "마케팅 수신동의", "야간 수신동의"];
  const lines = rows.map((r) =>
    [
      new Date(r.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
      r.result_key ? (names[r.result_key] ?? r.result_key) : "",
      r.name,
      r.phone,
      r.email,
      r.consent_marketing ? "Y" : "N",
      r.consent_night ? "Y" : "N",
    ]
      .map((v) => csvCell(v))
      .join(","),
  );
  if (hidden > 0) lines.push(csvCell(`무료 플랜이라 ${hidden}건이 더 있습니다. 프로로 업그레이드하면 전체를 받을 수 있어요.`));
  const body = "﻿" + [header.map(csvCell).join(","), ...lines].join("\r\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${test.slug}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
