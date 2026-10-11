import { NextResponse } from "next/server";
import { z } from "zod";
import { readBody, requireWorkspace, jsonError } from "@/lib/http";
import { isUuid, updateTest } from "@/lib/repo";
import { SettingsSchema, TestContentSchema } from "@/lib/schema";

export const runtime = "nodejs";

const Body = z.object({
  content: TestContentSchema.optional(),
  settings: SettingsSchema.optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireWorkspace(req);
  if (!auth.ok) return auth.res;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "테스트를 찾을 수 없어요");
  const body = await readBody(req, Body);
  if (!body.ok) return body.res;
  const s = body.data.settings;
  // Same two forms ops.validate_settings accepts: an absolute http(s) URL or a path on this site (never "//host" or "javascript:").
  if (s?.cta.enabled && !/^(https?:\/\/\S+|\/(?!\/)\S*)$/.test(s.cta.url)) return jsonError(400, "버튼 링크는 https:// 로 시작하는 주소로 넣어 주세요");
  const updated = await updateTest(auth.ws.id, id, body.data);
  if (!updated) return jsonError(404, "테스트를 찾을 수 없어요");
  return NextResponse.json({ ok: true, updatedAt: updated.updated_at });
}
