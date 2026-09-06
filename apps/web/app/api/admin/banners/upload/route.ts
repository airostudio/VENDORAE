import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — a banner image has no business being bigger than this
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function extensionFor(contentType: string): string {
  switch (contentType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

/**
 * Accepts a single uploaded banner image and stores it in the public "banners" bucket at
 * "<tenant_id>/<random>.<ext>" (see supabase/storage.sql), returning the resulting public URL.
 * Unlike /api/onboarding/logo this doesn't write anything to a row itself — a banner may not
 * exist yet when its image is uploaded, so the client gets the URL back and sends it along as
 * `mediaUrl` on the create/PATCH call.
 */
export async function POST(request: Request) {
  try {
    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase);

    const formData = await request.formData().catch(() => null);
    const file = formData?.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: "Banner image must be a PNG, JPEG or WebP image." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Banner image must be smaller than 5MB." }, { status: 400 });
    }

    const path = `${tenantId}/${crypto.randomUUID()}.${extensionFor(file.type)}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await supabase.storage.from("banners").upload(path, bytes, {
      contentType: file.type,
      upsert: true,
    });
    if (uploadError) throw new Error(uploadError.message);

    const { data: publicUrlData } = supabase.storage.from("banners").getPublicUrl(path);
    // Cache-bust even though this path is freshly random per upload — cheap insurance against any
    // intermediate CDN caching an identical-looking response.
    const mediaUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

    return NextResponse.json({ mediaUrl });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not upload the image" }, { status: 500 });
  }
}
