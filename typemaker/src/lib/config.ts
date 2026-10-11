export const BRAND = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME ?? "유형공장",
  tagline: "주제만 넣으면 AI가 10분 만에 만드는 브랜드 심리테스트",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "",
} as const;

// 전자상거래법상 사이트 하단에 표시해야 하는 사업자 정보. 배포 전에 환경변수로 채운다.
export const BUSINESS = {
  companyName: process.env.NEXT_PUBLIC_BIZ_NAME ?? "",
  ceo: process.env.NEXT_PUBLIC_BIZ_CEO ?? "",
  registrationNo: process.env.NEXT_PUBLIC_BIZ_REG_NO ?? "",
  mailOrderNo: process.env.NEXT_PUBLIC_BIZ_MAIL_ORDER_NO ?? "",
  address: process.env.NEXT_PUBLIC_BIZ_ADDRESS ?? "",
  phone: process.env.NEXT_PUBLIC_BIZ_PHONE ?? "",
} as const;

export type Plan = "free" | "pro" | "agency";

export interface PlanLimits {
  watermark: boolean;
  visibleLeads: number;
  aiGenerationsPerDay: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { watermark: true, visibleLeads: 20, aiGenerationsPerDay: 3 },
  pro: { watermark: false, visibleLeads: Number.POSITIVE_INFINITY, aiGenerationsPerDay: 30 },
  agency: { watermark: false, visibleLeads: Number.POSITIVE_INFINITY, aiGenerationsPerDay: 100 },
};

export const FREE_GENERATIONS_PER_IP_PER_DAY = 5;

export type ProductId = "pro_month" | "pro_year" | "agency_month" | "campaign";

export interface Product {
  id: ProductId;
  name: string;
  amount: number;
  plan: Exclude<Plan, "free">;
  days: number;
  concierge: boolean;
  blurb: string;
}

export const PRODUCTS: Record<ProductId, Product> = {
  pro_month: {
    id: "pro_month",
    name: "프로 30일",
    amount: 49000,
    plan: "pro",
    days: 30,
    concierge: false,
    blurb: "워터마크 제거, 리드 전체 열람·다운로드, AI 생성 하루 30회",
  },
  pro_year: {
    id: "pro_year",
    name: "프로 1년",
    amount: 468000,
    plan: "pro",
    days: 365,
    concierge: false,
    blurb: "프로 기능 1년. 월 39,000원꼴",
  },
  agency_month: {
    id: "agency_month",
    name: "대행사 30일",
    amount: 149000,
    plan: "agency",
    days: 30,
    concierge: false,
    blurb: "여러 브랜드 운영, AI 생성 하루 100회, 우선 지원",
  },
  campaign: {
    id: "campaign",
    name: "캠페인 패스",
    amount: 199000,
    plan: "pro",
    days: 30,
    concierge: true,
    blurb: "기획부터 문구까지 대신 만들어 드리고 프로 30일 포함",
  },
};

export function isProductId(v: string): v is ProductId {
  return v in PRODUCTS;
}

export function appUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export const ENV = {
  anthropicKey: () => process.env.ANTHROPIC_API_KEY ?? "",
  tossClientKey: () => process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? "",
  tossSecretKey: () => process.env.TOSS_SECRET_KEY ?? "",
  resendKey: () => process.env.RESEND_API_KEY ?? "",
  emailFrom: () => process.env.EMAIL_FROM ?? "",
  kakaoJsKey: () => process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? "",
  cronSecret: () => process.env.CRON_SECRET ?? "",
  ipSalt: () => process.env.IP_HASH_SALT ?? "typemaker-dev-salt",
} as const;

export function aiEnabled(): boolean {
  return ENV.anthropicKey().length > 0;
}

export function paymentsEnabled(): boolean {
  return ENV.tossClientKey().length > 0 && ENV.tossSecretKey().length > 0;
}
