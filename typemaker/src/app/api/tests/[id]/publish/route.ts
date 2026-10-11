import { NextResponse } from "next/server";
import { z } from "zod";
import { readBody, requireWorkspace, jsonError } from "@/lib/http";
import { setTestStatus } from "@/lib/repo";

export const runtime = "nodejs";

const Body = z.object({ status: z.enum(["published", "draft", "archived"]) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireWorkspace(req);
  if (!auth.ok) return auth.res;
  const body = await readBody(req, Body);
  if (!body.ok) return body.res;
  const { id } = await ctx.params;
  const updated = await setTestStatus(auth.ws.id, id, body.data.status);
  if (!updated) return jsonError(404, "테스트를 찾을 수 없어요");
  return NextResponse.json({ ok: true, status: updated.status, slug: updated.slug });
}
