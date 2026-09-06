import "server-only";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";

export interface TenantBranding {
  tenantId: string;
  brandName: string;
  logoUrl: string | null;
  onboardingCompleted: boolean;
}

const FALLBACK_BRAND_NAME = "Your Store";

/**
 * Reads the current tenant's public branding (name + logo) plus whether the setup wizard has
 * been completed. Used by the header, footer, admin shell and page metadata so none of them
 * hardcode a business name — a store that hasn't been through /onboarding yet renders the
 * generic fallback rather than a prior demo brand.
 *
 * Never throws: every caller here is layout-level chrome that renders on every page, so a
 * database hiccup should degrade to the generic fallback rather than take the whole site down.
 */
export async function getTenantBranding(): Promise<TenantBranding> {
  try {
    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase);
    const { data } = await supabase
      .from("tenant_settings")
      .select("brand_name, logo_url, onboarding_completed")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    return {
      tenantId,
      brandName: (data?.brand_name as string | undefined)?.trim() || FALLBACK_BRAND_NAME,
      logoUrl: (data?.logo_url as string | null | undefined) ?? null,
      onboardingCompleted: Boolean(data?.onboarding_completed),
    };
  } catch (error) {
    console.error(`[tenantSettings] could not load branding: ${error instanceof Error ? error.message : error}`);
    return { tenantId: "", brandName: FALLBACK_BRAND_NAME, logoUrl: null, onboardingCompleted: false };
  }
}
