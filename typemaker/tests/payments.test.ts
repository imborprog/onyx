import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as confirm } from "@/app/api/payments/confirm/route";
import { db } from "@/lib/db";
import { createOrder, createWorkspace, getOrder, type OrderRow } from "@/lib/repo";

// The confirm route against an in-memory PGlite database, with Toss mocked at fetch().
process.env.PGLITE_DIR = ":memory:";
delete process.env.DATABASE_URL;

type TossReply = { status: number; body: Record<string, unknown> } | "network";

/** Mocks the two Toss endpoints the route calls: POST /v1/payments/confirm and GET /v1/payments/{key}. */
function mockToss(replies: { confirm: TossReply; lookup?: TossReply }): string[] {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const which = url.endsWith("/v1/payments/confirm") ? "confirm" : "lookup";
    calls.push(`${init?.method ?? "GET"} ${which}`);
    const reply = which === "confirm" ? replies.confirm : (replies.lookup ?? { status: 404, body: { code: "NOT_FOUND_PAYMENT" } });
    if (reply === "network") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

function done(order: OrderRow, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { status: "DONE", orderId: order.order_id, totalAmount: order.amount, method: "카드", ...extra };
}

async function post(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await confirm(new Request("http://localhost/api/payments/confirm", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function newOrder(): Promise<OrderRow> {
  const ws = await createWorkspace({ email: "buyer@example.com" });
  return createOrder(ws.id, "pro_month", "buyer@example.com");
}

async function receipts(order: OrderRow): Promise<number> {
  const rows = await (await db()).query<{ n: number }>("select count(*)::int as n from outbox where ref = $1", [`order:${order.order_id}`]);
  return rows[0]?.n ?? 0;
}

beforeAll(async () => {
  await db();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("cardCheckoutStatus", () => {
  it("keeps card payments off until the Toss keys and the seller details are all set", async () => {
    const load = async (env: Record<string, string>) => {
      vi.resetModules();
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
      return (await import("@/lib/payments")).cardCheckoutStatus();
    };
    expect(await load({ NEXT_PUBLIC_TOSS_CLIENT_KEY: "", TOSS_SECRET_KEY: "" })).toBe("no_toss");
    const keys = { NEXT_PUBLIC_TOSS_CLIENT_KEY: "test_ck", TOSS_SECRET_KEY: "test_sk" };
    expect(await load({ ...keys, NEXT_PUBLIC_BIZ_NAME: "", NEXT_PUBLIC_BIZ_REG_NO: "" })).toBe("no_business_info");
    expect(await load({ ...keys, NEXT_PUBLIC_BIZ_NAME: "유형공장", NEXT_PUBLIC_BIZ_REG_NO: "" })).toBe("no_business_info");
    expect(await load({ ...keys, NEXT_PUBLIC_BIZ_NAME: "유형공장", NEXT_PUBLIC_BIZ_REG_NO: "123-45-67890" })).toBe("ready");
  });
});

describe("POST /api/payments/confirm", () => {
  it("fulfils an approved payment once and queues one receipt", async () => {
    const order = await newOrder();
    const calls = mockToss({ confirm: { status: 200, body: done(order) } });
    const first = await post({ paymentKey: "pk_1", orderId: order.order_id, amount: order.amount });
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ ok: true, alreadyPaid: false, plan: "pro" });
    expect(calls).toEqual(["POST confirm"]);
    const again = await post({ paymentKey: "pk_1", orderId: order.order_id, amount: order.amount });
    expect(again.json).toMatchObject({ ok: true, alreadyPaid: true });
    expect(await receipts(order)).toBe(1);
  });

  it("fulfils a payment Toss already approved when a retried confirm is refused", async () => {
    const order = await newOrder();
    const calls = mockToss({
      confirm: { status: 400, body: { code: "ALREADY_PROCESSED_PAYMENT", message: "이미 처리된 결제" } },
      lookup: { status: 200, body: done(order) },
    });
    const res = await post({ paymentKey: "pk_2", orderId: order.order_id, amount: order.amount });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["POST confirm", "GET lookup"]);
    expect((await getOrder(order.order_id))?.status).toBe("paid");
  });

  it("marks the order failed only when the payment is definitively refused", async () => {
    const order = await newOrder();
    mockToss({
      confirm: { status: 403, body: { code: "REJECT_CARD_COMPANY", message: "카드사 거절" } },
      lookup: { status: 200, body: { status: "ABORTED", orderId: order.order_id, totalAmount: order.amount } },
    });
    const res = await post({ paymentKey: "pk_3", orderId: order.order_id, amount: order.amount });
    expect(res.status).toBe(402);
    expect((await getOrder(order.order_id))?.status).toBe("failed");
  });

  it("keeps the order pending, with its payment key, when Toss cannot be reached", async () => {
    const order = await newOrder();
    mockToss({ confirm: "network", lookup: "network" });
    const res = await post({ paymentKey: "pk_4", orderId: order.order_id, amount: order.amount });
    expect(res.status).toBe(503);
    expect(res.json.retryable).toBe(true);
    const stored = await getOrder(order.order_id);
    expect(stored).toMatchObject({ status: "pending", payment_key: "pk_4" });
  });

  it("never fulfils a payment that belongs to another order", async () => {
    const order = await newOrder();
    mockToss({
      confirm: { status: 400, body: { code: "ALREADY_PROCESSED_PAYMENT" } },
      lookup: { status: 200, body: { status: "DONE", orderId: "tm_someone_else", totalAmount: order.amount } },
    });
    const res = await post({ paymentKey: "pk_5", orderId: order.order_id, amount: order.amount });
    expect(res.status).toBe(400);
    expect((await getOrder(order.order_id))?.status).toBe("pending");
  });

  it("rejects an amount that differs from the order without calling Toss", async () => {
    const order = await newOrder();
    const calls = mockToss({ confirm: { status: 200, body: done(order) } });
    const res = await post({ paymentKey: "pk_6", orderId: order.order_id, amount: 100 });
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
    expect((await getOrder(order.order_id))?.status).toBe("failed");
  });
});
