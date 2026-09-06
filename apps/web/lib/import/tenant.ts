import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { getDefaultTenantSlug, resolveHostTenant } from "@/lib/tenant/host";

const DEFAULT_TENANT_SLUG = getDefaultTenantSlug();

/**
 * The tenant slug for the current request, from its `Host` header — `<slug>.<PLATFORM_ROOT_DOMAIN>`
 * resolves to `<slug>`; anything else (localhost, a Vercel preview URL, the bare platform root
 * domain) falls back to `DEFAULT_TENANT_SLUG`, same as before this module understood hostnames at
 * all. `headers()` throws outside a request context (e.g. a build step or a script) — fall back
 * there too rather than blow up call sites that aren't always invoked from one.
 */
function slugFromRequestHost(): string {
  try {
    return resolveHostTenant(headers().get("host")).slug;
  } catch {
    return DEFAULT_TENANT_SLUG;
  }
}

/**
 * Resolve a tenant id. With no slug/id given, resolves from the current request's `Host` header
 * (see `apps/web/lib/tenant/host.ts`) — every existing call site that used to always get the
 * single demo tenant now transparently gets whichever tenant's subdomain the request came in on.
 */
export async function resolveTenantId(supabase: SupabaseClient, tenantIdOrSlug?: string): Promise<string> {
  if (tenantIdOrSlug && /^[0-9a-f-]{36}$/i.test(tenantIdOrSlug)) return tenantIdOrSlug;

  const slug = tenantIdOrSlug || slugFromRequestHost();
  const { data, error } = await supabase.from("tenants").select("id").eq("slug", slug).single();

  if (error || !data) throw new Error(`Could not resolve tenant "${slug}"`);
  return data.id as string;
}
