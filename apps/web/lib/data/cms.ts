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

const FALLBACK_HERO: Omit<HeroBanner, "id"> = {
  headline: "Warm Sand, Salt Air, Slow Days",
  body: "Boho surf-culture apparel and accessories — woven, hand-dyed and built for barefoot mornings.",
  primaryCta: { label: "Shop New Arrivals", href: "/shop/new-arrivals" },
  secondaryCta: { label: "Shop All", href: "/shop" },
};

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

/** The active homepage hero banner an admin has configured — falls back to generic site copy if none exists yet. */
export async function getHeroBanner(): Promise<HeroBanner> {
  const tenantId = await getTenantId();
  const { data } = await db()
    .from("banners")
    .select("id, headline, body, cta_label, cta_href, media_url, secondary_cta_label, secondary_cta_href")
    .eq("tenant_id", tenantId)
    .eq("placement", "homepage_hero")
    .eq("is_active", true)
    .order("position")
    .limit(1)
    .maybeSingle();

  if (!data) return { id: "fallback", ...FALLBACK_HERO };
  const row = data as BannerRow;
  return {
    id: row.id,
    headline: row.headline,
    body: row.body ?? FALLBACK_HERO.body,
    imageUrl: row.media_url ?? undefined,
    primaryCta: row.cta_label && row.cta_href ? { label: row.cta_label, href: row.cta_href } : FALLBACK_HERO.primaryCta,
    secondaryCta: row.secondary_cta_label && row.secondary_cta_href ? { label: row.secondary_cta_label, href: row.secondary_cta_href } : undefined,
  };
}
