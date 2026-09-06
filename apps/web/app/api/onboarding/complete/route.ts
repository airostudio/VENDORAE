import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required").max(200),
  businessDescription: z.string().trim().max(2000).optional(),
  productNiche: z.string().trim().max(500).optional(),
  // Stripe/PayPal fields are all optional so an owner can finish the wizard and configure
  // payments later from /admin/payments — a store with no catalogue yet doesn't need working
  // checkout on day one, and the onboarding gate should not become a second point of failure.
  stripeSecretKey: z.string().trim().max(500).optional(),
  stripePublishableKey: z.string().trim().max(500).optional(),
  stripeWebhookSecret: z.string().trim().max(500).optional(),
  paypalClientId: z.string().trim().max(500).optional(),
  paypalClientSecret: z.string().trim().max(500).optional(),
  paypalMode: z.enum(["sandbox", "live"]).optional(),
});

/**
 * Saves everything collected by the setup wizard and marks onboarding complete, using the
 * service-role client — the new owner has no membership row (and therefore no RLS access) until
 * after this request, since memberships/auth are unrelated to this wizard.
 *
 * A blank credential field is left untouched (not cleared) so filling in the wizard across
 * multiple visits, or completing only some of it, never wipes out a value entered earlier.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;

  const supabase = createServiceRoleSupabaseClient();
  try {
    const tenantId = await resolveTenantId(supabase);

    const update: Record<string, unknown> = {
      brand_name: input.businessName,
      business_description: input.businessDescription || null,
      product_niche: input.productNiche || null,
      onboarding_completed: true,
    };
    if (input.stripeSecretKey) update.stripe_secret_key = input.stripeSecretKey;
    if (input.stripePublishableKey) update.stripe_publishable_key = input.stripePublishableKey;
    if (input.stripeWebhookSecret) update.stripe_webhook_secret = input.stripeWebhookSecret;
    if (input.paypalClientId) update.paypal_client_id = input.paypalClientId;
    if (input.paypalClientSecret) update.paypal_client_secret = input.paypalClientSecret;
    if (input.paypalMode) update.paypal_mode = input.paypalMode;

    const { error } = await supabase.from("tenant_settings").update(update).eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save onboarding" }, { status: 500 });
  }
}
