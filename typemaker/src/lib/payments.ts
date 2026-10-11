import "server-only";
import { ENV } from "./config";

export interface TossConfirmResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

// Toss Payments "결제 승인" API. The secret key never leaves the server.
export async function confirmTossPayment(paymentKey: string, orderId: string, amount: number): Promise<TossConfirmResult> {
  const auth = Buffer.from(`${ENV.tossSecretKey()}:`).toString("base64");
  const res = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { ok: res.ok, status: res.status, body };
}
