import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDefaultTenantSlug } from "@/lib/tenant/host";

/**
 * Subdomains that must never be assignable to a tenant — either because they're reserved for
 * platform infrastructure (www, admin, api, app, platform, static, assets, mail, ftp) or because
 * they'd collide with the pre-existing default tenant (see supabase/seed.sql).
 */
export function reservedSlugs(): string[] {
  return ["www", "admin", "api", "app", "platform", "static", "assets", "mail", "ftp", getDefaultTenantSlug()];
}

/**
 * Same slugify rule as apps/web/lib/import/commitAliExpressImport.ts (lowercase, alphanumeric +
 * hyphens, no leading/trailing hyphens) — kept in sync rather than imported since that one is a
 * module-private helper scoped to product handles, not subdomains, and this needs its own length
 * cap suited to a hostname label.
 */
export function slugifyStoreName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function isReservedSlug(slug: string): boolean {
  return reservedSlugs().includes(slug);
}

/**
 * Derives a subdomain-safe, non-reserved, unique slug from a buyer-entered store name. Appends
 * "-2", "-3", ... deterministically until a free one is found, so checkout initiation never fails
 * outright over a name collision — the buyer just gets a slightly different subdomain than their
 * exact business name, which they can see and reconsider before paying (the checkout endpoint
 * returns the derived slug for exactly this reason).
 *
 * Returns null only if the input has no slug-able characters at all (e.g. entirely emoji/CJK
 * with no ASCII alphanumerics), which callers should treat as a validation error.
 */
export async function deriveAvailableSlug(supabase: SupabaseClient, storeName: string): Promise<string | null> {
  const base = slugifyStoreName(storeName);
  if (!base) return null;

  let candidate = isReservedSlug(base) ? `${base}-store` : base;
  let suffix = 2;
  // Bounded loop — a pathological run of collisions still terminates rather than looping forever.
  for (let attempt = 0; attempt < 1000; attempt++) {
    if (!isReservedSlug(candidate)) {
      const { data, error } = await supabase.from("tenants").select("id").eq("slug", candidate).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return candidate;
    }
    candidate = `${base}-${suffix}`.slice(0, 63);
    suffix += 1;
  }
  return null;
}
