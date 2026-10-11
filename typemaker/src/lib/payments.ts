import "server-only";
import { appUrl, BRAND, BUSINESS, ENV, paymentsEnabled, PRODUCTS, type Plan } from "./config";
import { enqueueEmail, fulfillOrder, ordersToReconcile, type FulfilResult, type OrderRow } from "./repo";

export interface TossResult {
  ok: boolean;
  /** HTTP status, or 0 when Toss could not be reached (network error or timeout). */
  status: number;
  body: Record<string, unknown>;
}

export type CardCheckoutStatus = "ready" | "no_toss" | "no_business_info";

/**
 * Card checkout needs the Toss keys and the seller details 전자상거래법 requires on the page
 * (at least 상호 and 사업자등록번호), so a deployment with keys but no business info cannot sell.
 */
export function cardCheckoutStatus(): CardCheckoutStatus {
  if (!paymentsEnabled()) return "no_toss";
  if (!BUSINESS.companyName.trim() || !BUSINESS.registrationNo.trim()) return "no_business_info";
  return "ready";
}

async function toss(path: string, init: { method: "GET" | "POST"; body?: unknown; idempotencyKey?: string; timeoutMs: number }): Promise<TossResult> {
  const headers: Record<string, string> = { Authorization: `Basic ${Buffer.from(`${ENV.tossSecretKey()}:`).toString("base64")}` };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`https://api.tosspayments.com${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(init.timeoutMs),
    });
  } catch (e) {
    return { ok: false, status: 0, body: { code: "NETWORK_ERROR", message: String(e).slice(0, 200) } };
  }
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await res.json();
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { ok: res.ok, status: res.status, body };
}

/**
 * Toss Payments "결제 승인" API. The secret key never leaves the server. The order id is the
 * Idempotency-Key, so a retried confirm (reload, timeout, a second tab) gets the first answer
 * back instead of a fresh ALREADY_PROCESSED_PAYMENT error.
 */
export function confirmTossPayment(paymentKey: string, orderId: string, amount: number): Promise<TossResult> {
  return toss("/v1/payments/confirm", { method: "POST", body: { paymentKey, orderId, amount }, idempotencyKey: orderId, timeoutMs: 30_000 });
}

/** Toss Payments "결제 조회": the payment's current status (DONE, IN_PROGRESS, ABORTED, ...). */
export function getTossPayment(paymentKey: string): Promise<TossResult> {
  return toss(`/v1/payments/${encodeURIComponent(paymentKey)}`, { method: "GET", timeoutMs: 10_000 });
}

export function tossString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** A Toss payment object that is approved and belongs to this order at its price. */
export function isDonePaymentFor(payment: Record<string, unknown>, order: Pick<OrderRow, "order_id" | "amount">): boolean {
  return tossString(payment.status) === "DONE" && tossString(payment.orderId) === order.order_id && payment.totalAmount === order.amount;
}

const PLAN_LABEL: Record<Plan, string> = { free: "무료", pro: "프로", agency: "대행사" };

async function sendReceipt(order: OrderRow, result: FulfilResult): Promise<void> {
  if (!order.customer_email || result.alreadyPaid) return;
  const product = PRODUCTS[order.product];
  const until = result.planUntil ? new Date(result.planUntil).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) : "";
  const days = Math.max(1, Math.floor(result.change?.convertedDays ?? 0));
  const conversion =
    result.change?.kind === "pro_as_agency"
      ? `대행사 플랜을 이용 중이어서, 이번 결제 금액만큼 대행사 이용 기간(약 ${days}일)으로 바꿔 더해 드렸어요.`
      : result.change?.kind === "upgrade"
        ? `남아 있던 프로 기간은 대행사 이용 기간 약 ${days}일로 바꿔 더해 드렸어요.`
        : "";
  // The admin link only goes to the workspace's own address, never to a receipt address typed at checkout.
  const sameOwner = Boolean(result.ownerEmail) && result.ownerEmail?.trim().toLowerCase() === order.customer_email.trim().toLowerCase();
  const lines = [
    `${product.name} 결제가 완료됐어요. 고맙습니다!`,
    "",
    `주문번호: ${order.order_id}`,
    `결제 금액: ${order.amount.toLocaleString("ko-KR")}원`,
    until ? `이용 기간: ${PLAN_LABEL[result.plan]} 플랜 ${until}까지` : "",
    conversion,
    product.concierge ? "캠페인 패스는 담당자가 1영업일 안에 기획 상담 메일을 드려요." : "",
    "",
    sameOwner
      ? `관리 화면: ${appUrl()}/w/${result.workspaceSecret}\n이 링크는 관리자 링크라서 다른 사람과 공유하면 안 돼요.`
      : "관리 화면은 결제한 브라우저의 '내 테스트' 메뉴에서 열 수 있어요.",
    "",
    `영수증·세금계산서 문의: ${appUrl()}/support`,
  ];
  await enqueueEmail({
    to: order.customer_email,
    subject: `[${BRAND.name}] 결제가 완료됐어요 (${product.name})`,
    // Drop the lines that do not apply without leaving double blank lines behind.
    body: lines.filter((l, i) => l !== "" || (i > 0 && lines[i - 1] !== "")).join("\n"),
    kind: "transactional",
    ref: `order:${order.order_id}`,
  });
}

/** Marks a Toss-approved order paid, applies the plan, and queues the receipt the first time only. */
export async function fulfilPaidOrder(order: OrderRow, paymentKey: string, payment: Record<string, unknown>): Promise<FulfilResult> {
  const result = await fulfillOrder(order.order_id, paymentKey, payment);
  try {
    await sendReceipt(order, result);
  } catch (e) {
    console.error("receipt email failed", order.order_id, e);
  }
  return result;
}

/**
 * Daily safety net (cron) for charges whose confirm reached Toss but whose fulfilment never
 * finished and was not retried: any such payment Toss reports as DONE is fulfilled now.
 */
export async function reconcilePendingOrders(): Promise<{ checked: number; fulfilled: number; errors: string[] }> {
  if (!paymentsEnabled()) return { checked: 0, fulfilled: 0, errors: [] };
  const orders = await ordersToReconcile();
  let fulfilled = 0;
  const errors: string[] = [];
  for (const order of orders) {
    if (!order.payment_key) continue;
    try {
      const payment = await getTossPayment(order.payment_key);
      if (payment.ok && isDonePaymentFor(payment.body, order)) {
        await fulfilPaidOrder(order, order.payment_key, payment.body);
        fulfilled++;
      }
    } catch (e) {
      errors.push(`${order.order_id}: ${String(e).slice(0, 200)}`);
    }
  }
  return { checked: orders.length, fulfilled, errors };
}
