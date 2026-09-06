import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || "beach-footprints-demo";

/** Resolve a tenant id, defaulting to the single demo tenant until admin auth picks the active tenant from a session. */
export async function resolveTenantId(supabase: SupabaseClient, tenantIdOrSlug?: string): Promise<string> {
  if (tenantIdOrSlug && /^[0-9a-f-]{36}$/i.test(tenantIdOrSlug)) return tenantIdOrSlug;

  const { data, error } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", tenantIdOrSlug || DEFAULT_TENANT_SLUG)
    .single();

  if (error || !data) throw new Error(`Could not resolve tenant "${tenantIdOrSlug || DEFAULT_TENANT_SLUG}"`);
  return data.id as string;
}
