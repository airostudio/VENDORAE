import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";
import { syncConnectStatus } from "@/lib/platform/connect";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint — see apps/web/app/api/admin/payments/route.ts for
// why a statically-optimised route here would go stale/break on every method but GET.
export const dynamic = "force-dynamic";

/**
 * Reports the current tenant's Stripe Connect status, always freshly synced from Stripe (not a
 * stale DB read) — so the /admin/payments screen is accurate the moment the owner lands back on
 * it from Stripe's hosted onboarding, without waiting on the account.updated webhook to arrive.
 * `connected: false` means onboarding was never started at all.
 */
export async function GET() {
  const supabase = createServiceRoleSupabaseClient();

  try {
    const tenantId = await resolveTenantId(supabase);
    const status = await syncConnectStatus(tenantId);
    if (!status) return NextResponse.json({ connected: false });
    return NextResponse.json({ connected: true, ...status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Stripe Connect status";
    console.error(`[admin/stripe-connect/status] ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
