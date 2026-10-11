import { NextResponse } from "next/server";
import { z } from "zod";
import { emailSchema, ipHash, jsonError, readBody } from "@/lib/http";
import { insertLeadLimited } from "@/lib/limits";
import { getPublicTest } from "@/lib/repo";
import { couponCodeFor } from "@/lib/schema";

export const runtime = "nodejs";

const Body = z.object({
  slug: z.string().max(16),
  resultKey: z.string().max(20).nullable(),
  name: z.string().trim().max(40).nullable(),
  phone: z.string().trim().max(20).regex(/^[0-9+\-\s()]{8,20}$/, "연락처 형식을 확인해 주세요").nullable(),
  email: z.string().trim().max(120).regex(emailSchema, "이메일 형식을 확인해 주세요").nullable(),
  consentPrivacy: z.literal(true, { errorMap: () => ({ message: "개인정보 수집·이용에 동의해 주세요" }) }),
  ageOver14: z.literal(true, { errorMap: () => ({ message: "만 14세 이상만 참여할 수 있어요" }) }),
  consentMarketing: z.boolean().default(false),
  consentNight: z.boolean().default(false),
  sessionId: z.string().max(40).nullable().optional(),
});

export async function POST(req: Request) {
  const body = await readBody(req, Body);
  if (!body.ok) return body.res;
  const b = body.data;
  const pt = await getPublicTest(b.slug);
  if (!pt || !pt.test.settings.lead.enabled) return jsonError(404, "참여할 수 없는 테스트예요");
  const { lead, coupon } = pt.test.settings;
  const fields = lead.fields;
  if (fields.includes("name") && !b.name) return jsonError(400, "이름을 입력해 주세요");
  if (fields.includes("phone") && !b.phone) return jsonError(400, "연락처를 입력해 주세요");
  if (fields.includes("email") && !b.email) return jsonError(400, "이메일을 입력해 주세요");
  const resultKey = b.resultKey && pt.test.content.results.some((r) => r.key === b.resultKey) ? b.resultKey : null;
  const saved = await insertLeadLimited({
    testId: pt.test.id,
    workspaceId: pt.test.workspace_id,
    resultKey,
    name: fields.includes("name") ? b.name : null,
    phone: fields.includes("phone") ? b.phone : null,
    email: fields.includes("email") ? b.email : null,
    consentMarketing: b.consentMarketing,
    consentNight: b.consentMarketing && b.consentNight,
    retentionDays: lead.retentionDays,
    sessionId: b.sessionId ?? null,
    ipHash: ipHash(req),
  });
  if (!saved.ok) {
    return jsonError(
      429,
      saved.reason === "session" ? "이 브라우저에서는 오늘 더 참여할 수 없어요. 내일 다시 참여해 주세요." : "같은 네트워크에서 참여가 너무 많아요. 잠시 후 다시 시도해 주세요.",
    );
  }
  // The coupon (if any) is released only here, after the lead is stored, so gated codes never reach the page source.
  return NextResponse.json({ ok: true, coupon: coupon.enabled ? couponCodeFor(coupon, resultKey) : null });
}
