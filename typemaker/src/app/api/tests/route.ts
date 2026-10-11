import { NextResponse } from "next/server";
import { z } from "zod";
import { AiRefusalError, generateTestWithAi } from "@/lib/ai";
import { aiEnabled, FREE_GENERATIONS_PER_IP_PER_DAY, PLAN_LIMITS } from "@/lib/config";
import { emailSchema, ipHash, jsonError, readBody } from "@/lib/http";
import {
  countRecentGenerations,
  createGenerationRequest,
  createTest,
  createWorkspace,
  effectivePlan,
  getWorkspaceBySecret,
  updateWorkspaceProfile,
} from "@/lib/repo";
import { BriefSchema, type Brief, type Settings } from "@/lib/schema";
import { templateTest } from "@/lib/templates";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  brief: BriefSchema,
  email: z.string().trim().max(120).regex(emailSchema).optional().or(z.literal("")),
  marketingOptIn: z.boolean().default(false),
  mode: z.enum(["instant", "concierge"]).default("instant"),
});

function settingsForBrief(b: Brief): Partial<Settings> {
  return {
    brandName: b.brandName,
    lead: { enabled: b.goal === "leads", fields: ["name", "phone"], purpose: "이벤트 경품 안내 및 상담 연락", retentionDays: 365, askMarketing: true, placement: "after_result", headline: "결과와 함께 혜택을 받아 보세요" },
    coupon: { enabled: b.goal === "coupon", title: "테스트 참여 혜택", code: "", perResult: {}, requireLead: false, note: "" },
  };
}

export async function POST(req: Request) {
  const body = await readBody(req, Body);
  if (!body.ok) return body.res;
  const { brief, email, marketingOptIn, mode } = body.data;
  const ip = ipHash(req);

  let ws = await getWorkspaceBySecret(req.headers.get("x-workspace"));
  if (!ws) {
    ws = await createWorkspace({ email: email || undefined, brandName: brief.brandName || undefined, marketingOptIn, ipHash: ip });
  } else if (email) {
    await updateWorkspaceProfile(ws.id, { email, marketingOptIn: marketingOptIn || undefined });
  }

  const plan = effectivePlan(ws);
  const recent = await countRecentGenerations(ws.id, ip);
  if (recent.workspace >= PLAN_LIMITS[plan].aiGenerationsPerDay) {
    return jsonError(429, `오늘 만들 수 있는 횟수(${PLAN_LIMITS[plan].aiGenerationsPerDay}회)를 다 썼어요. 내일 다시 시도하거나 프로로 업그레이드해 주세요.`);
  }
  if (plan === "free" && recent.ip >= FREE_GENERATIONS_PER_IP_PER_DAY) {
    return jsonError(429, "같은 네트워크에서 오늘 너무 많이 만들었어요. 내일 다시 시도해 주세요.");
  }

  if (mode === "concierge") {
    const requestId = await createGenerationRequest(ws.id, brief, plan !== "free");
    return NextResponse.json({ mode: "queued", workspaceSecret: ws.secret, requestId });
  }

  let source: "ai" | "template" = "template";
  let notice: string | null = null;
  let content = templateTest(brief);
  if (aiEnabled()) {
    try {
      content = await generateTestWithAi(brief);
      source = "ai";
    } catch (e) {
      if (e instanceof AiRefusalError) return jsonError(422, e.message);
      console.error("ai generation failed", e);
      notice = "AI 응답이 불안정해 기본 템플릿으로 초안을 만들었어요. 문구를 직접 다듬어 주세요.";
    }
  }

  const test = await createTest({ workspaceId: ws.id, content, settings: settingsForBrief(brief), brief, source, ipHash: ip });
  return NextResponse.json({ mode: "ready", workspaceSecret: ws.secret, testId: test.id, source, notice });
}
