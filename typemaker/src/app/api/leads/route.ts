import { NextResponse } from "next/server";
import { z } from "zod";
import { emailSchema, jsonError, readBody } from "@/lib/http";
import { getPublicTest, insertEvent, insertLead } from "@/lib/repo";

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
});

export async function POST(req: Request) {
  const body = await readBody(req, Body);
  if (!body.ok) return body.res;
  const b = body.data;
  const pt = await getPublicTest(b.slug);
  if (!pt || !pt.test.settings.lead.enabled) return jsonError(404, "참여할 수 없는 테스트예요");
  const fields = pt.test.settings.lead.fields;
  if (fields.includes("name") && !b.name) return jsonError(400, "이름을 입력해 주세요");
  if (fields.includes("phone") && !b.phone) return jsonError(400, "연락처를 입력해 주세요");
  if (fields.includes("email") && !b.email) return jsonError(400, "이메일을 입력해 주세요");
  const resultKey = b.resultKey && pt.test.content.results.some((r) => r.key === b.resultKey) ? b.resultKey : null;
  await insertLead({
    testId: pt.test.id,
    workspaceId: pt.test.workspace_id,
    resultKey,
    name: fields.includes("name") ? b.name : null,
    phone: fields.includes("phone") ? b.phone : null,
    email: fields.includes("email") ? b.email : null,
    consentMarketing: b.consentMarketing,
    consentNight: b.consentMarketing && b.consentNight,
    retentionDays: pt.test.settings.lead.retentionDays,
  });
  await insertEvent({ testId: pt.test.id, type: "lead_submit", resultKey });
  return NextResponse.json({ ok: true });
}
