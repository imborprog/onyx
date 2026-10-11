import { NextResponse } from "next/server";
import { z } from "zod";
import { appUrl, BRAND } from "@/lib/config";
import { emailSchema, ipHash, jsonError, readBody } from "@/lib/http";
import { createSalesLeadLimited } from "@/lib/limits";
import { getWorkspaceBySecret } from "@/lib/repo";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().trim().max(120).regex(emailSchema, "이메일 형식을 확인해 주세요"),
  name: z.string().trim().max(40).optional(),
  company: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(20).optional(),
  product: z.string().trim().max(40).optional(),
  message: z.string().trim().max(2000).optional(),
  source: z.enum(["contact", "checkout", "pricing"]).default("contact"),
  consent: z.literal(true, { errorMap: () => ({ message: "답변 연락을 위한 개인정보 수집에 동의해 주세요" }) }),
});

export async function POST(req: Request) {
  const body = await readBody(req, Body);
  if (!body.ok) return body.res;
  const b = body.data;
  const ws = await getWorkspaceBySecret(req.headers.get("x-workspace"));
  // The address is unverified, so the acknowledgement is a fixed text: no name or company from the form.
  const lead = await createSalesLeadLimited({
    workspaceId: ws?.id ?? null,
    name: b.name || null,
    company: b.company || null,
    email: b.email,
    phone: b.phone || null,
    product: b.product || null,
    message: b.message || null,
    source: b.source,
    ipHash: ipHash(req),
    ack: {
      subject: `[${BRAND.name}] 문의 주셔서 고맙습니다`,
      body: `문의를 잘 받았어요. 담당자가 1영업일 안에 이 주소로 안내드릴게요.\n\n그동안 무료로 먼저 만들어 보셔도 좋아요: ${appUrl()}/create`,
    },
  });
  if (!lead.ok) return jsonError(429, "짧은 시간에 문의가 너무 많이 접수됐어요. 잠시 후 다시 시도해 주세요.");
  return NextResponse.json({ ok: true });
}
