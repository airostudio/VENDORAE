import "server-only";
import { createServiceRoleSupabaseClient } from "@trend/db";

export interface Plan {
  id: string;
  slug: string;
  name: string;
  monthlyPriceCents: number;
  stripePriceId: string | null;
  commissionBps: number;
  productLimit: number | null;
  staffLimit: number;
  customDomainAllowed: boolean;
  featureList: string[];
  sortOrder: number;
}

interface PlanRow {
  id: string;
  slug: string;
  name: string;
  monthly_price_cents: number;
  stripe_price_id: string | null;
  commission_bps: number;
  product_limit: number | null;
  staff_limit: number;
  custom_domain_allowed: boolean;
  feature_list: string[] | null;
  sort_order: number;
}

function rowToPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    monthlyPriceCents: row.monthly_price_cents,
    stripePriceId: row.stripe_price_id,
    commissionBps: row.commission_bps,
    productLimit: row.product_limit,
    staffLimit: row.staff_limit,
    customDomainAllowed: row.custom_domain_allowed,
    featureList: row.feature_list ?? [],
    sortOrder: row.sort_order,
  };
}

/**
 * Every active plan, ordered for display (free → elite). Read through the service-role client
 * rather than a public RLS policy — `plans` has none, following the same convention as other
 * public-facing-but-not-tenant-scoped catalog data in this codebase (see
 * apps/web/lib/data/categories.ts) — since only server-rendered pages need this, not the browser.
 */
export async function getActivePlans(): Promise<Plan[]> {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase
    .from("plans")
    .select("id, slug, name, monthly_price_cents, stripe_price_id, commission_bps, product_limit, staff_limit, custom_domain_allowed, feature_list, sort_order")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw new Error(`Could not load plans: ${error.message}`);
  return (data ?? []).map(rowToPlan);
}

/** A single active plan by slug, or null if it doesn't exist (or isn't active). */
export async function getPlanBySlug(slug: string): Promise<Plan | null> {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase
    .from("plans")
    .select("id, slug, name, monthly_price_cents, stripe_price_id, commission_bps, product_limit, staff_limit, custom_domain_allowed, feature_list, sort_order")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(`Could not load plan "${slug}": ${error.message}`);
  return data ? rowToPlan(data as PlanRow) : null;
}
