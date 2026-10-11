import { NextResponse } from "next/server";
import { z } from "zod";
import { isProductId, PRODUCTS } from "@/lib/config";
import { emailSchema, jsonError, readBody, requireWorkspace } from "@/lib/http";
import { checkoutTarget, updateWorkspaceProfile } from "@/lib/repo";

export const runtime = "nodejs";

// An empty string clears the field; a missing key leaves it unchanged.
const Body = z.object({
  email: z
    .string()
    .trim()
    .max(120)
    .refine((v) => v === "" || emailSchema.test(v), "이메일 형식을 확인해 주세요")
    .optional(),
  brandName: z.string().trim().max(40).optional(),
  marketingOptIn: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const auth = await requireWorkspace(req);
  if (!auth.ok) return auth.res;
  const body = await readBody(req, Body);
  if (!body.ok) return body.res;
  const { email, brandName, marketingOptIn } = body.data;
  const effectiveEmail = email === undefined ? auth.ws.owner_email : email;
  if (marketingOptIn && !effectiveEmail) return jsonError(400, "소식을 받을 이메일을 먼저 적어 주세요");
  await updateWorkspaceProfile(auth.ws.id, {
    email: email === undefined ? undefined : email || null,
    brandName: brandName === undefined ? undefined : brandName || null,
    marketingOptIn,
    optInSource: "dashboard",
  });
  return NextResponse.json({ ok: true });
}

/** What the checkout screen shows about this workspace, and what paying for `product` would do to its plan. */
export async function GET(req: Request) {
  const auth = await requireWorkspace(req);
  if (!auth.ok) return auth.res;
  const product = new URL(req.url).searchParams.get("product") ?? "";
  if (!isProductId(product)) return jsonError(400, "알 수 없는 상품이에요");
  if (auth.ws.is_house) return jsonError(400, "이 워크스페이스에는 결제할 수 없어요.");
  return NextResponse.json(await checkoutTarget(auth.ws, PRODUCTS[product]), { headers: { "Cache-Control": "no-store" } });
}
