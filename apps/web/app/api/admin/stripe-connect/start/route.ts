import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";
import { createOnboardingLink } from "@/lib/platform/connect";
import { siteUrl } from "@/lib/checkout/stripe";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint — see apps/web/app/api/admin/payments/route.ts for
// why a statically-optimised route here would go stale/break on every method but GET.
export const dynamic = "force-dynamic";

/**
 * Starts Stripe's hosted Connect onboarding for the current tenant, returning the URL for the
 * browser to redirect to. This route is already behind /api/admin — middleware.ts's `adminAuth`
 * has verified the caller is a real member of this tenant before this ever runs, so there is
 * nothing further to check here beyond resolving which tenant that is.
 */
export async function POST(request: Request) {
  const supabase = createServiceRoleSupabaseClient();

  try {
    const tenantId = await resolveTenantId(supabase);
    const base = siteUrl(request);
    // `?connect=return` distinguishes a bounce back from Stripe onboarding from an ordinary visit
    // to the page, so the client can immediately re-sync status instead of waiting on the webhook.
    const url = await createOnboardingLink(tenantId, `${base}/admin/payments?connect=return`, `${base}/admin/payments?connect=refresh`);
    return NextResponse.json({ url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start Stripe Connect onboarding";
    console.error(`[admin/stripe-connect/start] ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
