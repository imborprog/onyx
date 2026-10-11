import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readBody } from "@/lib/http";
import { confirmTossPayment, fulfilPaidOrder, getTossPayment, isDonePaymentFor, tossString, type TossResult } from "@/lib/payments";
import { attachPaymentKey, getOrder, markOrderFailed, OrderClosedError, type FulfilResult, type OrderRow } from "@/lib/repo";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  paymentKey: z.string().min(1).max(200),
  orderId: z.string().min(6).max(64),
  amount: z.coerce.number().int().positive(),
});

// Toss error codes that say nothing final about the payment itself: Toss-side or card-network
// trouble, a request still in progress, an already-confirmed payment, or our own key setup.
const NOT_FINAL_CODES = new Set([
  "ALREADY_PROCESSED_PAYMENT",
  "IDEMPOTENT_REQUEST_PROCESSING",
  "PROVIDER_ERROR",
  "FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING",
  "FAILED_INTERNAL_SYSTEM_PROCESSING",
  "UNKNOWN_PAYMENT_ERROR",
  "FAILED_CARD_COMPANY_RESPONSE",
  "CARD_PROCESSING_ERROR",
  "UNAUTHORIZED_KEY",
  "INVALID_API_KEY",
  "NOT_FOUND_PAYMENT",
  "NETWORK_ERROR",
]);
// Payment statuses that can never become DONE.
const CLOSED_STATUSES = new Set(["ABORTED", "EXPIRED", "CANCELED", "PARTIAL_CANCELED"]);

/** A 4xx from confirm whose code means the payment itself was refused (card rejected, session expired, ...). */
function isDefinitiveRejection(r: TossResult): boolean {
  return r.status >= 400 && r.status < 500 && !NOT_FINAL_CODES.has(tossString(r.body.code));
}

function retryLater(message: string): NextResponse {
  return NextResponse.json({ error: message, retryable: true }, { status: 503 });
}

function rejected(r: TossResult): string {
  const message = tossString(r.body.message).trim();
  return message ? `결제가 승인되지 않았어요: ${message.slice(0, 200)}` : "결제가 승인되지 않았어요. 다른 카드로 다시 시도해 주세요.";
}

async function fulfil(order: OrderRow, paymentKey: string, payment: Record<string, unknown>): Promise<NextResponse> {
  let result: FulfilResult;
  try {
    result = await fulfilPaidOrder(order, paymentKey, payment);
  } catch (e) {
    if (e instanceof OrderClosedError) return jsonError(409, "취소되거나 환불된 주문이에요. 문의하기로 알려 주세요.");
    // Toss has the money: a retry re-confirms (idempotent) or finds the payment DONE, and the daily cron reconciles it too.
    console.error("fulfilment failed after a successful payment", order.order_id, e);
    return retryLater("결제는 승인됐지만 플랜 적용이 아직 끝나지 않았어요. 잠시 후 다시 확인해 주세요.");
  }
  return NextResponse.json({ ok: true, alreadyPaid: result.alreadyPaid, plan: result.plan, planUntil: result.planUntil });
}

export async function POST(req: Request) {
  const body = await readBody(req, Body);
  if (!body.ok) return body.res;
  const { paymentKey, orderId, amount } = body.data;
  const order = await getOrder(orderId);
  if (!order) return jsonError(404, "주문을 찾을 수 없어요");
  if (order.status === "paid") return fulfil(order, paymentKey, {});
  if (order.status === "refunded" || order.status === "cancelled") return jsonError(409, "취소되거나 환불된 주문이에요. 문의하기로 알려 주세요.");
  // Never trust the amount in the redirect URL: it must match what we priced.
  if (order.amount !== amount) {
    await markOrderFailed(orderId, { reason: "amount_mismatch", amount });
    return jsonError(400, "결제 금액이 주문과 달라요. 결제가 승인되지 않았어요.");
  }

  await attachPaymentKey(orderId, paymentKey);
  const res = await confirmTossPayment(paymentKey, orderId, amount);
  if (res.ok) {
    if (isDonePaymentFor(res.body, order)) return fulfil(order, paymentKey, res.body);
    console.error("toss confirm returned an unexpected payment", orderId, res.body.status, res.body.orderId, res.body.totalAmount);
    return retryLater("결제 상태를 확인하는 중이에요. 잠시 후 다시 확인해 주세요.");
  }

  // Not OK does not mean not paid (a retry after a timeout gets ALREADY_PROCESSED_PAYMENT, for
  // example), so ask Toss what happened to this payment before deciding anything.
  const lookup = await getTossPayment(paymentKey);
  if (!lookup.ok) {
    if (lookup.status === 0 || lookup.status >= 500) return retryLater("결제 확인이 지연되고 있어요. 잠시 후 다시 확인해 주세요.");
    // Unknown payment key: nothing to attribute to this order, so its state is left alone.
    return jsonError(400, isDefinitiveRejection(res) ? rejected(res) : "결제 정보를 확인할 수 없어요. 다시 결제해 주세요.");
  }
  if (tossString(lookup.body.orderId) !== order.order_id) return jsonError(400, "결제 정보가 주문과 맞지 않아요.");
  const status = tossString(lookup.body.status);
  if (status === "DONE") {
    if (isDonePaymentFor(lookup.body, order)) return fulfil(order, paymentKey, lookup.body);
    console.error("toss payment amount differs from the order", orderId, lookup.body.totalAmount, order.amount);
    return jsonError(400, "결제 금액이 주문과 달라요. 문의하기로 알려 주세요.");
  }
  if (CLOSED_STATUSES.has(status) || isDefinitiveRejection(res)) {
    await markOrderFailed(orderId, { confirm: res.body, payment: { status, method: lookup.body.method ?? null } });
    return jsonError(402, rejected(res));
  }
  return retryLater("결제를 처리하는 중이에요. 잠시 후 다시 확인해 주세요.");
}
