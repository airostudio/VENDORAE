import "server-only";
import { db, getTenantId } from "./client";

/**
 * The eight placeholder products supabase/seed.sql creates. They have no product_media rows at
 * all, so they render imageless on the storefront and are easily mistaken for a broken import.
 *
 * Matched by exact handle — the same list supabase/migrations/0004_remove_demo_seed_products.sql
 * uses — so nothing an admin or an import created can ever be caught by a removal. That migration
 * only helps someone who remembers to run SQL by hand; this list backs an in-app button instead.
 */
export const DEMO_PRODUCT_HANDLES = [
  "driftwood-kimono",
  "sage-ocean-sarong",
  "surf-foam-sandals",
  "woven-driftwood-tote",
  "salt-sand-fabric-care-kit",
  "wide-brim-palm-hat",
  "sun-foam-one-piece",
  "coastal-getaway-set",
] as const;

/** How many seeded placeholders are still in this tenant's catalogue. */
export async function countDemoProducts(): Promise<number> {
  const tenantId = await getTenantId();
  const { count } = await db()
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .in("handle", DEMO_PRODUCT_HANDLES as unknown as string[]);
  return count ?? 0;
}
