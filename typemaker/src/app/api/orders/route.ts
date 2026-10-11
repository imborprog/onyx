import { NextResponse } from "next/server";
import { z } from "zod";
import { isProductId, paymentsEnabled, PRODUCTS } from "@/lib/config";
import { emailSchema, ipHash, jsonError, readBody } from "@/lib/http";
import { createOrder, createWorkspace, getWorkspaceBySecret, updateWorkspaceProfile } from "@/lib/repo";

export const runtime = "nodejs";

const Body = z.object({
  product: z.string().refine(isProductId, "알 수 없는 상품이에요"),
  email: z.string().trim().max(120).regex(emailSchema, "영수증을 받을 이메일을 확인해 주세요"),
});

export async function POST(req: Request) {
  if (!paymentsEnabled()) return jsonError(503, "카드 결제를 준비 중이에요. 도입 문의로 남겨 주세요.");
  const body = await readBody(req, Body);
  if (!body.ok) return body.res;
  const product = body.data.product;
  if (!isProductId(product)) return jsonError(400, "알 수 없는 상품이에요");

  let ws = await getWorkspaceBySecret(req.headers.get("x-workspace"));
  if (!ws) ws = await createWorkspace({ email: body.data.email, ipHash: ipHash(req) });
  else if (!ws.owner_email) await updateWorkspaceProfile(ws.id, { email: body.data.email });

  const order = await createOrder(ws.id, product, body.data.email);
  return NextResponse.json({
    orderId: order.order_id,
    amount: order.amount,
    orderName: `${PRODUCTS[product].name}`,
    customerKey: `ws_${ws.id.replace(/-/g, "").slice(0, 40)}`,
    workspaceSecret: ws.secret,
  });
}
