import "server-only";
import { db, getTenantId } from "./client";

export interface HeroBanner {
  id: string;
  headline: string;
  body: string;
  imageUrl?: string;
  primaryCta: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
}

// Shown only when a tenant has zero homepage_hero banner rows — shouldn't normally happen since
// supabase/seed.sql now inserts a few placeholder rows for every new tenant, but this is the
// safety net if they're ever deleted down to none. Deliberately generic/placeholder-flavoured so
// it never reads as real brand copy if it does surface.
const FALLBACK_HERO: Omit<HeroBanner, "id"> = {
  headline: "Welcome to Your New Store",
  body: "This is placeholder text — head to Admin → CMS & Banners to add your own headline, image and call-to-action.",
  primaryCta: { label: "Shop All", href: "/shop" },
};
const FALLBACK_IMAGE_URL = "https://placehold.co/1600x900/1a1a1a/ffffff?text=Your+Store+Banner";

interface BannerRow {
  id: string;
  headline: string;
  body: string | null;
  cta_label: string | null;
  cta_href: string | null;
  media_url: string | null;
  secondary_cta_label: string | null;
  secondary_cta_href: string | null;
}

/**
 * All active homepage hero banners an admin has configured, ordered by position — falls back to a
 * single generic placeholder banner if none exist yet. The homepage uses the first entry for its
 * headline/body/CTA text and the whole list to drive the crossfading slideshow image.
 */
export async function getHeroBanners(): Promise<HeroBanner[]> {
  const tenantId = await getTenantId();
  const { data } = await db()
    .from("banners")
    .select("id, headline, body, cta_label, cta_href, media_url, secondary_cta_label, secondary_cta_href")
    .eq("tenant_id", tenantId)
    .eq("placement", "homepage_hero")
    .eq("is_active", true)
    .order("position");

  const rows = (data ?? []) as BannerRow[];
  if (rows.length === 0) return [{ id: "fallback", ...FALLBACK_HERO, imageUrl: FALLBACK_IMAGE_URL }];

  return rows.map((row) => ({
    id: row.id,
    headline: row.headline,
    body: row.body ?? FALLBACK_HERO.body,
    imageUrl: row.media_url ?? undefined,
    primaryCta: row.cta_label && row.cta_href ? { label: row.cta_label, href: row.cta_href } : FALLBACK_HERO.primaryCta,
    secondaryCta: row.secondary_cta_label && row.secondary_cta_href ? { label: row.secondary_cta_label, href: row.secondary_cta_href } : undefined,
  }));
}
