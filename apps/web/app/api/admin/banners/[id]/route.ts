import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

const BANNER_COLUMNS =
  "id, placement, headline, body, cta_label, cta_href, secondary_cta_label, secondary_cta_href, media_url, media_type, position, is_active, starts_at, ends_at";

const patchSchema = z.object({
  headline: z.string().min(1).optional(),
  body: z.string().nullable().optional(),
  placement: z.enum(["homepage_hero", "promo_strip"]).optional(),
  ctaLabel: z.string().nullable().optional(),
  ctaHref: z.string().nullable().optional(),
  secondaryCtaLabel: z.string().nullable().optional(),
  secondaryCtaHref: z.string().nullable().optional(),
  mediaUrl: z.string().nullable().optional(),
  position: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

const COLUMN: Record<string, string> = {
  headline: "headline",
  body: "body",
  placement: "placement",
  ctaLabel: "cta_label",
  ctaHref: "cta_href",
  secondaryCtaLabel: "secondary_cta_label",
  secondaryCtaHref: "secondary_cta_href",
  mediaUrl: "media_url",
  position: "position",
  isActive: "is_active",
};

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid banner update" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(parsed.data)) {
    if (COLUMN[field]) updates[COLUMN[field]] = value;
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  try {
    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase);
    const { data, error } = await supabase
      .from("banners")
      .update(updates)
      .eq("id", params.id)
      .eq("tenant_id", tenantId)
      .select(BANNER_COLUMNS)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Banner not found" }, { status: 404 });
    return NextResponse.json({ banner: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update banner" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase);
    const { error } = await supabase.from("banners").delete().eq("id", params.id).eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete banner" }, { status: 500 });
  }
}
