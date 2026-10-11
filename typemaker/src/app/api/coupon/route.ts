import { NextResponse } from "next/server";
import { getPublicTest } from "@/lib/repo";
import { couponCodeFor } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/coupon?slug=<slug>&key=<resultKey> -> { code: string | null }.
 * Public pages never embed coupon codes; the player asks here for ungated coupons.
 * Codes behind the lead form are only released by POST /api/leads.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug") ?? "";
  const rawKey = url.searchParams.get("key");
  const key = rawKey && rawKey.length <= 20 ? rawKey : null;
  const pt = await getPublicTest(slug);
  let code: string | null = null;
  if (pt) {
    const { coupon, lead } = pt.test.settings;
    // Same gate the player applies: requireLead only locks the coupon when there is a lead form to fill in.
    const gated = coupon.requireLead && lead.enabled;
    if (coupon.enabled && !gated) code = couponCodeFor(coupon, key);
  }
  return NextResponse.json({ code }, { headers: { "Cache-Control": "no-store" } });
}
