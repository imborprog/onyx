import "server-only";
import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import type { ZodType, ZodTypeDef } from "zod";
import { ENV } from "./config";
import { clientNetwork } from "./ip";
import { getWorkspaceBySecret, type Workspace } from "./repo";

/** One-way HMAC-SHA256 of the client address, keyed by IP_HASH_SALT. */
export function ipHash(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return createHmac("sha256", ENV.ipSalt()).update(clientNetwork(ip)).digest("hex").slice(0, 32);
}

export function jsonError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function readBody<T>(req: Request, schema: ZodType<T, ZodTypeDef, unknown>): Promise<{ ok: true; data: T } | { ok: false; res: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, res: jsonError(400, "요청 형식이 올바르지 않습니다") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, res: jsonError(400, first ? `${first.path.join(".")}: ${first.message}` : "입력값을 확인해 주세요") };
  }
  return { ok: true, data: parsed.data };
}

/** Workspace auth: the private workspace secret travels in the x-workspace header. */
export async function requireWorkspace(req: Request): Promise<{ ok: true; ws: Workspace } | { ok: false; res: NextResponse }> {
  const ws = await getWorkspaceBySecret(req.headers.get("x-workspace"));
  if (!ws) return { ok: false, res: jsonError(401, "관리 링크가 올바르지 않습니다") };
  return { ok: true, ws };
}

export const emailSchema = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
