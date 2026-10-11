import { NextResponse } from "next/server";
import { z } from "zod";
import { isProductId, PRODUCTS } from "@/lib/config";
import { emailSchema, ipHash, jsonError, readBody } from "@/lib/http";
import { cardCheckoutStatus } from "@/lib/payments";
import { createOrder, createWorkspace, getWorkspaceBySecret, updateWorkspaceProfile, type Workspace } from "@/lib/repo";

export const runtime = "nodejs";

const Body = z.object({
  product: z.string().refine(isProductId, "알 수 없는 상품이에요"),
  email: z.string().trim().max(120).regex(emailSchema, "영수증을 받을 이메일을 확인해 주세요"),
  // Set only after the buyer confirmed on the checkout screen that a new workspace should be created.
  newWorkspace: z.boolean().default(false),
});

export async function POST(req: Request) {
  const status = cardCheckoutStatus();
  if (status === "no_toss") return jsonError(503, "카드 결제를 준비 중이에요. 결제 안내 요청을 남겨 주세요.");
  if (status === "no_business_info") return jsonError(503, "판매자 정보가 준비되지 않아 지금은 카드 결제를 받을 수 없어요. 결제 안내 요청을 남겨 주세요.");
  const body = await readBody(req, Body);
  if (!body.ok) return body.res;
  const product = body.data.product;
  if (!isProductId(product)) return jsonError(400, "알 수 없는 상품이에요");

  // The plan goes to the workspace the buyer picked on the checkout screen. A missing or wrong
  // link is an error, never a silent new workspace that would receive the plan instead.
  const header = req.headers.get("x-workspace");
  let ws: Workspace | null;
  if (header) {
    ws = await getWorkspaceBySecret(header);
    if (!ws) return jsonError(400, "관리 링크가 올바르지 않아요. 내 테스트 화면의 관리 링크를 다시 확인해 주세요.");
  } else if (body.data.newWorkspace) {
    ws = await createWorkspace({ email: body.data.email, ipHash: ipHash(req) });
  } else {
    return jsonError(400, "플랜을 적용할 워크스페이스를 정해 주세요. 이미 만든 테스트가 있다면 관리 링크를 붙여 넣어 주세요.");
  }
  if (ws.is_house) return jsonError(400, "이 워크스페이스에는 결제할 수 없어요.");
  if (!ws.owner_email) await updateWorkspaceProfile(ws.id, { email: body.data.email });

  const order = await createOrder(ws.id, product, body.data.email);
  return NextResponse.json({
    orderId: order.order_id,
    amount: order.amount,
    orderName: `${PRODUCTS[product].name}`,
    customerKey: `ws_${ws.id.replace(/-/g, "").slice(0, 40)}`,
    workspaceSecret: ws.secret,
  });
}
