import { NextResponse } from "next/server";
import { z } from "zod";
import { answerSupportQuestion } from "@/lib/ai";
import { aiEnabled, appUrl, BRAND } from "@/lib/config";
import { faqAsText, matchFaq } from "@/lib/faq";
import { emailSchema, readBody } from "@/lib/http";
import { addTicketMessage, createTicket, enqueueEmail, getWorkspaceBySecret } from "@/lib/repo";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  category: z.enum(["general", "billing", "bug", "sales", "refund", "privacy"]).default("general"),
  email: z.string().trim().max(120).regex(emailSchema, "이메일 형식을 확인해 주세요").optional().or(z.literal("")),
  name: z.string().trim().max(40).optional(),
  subject: z.string().trim().min(2, "제목을 적어 주세요").max(120),
  body: z.string().trim().min(5, "내용을 조금 더 적어 주세요").max(4000),
});

const SENSITIVE = new Set(["refund", "privacy"]);

async function autoAnswer(category: string, question: string): Promise<string | null> {
  if (SENSITIVE.has(category)) {
    return "접수됐어요. 환불·개인정보 요청은 담당자가 직접 확인한 뒤 처리 결과를 알려 드려요. 보통 1영업일 안에 답변드립니다.";
  }
  if (aiEnabled()) {
    try {
      const a = await answerSupportQuestion(question, faqAsText());
      if (a) return `${a}\n\n(AI 자동 답변이에요. 담당자가 확인 후 필요하면 추가로 답변드려요.)`;
    } catch (e) {
      console.error("support ai failed", e);
    }
  }
  const hits = matchFaq(question);
  if (hits.length === 0) return null;
  return `${hits.map((h) => `• ${h.q}\n${h.a}`).join("\n\n")}\n\n(자주 묻는 질문에서 찾은 답변이에요. 담당자가 확인 후 추가로 답변드려요.)`;
}

export async function POST(req: Request) {
  const body = await readBody(req, Body);
  if (!body.ok) return body.res;
  const b = body.data;
  const ws = await getWorkspaceBySecret(req.headers.get("x-workspace"));
  const ticket = await createTicket({
    workspaceId: ws?.id ?? null,
    email: b.email || ws?.owner_email || null,
    name: b.name || null,
    category: b.category,
    subject: b.subject,
    body: b.body,
  });
  const answer = await autoAnswer(b.category, `${b.subject}\n${b.body}`);
  if (answer) await addTicketMessage(ticket.id, "ai", answer);
  const email = b.email || ws?.owner_email;
  if (email) {
    await enqueueEmail({
      to: email,
      subject: `[${BRAND.name}] 문의가 접수됐어요: ${b.subject}`,
      body: `문의가 접수됐어요. 답변이 달리면 이메일로 알려 드려요.\n\n대화 보기: ${appUrl()}/support/${ticket.token}`,
      kind: "support",
      ref: `ticket:${ticket.id}`,
    });
  }
  return NextResponse.json({ ok: true, token: ticket.token });
}
