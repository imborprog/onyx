import { NextResponse } from "next/server";
import { ENV } from "@/lib/config";
import { flushOutbox } from "@/lib/email";
import { purgeExpiredLeads } from "@/lib/repo";

export const runtime = "nodejs";
export const maxDuration = 60;

// Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set.
export async function GET(req: Request) {
  const secret = ENV.cronSecret();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const mail = await flushOutbox(50);
  const purged = await purgeExpiredLeads();
  return NextResponse.json({ ok: true, mail, purgedLeads: purged });
}
