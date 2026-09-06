import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NEW_ARRIVALS_HANDLE } from "../newArrivals";

/**
 * Puts a newly created product into New Arrivals. Mandatory for every product however it was
 * created — AliExpress confirm, CSV, WooCommerce — so "what's new" is never a manual step someone
 * forgets, and the front page always has something current on it.
 *
 * Best-effort by design: a product that exists but isn't listed as new is a much smaller problem
 * than an import that fails outright because of a category link, so this reports rather than
 * throws.
 */
export async function linkToNewArrivals(supabase: SupabaseClient, tenantId: string, productId: string): Promise<boolean> {
  const { data: category } = await supabase
    .from("categories")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("handle", NEW_ARRIVALS_HANDLE)
    .maybeSingle();

  let categoryId = category?.id as string | undefined;
  if (!categoryId) {
    // A store that never seeded categories still gets a working New Arrivals rather than silently
    // skipping it. Position 0 so it leads the nav it appears in.
    const { data: created } = await supabase
      .from("categories")
      .insert({ tenant_id: tenantId, name: "New Arrivals", handle: NEW_ARRIVALS_HANDLE, position: 0 })
      .select("id")
      .single();
    categoryId = created?.id as string | undefined;
  }
  if (!categoryId) return false;

  const { error } = await supabase
    .from("product_categories")
    .upsert({ product_id: productId, category_id: categoryId }, { onConflict: "product_id,category_id" });
  return !error;
}
