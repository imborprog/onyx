import { z } from "zod";
import { PRODUCTS, type Plan, type Product } from "./config";

// ---------------------------------------------------------------- test content

const key = z.string().regex(/^[a-z0-9_-]{1,20}$/);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const WeightSchema = z.object({
  key,
  points: z.number().int().min(1).max(3),
});

export const OptionSchema = z.object({
  id: z.string().min(1).max(20),
  text: z.string().min(1).max(100),
  weights: z.array(WeightSchema).min(1).max(3),
});

export const QuestionSchema = z.object({
  id: z.string().min(1).max(20),
  text: z.string().min(1).max(140),
  options: z.array(OptionSchema).min(2).max(4),
});

export const ResultSchema = z.object({
  key,
  name: z.string().min(1).max(40),
  emoji: z.string().max(8).default(""),
  tagline: z.string().max(100).default(""),
  description: z.string().max(900).default(""),
  traits: z.array(z.string().max(40)).max(6).default([]),
  bestMatch: z.string().nullable().default(null),
  color: hex.default("#ff5a36"),
});

export const TestContentSchema = z
  .object({
    title: z.string().min(1).max(60),
    subtitle: z.string().max(120).default(""),
    intro: z.string().max(400).default(""),
    questions: z.array(QuestionSchema).min(3).max(15),
    results: z.array(ResultSchema).min(2).max(12),
  })
  .superRefine((c, ctx) => {
    const keys = new Set<string>();
    for (const r of c.results) {
      if (keys.has(r.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `결과 key 중복: ${r.key}` });
      keys.add(r.key);
    }
    const used = new Set<string>();
    const qids = new Set<string>();
    for (const q of c.questions) {
      if (qids.has(q.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `질문 id 중복: ${q.id}` });
      qids.add(q.id);
      for (const o of q.options) {
        for (const w of o.weights) {
          if (!keys.has(w.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `없는 결과 key: ${w.key}` });
          used.add(w.key);
        }
      }
    }
    for (const k of keys) {
      if (!used.has(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `나올 수 없는 결과: ${k}` });
    }
  });

export type TestContent = z.infer<typeof TestContentSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Result = z.infer<typeof ResultSchema>;

// ---------------------------------------------------------------- settings

export const LeadField = z.enum(["name", "phone", "email"]);
export type LeadField = z.infer<typeof LeadField>;

export const SettingsSchema = z.object({
  brandName: z.string().max(40).default(""),
  theme: z
    .object({
      accent: hex.default("#ff5a36"),
      style: z.enum(["pop", "calm", "night"]).default("pop"),
    })
    .default({}),
  lead: z
    .object({
      enabled: z.boolean().default(false),
      fields: z.array(LeadField).min(1).default(["name", "phone"]),
      purpose: z.string().max(200).default("이벤트 경품 안내 및 상담 연락"),
      retentionDays: z.number().int().min(30).max(1095).default(365),
      askMarketing: z.boolean().default(true),
      placement: z.enum(["before_result", "after_result"]).default("after_result"),
      headline: z.string().max(60).default("결과와 함께 혜택을 받아 보세요"),
    })
    .default({}),
  coupon: z
    .object({
      enabled: z.boolean().default(false),
      title: z.string().max(40).default("테스트 참여 혜택"),
      code: z.string().max(40).default(""),
      perResult: z.record(z.string(), z.string().max(40)).default({}),
      requireLead: z.boolean().default(false),
      note: z.string().max(200).default(""),
    })
    .default({}),
  cta: z
    .object({
      enabled: z.boolean().default(false),
      label: z.string().max(30).default("자세히 보기"),
      url: z.string().max(500).default(""),
    })
    .default({}),
});

export type Settings = z.infer<typeof SettingsSchema>;

/**
 * Parses stored settings one section at a time, so one bad field (say an operator-written
 * '#f60' accent) resets only its own section to the defaults instead of switching off the
 * lead form and coupon along with it.
 */
export function parseSettings(raw: unknown): Settings {
  const obj: Record<string, unknown> = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const shape = SettingsSchema.shape;
  function section<K extends keyof Settings>(key: K, schema: z.ZodType<Settings[K], z.ZodTypeDef, unknown>): Settings[K] {
    const res = schema.safeParse(obj[key]);
    if (res.success) return res.data;
    const issue = res.error.issues[0];
    console.warn(`settings.${key} is invalid (${issue ? `${[key, ...issue.path].join(".")}: ${issue.message}` : "unknown"}); using defaults for this section`);
    return schema.parse(undefined);
  }
  return {
    brandName: section("brandName", shape.brandName),
    theme: section("theme", shape.theme),
    lead: section("lead", shape.lead),
    coupon: section("coupon", shape.coupon),
    cta: section("cta", shape.cta),
  };
}

// ---------------------------------------------------------------- plan purchases

export type PaidPlan = Exclude<Plan, "free">;

export interface PlanState {
  plan: Plan;
  expiresAt: Date | null;
}

export interface PlanChange {
  plan: PaidPlan;
  expiresAt: Date;
  /** start: nothing was running. extend: same tier. pro_as_agency: pro bought during agency. upgrade: agency bought during pro. */
  kind: "start" | "extend" | "pro_as_agency" | "upgrade";
  /** Agency days that pro time was converted into (the purchase for pro_as_agency, the remaining pro time for upgrade). */
  convertedDays: number;
}

const DAY_MS = 86_400_000;

function dayPrices(plan: PaidPlan): number[] {
  return Object.values(PRODUCTS)
    .filter((p) => p.plan === plan && !p.concierge)
    .map((p) => p.amount / p.days);
}

/**
 * What a purchase does to a workspace's plan. A workspace has one plan and one expiry, so
 * time is never moved between tiers 1:1; it is converted by list price instead:
 *  - nothing running, or the same tier: the product's days are added after the current expiry;
 *  - pro bought while agency runs: the plan stays agency and gains the agency days the pro
 *    purchase is worth (its price, capped at the monthly pro price for the days so a campaign
 *    pass's concierge share is not converted, divided by the agency day price);
 *  - agency bought while pro runs: the remaining pro time becomes agency time at the cheapest
 *    pro day price (the yearly pass; what was paid for it is unknown), then the agency days are added.
 * So agency time is never sold at the pro price and remaining pro time never becomes agency for free.
 */
export function nextPlan(current: PlanState, product: Product, now: Date): PlanChange {
  const nowMs = now.getTime();
  const currentEnd = current.expiresAt ? new Date(current.expiresAt).getTime() : 0;
  const active: Plan = current.plan !== "free" && currentEnd > nowMs ? current.plan : "free";
  const productMs = product.days * DAY_MS;
  if (active === "free") return { plan: product.plan, expiresAt: new Date(nowMs + productMs), kind: "start", convertedDays: 0 };
  if (active === product.plan) return { plan: product.plan, expiresAt: new Date(currentEnd + productMs), kind: "extend", convertedDays: 0 };
  const agencyDay = Math.min(...dayPrices("agency"));
  if (active === "agency") {
    const proValue = Math.min(product.amount, product.days * Math.max(...dayPrices("pro")));
    const days = proValue / agencyDay;
    return { plan: "agency", expiresAt: new Date(currentEnd + days * DAY_MS), kind: "pro_as_agency", convertedDays: days };
  }
  const days = ((currentEnd - nowMs) / DAY_MS) * (Math.min(...dayPrices("pro")) / agencyDay);
  return { plan: "agency", expiresAt: new Date(nowMs + days * DAY_MS + productMs), kind: "upgrade", convertedDays: days };
}

// ---------------------------------------------------------------- brief (create form)

export const BriefSchema = z.object({
  topic: z.string().trim().min(2).max(80),
  brandName: z.string().trim().max(40).default(""),
  audience: z.string().trim().max(80).default(""),
  goal: z.enum(["fun", "leads", "coupon", "education"]).default("fun"),
  resultCount: z.union([z.literal(4), z.literal(6), z.literal(8)]).default(4),
  questionCount: z.number().int().min(5).max(12).default(8),
  tone: z.enum(["playful", "warm", "witty", "calm"]).default("playful"),
  extra: z.string().trim().max(500).default(""),
});

export type Brief = z.infer<typeof BriefSchema>;

export const GOAL_LABEL: Record<Brief["goal"], string> = {
  fun: "재미·바이럴",
  leads: "상담 리드 수집",
  coupon: "쿠폰으로 방문 유도",
  education: "정보 전달·교육",
};

export const TONE_LABEL: Record<Brief["tone"], string> = {
  playful: "발랄하게",
  warm: "따뜻하게",
  witty: "위트 있게",
  calm: "차분하게",
};
