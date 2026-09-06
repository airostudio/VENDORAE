import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  tenant: z.string().optional(), // tenant id (uuid) or slug
  filename: z.string().min(1).max(200),
});

/**
 * Issues a short-lived, tenant-scoped signed upload URL so the browser can
 * PUT the raw CSV bytes straight to Supabase Storage — never through this
 * Next.js server. That's what avoids the ~4.5MB request-body ceiling
 * serverless functions impose on API routes: the big binary transfer never
 * touches a function at all, only this small JSON exchange does.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createServiceRoleSupabaseClient();
  const tenantId = await resolveTenantId(supabase, parsed.data.tenant);

  const path = `${tenantId}/${crypto.randomUUID()}/${parsed.data.filename}`;
  const { data, error } = await supabase.storage.from("imports").createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not create upload URL" }, { status: 500 });

  return NextResponse.json({ path, signedUrl: data.signedUrl, token: data.token, tenantId });
}
