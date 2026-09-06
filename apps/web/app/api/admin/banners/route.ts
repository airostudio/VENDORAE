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

/** All banners for the tenant, across every placement, ordered for the admin list. */
export async function GET() {
  try {
    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase);

    const { data, error } = await supabase
      .from("banners")
      .select(BANNER_COLUMNS)
      .eq("tenant_id", tenantId)
      .order("placement")
      .order("position");
    if (error) throw new Error(error.message);

    return NextResponse.json({ banners: data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load banners" }, { status: 500 });
  }
}

const createSchema = z.object({
  headline: z.string().min(1),
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

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a headline for the banner" }, { status: 400 });

  try {
    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase);

    const { data, error } = await supabase
      .from("banners")
      .insert({
        tenant_id: tenantId,
        placement: parsed.data.placement ?? "homepage_hero",
        headline: parsed.data.headline,
        body: parsed.data.body ?? null,
        cta_label: parsed.data.ctaLabel ?? null,
        cta_href: parsed.data.ctaHref ?? null,
        secondary_cta_label: parsed.data.secondaryCtaLabel ?? null,
        secondary_cta_href: parsed.data.secondaryCtaHref ?? null,
        media_url: parsed.data.mediaUrl ?? null,
        position: parsed.data.position ?? 0,
        is_active: parsed.data.isActive ?? true,
      })
      .select(BANNER_COLUMNS)
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ banner: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create banner" }, { status: 500 });
  }
}
