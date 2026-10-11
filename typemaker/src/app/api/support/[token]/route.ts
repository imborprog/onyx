import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readBody } from "@/lib/http";
import { addCustomerMessageLimited } from "@/lib/limits";
import { getTicketByToken } from "@/lib/repo";

export const runtime = "nodejs";

const Body = z.object({ body: z.string().trim().min(1).max(4000) });

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const ticket = await getTicketByToken(token);
  if (!ticket) return jsonError(404, "문의를 찾을 수 없어요");
  const body = await readBody(req, Body);
  if (!body.ok) return body.res;
  // Anyone holding the ticket link can post, so follow-ups are capped per ticket per day.
  if (!(await addCustomerMessageLimited(ticket.id, body.data.body))) {
    return jsonError(429, "오늘은 이 문의에 더 남길 수 없어요. 담당자 답변을 기다려 주세요.");
  }
  return NextResponse.json({ ok: true });
}
