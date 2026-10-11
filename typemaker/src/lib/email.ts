import "server-only";
import { ENV } from "./config";
import { claimEmails, claimInterval, markEmail, purgeRetentionIfDue, releaseEmail } from "./repo";

const SEND_TIMEOUT_MS = 10_000;

async function sendViaResend(id: number, to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ENV.resendKey()}`,
      "Content-Type": "application/json",
      // A row retried after an interrupted flush is not delivered twice (Resend keeps keys for 24 hours).
      "Idempotency-Key": `outbox-${id}`,
    },
    body: JSON.stringify({ from: ENV.emailFrom(), to: [to], subject, text }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: `${res.status} ${(await res.text()).slice(0, 300)}` };
}

export function emailEnabled(): boolean {
  return ENV.resendKey().length > 0 && ENV.emailFrom().length > 0;
}

export interface FlushResult {
  sent: number;
  failed: number;
  released: number;
  skipped: boolean;
}

/**
 * Sends pending outbox mail. Without an email provider configured, mail stays pending (replies are
 * still visible on the ticket page). Rows are claimed first, so concurrent flushes never send the
 * same row; rows not reached within `budgetMs` go back to pending untouched.
 */
export async function flushOutbox(limit = 20, budgetMs = 40_000): Promise<FlushResult> {
  if (!emailEnabled()) return { sent: 0, failed: 0, released: 0, skipped: true };
  const started = Date.now();
  let sent = 0;
  let failed = 0;
  let released = 0;
  for (const m of await claimEmails(limit)) {
    if (Date.now() - started > budgetMs) {
      await releaseEmail(m.id);
      released++;
      continue;
    }
    let result: { ok: boolean; error?: string };
    try {
      result = await sendViaResend(m.id, m.to_email, m.subject, m.body_text);
    } catch (e) {
      result = { ok: false, error: String(e).slice(0, 300) };
    }
    await markEmail(m.id, result.ok, result.error);
    if (result.ok) sent++;
    else failed++;
  }
  return { sent, failed, released, skipped: false };
}

/**
 * Housekeeping from busy routes, because Vercel Hobby crons only run daily and a broken cron
 * must not stop the privacy purge: retention at most once a day, the outbox at most once a minute.
 */
export async function maybeFlushOutbox(): Promise<void> {
  try {
    const purged = await purgeRetentionIfDue();
    if (purged) console.log(JSON.stringify({ job: "retention", trigger: "opportunistic", ...purged }));
  } catch (e) {
    console.error("retention purge failed", e);
  }
  if (!emailEnabled()) return;
  if (!(await claimInterval("outbox_last_flush", 60))) return;
  await flushOutbox(10, 20_000);
}
