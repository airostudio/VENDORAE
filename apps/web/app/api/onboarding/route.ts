import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Current onboarding state for the /onboarding wizard to pre-fill and resume from — never returns
 * the raw Stripe/PayPal secrets themselves (only whether each is set), the same "configured, not
 * the value" convention as /api/admin/payments.
 */
export async function GET() {
  const supabase = createServiceRoleSupabaseClient();
  try {
    const tenantId = await resolveTenantId(supabase);
    const { data, error } = await supabase
      .from("tenant_settings")
      .select(
        "brand_name, business_description, product_niche, logo_url, onboarding_completed, stripe_secret_key, stripe_publishable_key, stripe_webhook_secret, paypal_client_id, paypal_client_secret, paypal_mode",
      )
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    return NextResponse.json({
      tenantId,
      onboardingCompleted: Boolean(data?.onboarding_completed),
      businessName: (data?.brand_name as string | undefined) ?? "",
      businessDescription: (data?.business_description as string | undefined) ?? "",
      productNiche: (data?.product_niche as string | undefined) ?? "",
      logoUrl: (data?.logo_url as string | undefined) ?? null,
      stripe: {
        secretKeyConfigured: Boolean(data?.stripe_secret_key),
        publishableKeyConfigured: Boolean(data?.stripe_publishable_key),
        webhookSecretConfigured: Boolean(data?.stripe_webhook_secret),
      },
      paypal: {
        clientIdConfigured: Boolean(data?.paypal_client_id),
        clientSecretConfigured: Boolean(data?.paypal_client_secret),
        mode: (data?.paypal_mode as string | undefined) ?? "sandbox",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load onboarding state" }, { status: 500 });
  }
}
