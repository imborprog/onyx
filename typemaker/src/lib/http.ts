import "server-only";
import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import type { ZodType, ZodTypeDef } from "zod";
import { ENV } from "./config";
import { getWorkspaceBySecret, type Workspace } from "./repo";
import type { Settings } from "./schema";

/**
 * The address abuse limits are keyed on. IPv6 clients usually control a whole /64
 * (one per phone on Korean carriers), so they are grouped by that prefix.
 */
function clientNetwork(raw: string): string {
  const ip = raw.trim().toLowerCase().replace(/^\[|\](:\d+)?$/g, "").replace(/%.*$/, "");
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/.exec(ip);
  if (v4?.[1]) return v4[1];
  if (!ip.includes(":")) return ip;
  const [head = "", tail] = ip.split("::", 2);
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const groups = tail === undefined ? headParts : [...headParts, ...Array<string>(Math.max(0, 8 - headParts.length - tailParts.length)).fill("0"), ...tailParts];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return ip;
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":")}::/64`;
}

/** One-way HMAC-SHA256 of the client address, keyed by IP_HASH_SALT. */
export function ipHash(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return createHmac("sha256", ENV.ipSalt()).update(clientNetwork(ip)).digest("hex").slice(0, 32);
}

/** The coupon code a participant with this result gets: the per-result code if set, else the common one. */
export function couponCodeFor(coupon: Settings["coupon"], resultKey: string | null): string | null {
  const perResult = resultKey && Object.hasOwn(coupon.perResult, resultKey) ? coupon.perResult[resultKey] : undefined;
  return perResult || coupon.code || null;
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
