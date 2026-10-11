import { NextResponse } from "next/server";
import { z } from "zod";
import { emailSchema, readBody, requireWorkspace } from "@/lib/http";
import { updateWorkspaceProfile } from "@/lib/repo";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().trim().max(120).regex(emailSchema).optional().or(z.literal("")),
  brandName: z.string().trim().max(40).optional(),
  marketingOptIn: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const auth = await requireWorkspace(req);
  if (!auth.ok) return auth.res;
  const body = await readBody(req, Body);
  if (!body.ok) return body.res;
  await updateWorkspaceProfile(auth.ws.id, {
    email: body.data.email || null,
    brandName: body.data.brandName || null,
    marketingOptIn: body.data.marketingOptIn,
  });
  return NextResponse.json({ ok: true });
}
