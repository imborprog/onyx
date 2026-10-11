import { NextResponse } from "next/server";
import { z } from "zod";
import { AiRefusalError, generateTestWithAi } from "@/lib/ai";
import { aiEnabled, type Plan } from "@/lib/config";
import { emailSchema, ipHash, jsonError, readBody } from "@/lib/http";
import { finishAttempt, reserveGeneration, type AttemptOutcome, type GenerationReservation } from "@/lib/limits";
import {
  createGenerationRequest,
  createTest,
  createWorkspace,
  effectivePlan,
  getWorkspaceBySecret,
  updateWorkspaceProfile,
  type Workspace,
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

function limitMessage(r: Extract<GenerationReservation, { ok: false }>, plan: Plan): string {
  if (r.reason === "workspace") {
    return `오늘 만들 수 있는 횟수(${r.limit}회)를 다 썼어요. ${plan === "free" ? "내일 다시 시도하거나 프로로 업그레이드해 주세요." : "내일 다시 시도해 주세요."}`;
  }
  if (r.reason === "concierge_ip") return "같은 네트워크에서 오늘 제작 요청을 너무 많이 보냈어요. 내일 다시 시도해 주세요.";
  return "같은 네트워크에서 오늘 너무 많이 만들었어요. 내일 다시 시도해 주세요.";
}

/**
 * Runs only after the limits pass, so a refused request leaves no workspace behind.
 * When an email is given, marketing consent follows the checkbox exactly: an unticked
 * box withdraws an earlier opt-in instead of letting a new address inherit it.
 */
async function workspaceFor(
  existing: Workspace | null,
  input: { email: string | null; brandName: string; marketingOptIn: boolean; ipHash: string },
): Promise<Workspace> {
  if (!existing) {
    return createWorkspace({
      email: input.email ?? undefined,
      brandName: input.brandName || undefined,
      marketingOptIn: input.email ? input.marketingOptIn : false,
      optInSource: "create_form",
      ipHash: input.ipHash,
    });
  }
  if (input.email) await updateWorkspaceProfile(existing.id, { email: input.email, marketingOptIn: input.marketingOptIn, optInSource: "create_form" });
  return existing;
}

export async function POST(req: Request) {
  const body = await readBody(req, Body);
  if (!body.ok) return body.res;
  const { brief, marketingOptIn, mode } = body.data;
  const email = body.data.email || null;
  const ip = ipHash(req);

  const existing = await getWorkspaceBySecret(req.headers.get("x-workspace"));
  const plan: Plan = existing ? effectivePlan(existing) : "free";
  if (mode === "concierge" && !email && !existing?.owner_email) {
    return jsonError(400, "제작 요청은 완성 소식을 받을 이메일을 적어 주세요");
  }

  // Quota is reserved before any paid model call; refusals and failures still count.
  const reservation = await reserveGeneration({
    ipHash: ip,
    workspaceId: existing?.id ?? null,
    plan,
    kind: mode === "concierge" ? "concierge" : aiEnabled() ? "ai" : "template",
  });
  if (!reservation.ok) return jsonError(429, limitMessage(reservation, plan));
  const profile = { email, brandName: brief.brandName, marketingOptIn, ipHash: ip };

  if (mode === "concierge") {
    try {
      const ws = await workspaceFor(existing, profile);
      const requestId = await createGenerationRequest(ws.id, brief, plan !== "free");
      await finishAttempt(reservation.attemptId, "ok", ws.id);
      return NextResponse.json({ mode: "queued", workspaceSecret: ws.secret, requestId });
    } catch (e) {
      await finishAttempt(reservation.attemptId, "failed", existing?.id);
      throw e;
    }
  }

  let source: "ai" | "template" = "template";
  let outcome: AttemptOutcome = "ok";
  let notice: string | null = reservation.aiCapped ? "오늘은 AI 사용량이 많아 기본 템플릿으로 초안을 만들었어요. 문구를 직접 다듬어 주세요." : null;
  let content = templateTest(brief);
  if (reservation.kind === "ai") {
    try {
      content = await generateTestWithAi(brief);
      source = "ai";
    } catch (e) {
      if (e instanceof AiRefusalError) {
        await finishAttempt(reservation.attemptId, "refused", existing?.id);
        return jsonError(422, e.message);
      }
      console.error("ai generation failed", e);
      outcome = "failed";
      notice = "AI 응답이 불안정해 기본 템플릿으로 초안을 만들었어요. 문구를 직접 다듬어 주세요.";
    }
  }

  const ws = await workspaceFor(existing, profile);
  const test = await createTest({ workspaceId: ws.id, content, settings: settingsForBrief(brief), brief, source });
  await finishAttempt(reservation.attemptId, outcome, ws.id);
  return NextResponse.json({ mode: "ready", workspaceSecret: ws.secret, testId: test.id, source, notice });
}
