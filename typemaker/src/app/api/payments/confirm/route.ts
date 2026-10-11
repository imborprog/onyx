import { NextResponse } from "next/server";
import { z } from "zod";
import { appUrl, BRAND, PRODUCTS } from "@/lib/config";
import { jsonError, readBody } from "@/lib/http";
import { confirmTossPayment } from "@/lib/payments";
import { enqueueEmail, fulfillOrder, getOrder, markOrderFailed } from "@/lib/repo";

export const runtime = "nodejs";

const Body = z.object({
  paymentKey: z.string().min(1).max(200),
  orderId: z.string().min(6).max(64),
  amount: z.coerce.number().int().positive(),
});

export async function POST(req: Request) {
  const body = await readBody(req, Body);
  if (!body.ok) return body.res;
  const { paymentKey, orderId, amount } = body.data;
  const order = await getOrder(orderId);
  if (!order) return jsonError(404, "주문을 찾을 수 없어요");
  if (order.status === "paid") return NextResponse.json({ ok: true, alreadyPaid: true });
  // Never trust the amount in the redirect URL: it must match what we priced.
  if (order.amount !== amount) {
    await markOrderFailed(orderId, { reason: "amount_mismatch", amount });
    return jsonError(400, "결제 금액이 주문과 달라요. 결제가 승인되지 않았어요.");
  }

  const res = await confirmTossPayment(paymentKey, orderId, amount);
  if (!res.ok) {
    await markOrderFailed(orderId, res.body);
    const message = typeof res.body.message === "string" ? res.body.message : "결제 승인에 실패했어요";
    return jsonError(402, message);
  }

  const { planUntil } = await fulfillOrder(orderId, paymentKey, res.body);
  const product = PRODUCTS[order.product];
  if (order.customer_email) {
    const until = planUntil ? new Date(planUntil).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) : "";
    await enqueueEmail({
      to: order.customer_email,
      subject: `[${BRAND.name}] 결제가 완료됐어요 (${product.name})`,
      body: [
        `${product.name} 결제가 완료됐어요. 고맙습니다!`,
        "",
        `결제 금액: ${order.amount.toLocaleString("ko-KR")}원`,
        until ? `이용 기간: ${until}까지` : "",
        product.concierge ? "캠페인 패스는 담당자가 1영업일 안에 기획 상담 메일을 드려요." : "",
        "",
        `영수증·세금계산서 문의: ${appUrl()}/support`,
      ]
        .filter((l) => l !== null)
        .join("\n"),
      kind: "transactional",
      ref: `order:${orderId}`,
    });
  }
  return NextResponse.json({ ok: true, planUntil });
}
