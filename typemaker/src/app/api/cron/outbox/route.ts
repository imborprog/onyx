import { NextResponse } from "next/server";
import { ENV } from "@/lib/config";
import { flushOutbox, type FlushResult } from "@/lib/email";
import { reconcilePendingOrders } from "@/lib/payments";
import { purgeRetention, type RetentionResult } from "@/lib/repo";

export const runtime = "nodejs";
export const maxDuration = 60;

// Daily housekeeping. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set.
// Retention runs first and every job has its own try/catch, so a mail failure never skips the purge.
// Any failure answers 500, so it shows up as a failed run in the Vercel cron log.
export async function GET(req: Request) {
  const secret = ENV.cronSecret();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const errors: string[] = [];
  let retention: RetentionResult | null = null;
  let orders: { checked: number; fulfilled: number } | null = null;
  let mail: FlushResult | null = null;
  try {
    retention = await purgeRetention();
    errors.push(...retention.errors.map((e) => `retention ${e}`));
  } catch (e) {
    errors.push(`retention: ${String(e).slice(0, 300)}`);
  }
  try {
    const r = await reconcilePendingOrders();
    orders = { checked: r.checked, fulfilled: r.fulfilled };
    errors.push(...r.errors.map((e) => `orders ${e}`));
  } catch (e) {
    errors.push(`orders: ${String(e).slice(0, 300)}`);
  }
  try {
    mail = await flushOutbox(50, 30_000);
  } catch (e) {
    errors.push(`mail: ${String(e).slice(0, 300)}`);
  }
  const result = { ok: errors.length === 0, retention: retention?.counts ?? null, orders, mail, errors };
  if (errors.length) console.error(JSON.stringify({ job: "cron/outbox", ...result }));
  else console.log(JSON.stringify({ job: "cron/outbox", ...result }));
  return NextResponse.json(result, { status: errors.length ? 500 : 200 });
}
