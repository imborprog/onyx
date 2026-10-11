import "server-only";
import { ENV } from "./config";
import { kvGet, kvSet, markEmail, pendingEmails } from "./repo";

async function sendViaResend(to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${ENV.resendKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: ENV.emailFrom(), to: [to], subject, text }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: `${res.status} ${(await res.text()).slice(0, 300)}` };
}

export function emailEnabled(): boolean {
  return ENV.resendKey().length > 0 && ENV.emailFrom().length > 0;
}

/** Sends pending outbox mail. Without an email provider configured, mail stays pending (replies are still visible on the ticket page). */
export async function flushOutbox(limit = 20): Promise<{ sent: number; failed: number; skipped: boolean }> {
  if (!emailEnabled()) return { sent: 0, failed: 0, skipped: true };
  let sent = 0;
  let failed = 0;
  for (const m of await pendingEmails(limit)) {
    try {
      const r = await sendViaResend(m.to_email, m.subject, m.body_text);
      await markEmail(m.id, r.ok, r.error);
      if (r.ok) sent++;
      else failed++;
    } catch (e) {
      await markEmail(m.id, false, String(e).slice(0, 300));
      failed++;
    }
  }
  return { sent, failed, skipped: false };
}

/** Opportunistic flush from busy routes, at most once a minute (Vercel Hobby crons only run daily). */
export async function maybeFlushOutbox(): Promise<void> {
  if (!emailEnabled()) return;
  const last = Number((await kvGet("outbox_last_flush")) ?? 0);
  if (Date.now() - last < 60_000) return;
  await kvSet("outbox_last_flush", String(Date.now()));
  await flushOutbox(10);
}
