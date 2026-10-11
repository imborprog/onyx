import { after, NextResponse } from "next/server";
import { z } from "zod";
import { maybeFlushOutbox } from "@/lib/email";
import { EVENT_TYPES, insertEvent, testIdForSlug } from "@/lib/repo";

export const runtime = "nodejs";

const Body = z.object({
  slug: z.string().max(16),
  type: z.enum(EVENT_TYPES).refine((t) => t !== "lead_submit"),
  resultKey: z.string().max(20).nullable().optional(),
  channel: z.string().max(20).nullable().optional(),
  sessionId: z.string().max(40).nullable().optional(),
});

const BOT = /bot|crawl|spider|preview|facebookexternalhit|kakaotalk-scrap|slurp|headless/i;

export async function POST(req: Request) {
  if (BOT.test(req.headers.get("user-agent") ?? "")) return NextResponse.json({ ok: true });
  let raw: unknown;
  try {
    raw = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  const testId = await testIdForSlug(parsed.data.slug);
  if (!testId) return NextResponse.json({ ok: false }, { status: 404 });
  await insertEvent({ testId, type: parsed.data.type, resultKey: parsed.data.resultKey, channel: parsed.data.channel, sessionId: parsed.data.sessionId });
  after(async () => {
    try {
      await maybeFlushOutbox();
    } catch (e) {
      console.error("outbox flush failed", e);
    }
  });
  return NextResponse.json({ ok: true });
}
