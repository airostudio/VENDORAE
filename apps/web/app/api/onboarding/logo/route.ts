import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — a logo has no business being bigger than this
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

function extensionFor(contentType: string): string {
  switch (contentType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    default:
      return "bin";
  }
}

/**
 * Accepts a single uploaded logo image, stores it in the public "branding" bucket at
 * "<tenant_id>/logo.<ext>" (see supabase/storage.sql), and saves the resulting public URL onto
 * tenant_settings.logo_url. Uses the service-role client for the same reason as
 * /api/onboarding/complete — a brand-new owner has no membership row yet.
 */
export async function POST(request: Request) {
  const supabase = createServiceRoleSupabaseClient();
  try {
    const tenantId = await resolveTenantId(supabase);

    const formData = await request.formData().catch(() => null);
    const file = formData?.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: "Logo must be a PNG, JPEG, WebP or SVG image." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Logo must be smaller than 5MB." }, { status: 400 });
    }

    const path = `${tenantId}/logo.${extensionFor(file.type)}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await supabase.storage.from("branding").upload(path, bytes, {
      contentType: file.type,
      upsert: true,
    });
    if (uploadError) throw new Error(uploadError.message);

    const { data: publicUrlData } = supabase.storage.from("branding").getPublicUrl(path);
    // Cache-bust: the path is stable ("upsert" reuses it on a re-upload), so without a changing
    // query string the browser/CDN would keep serving the previous logo's bytes under the same URL.
    const logoUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

    const { error: updateError } = await supabase.from("tenant_settings").update({ logo_url: logoUrl }).eq("tenant_id", tenantId);
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ logoUrl });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not upload the logo" }, { status: 500 });
  }
}
