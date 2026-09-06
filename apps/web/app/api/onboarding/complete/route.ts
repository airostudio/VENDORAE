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
  // The store owner's login — a new tenant gets a real admin account from day one, no
  // shared-password break-glass bootstrap needed (see apps/web/middleware.ts and
  // /admin/create-account, which exist only to bridge tenants that predate this).
  ownerEmail: z.string().trim().email("Enter a valid email"),
  ownerPassword: z.string().min(8, "Password must be at least 8 characters"),
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
 * Saves everything collected by the setup wizard, creates the owner's login (Supabase Auth user +
 * `memberships` row, role OWNER), and marks onboarding complete — using the service-role client,
 * since the new owner has no membership row (and therefore no RLS access) until this request
 * creates one.
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

    // These routes are deliberately reachable without admin auth (the wizard runs before the
    // owner has any way to sign in), so once a store has finished onboarding this must refuse to
    // touch it — otherwise anyone who finds the URL could silently overwrite a live store's brand
    // or payment credentials. Further changes go through the authenticated /admin/payments screen.
    const { data: existing, error: existingError } = await supabase
      .from("tenant_settings")
      .select("onboarding_completed")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing?.onboarding_completed) {
      return NextResponse.json(
        { error: "Onboarding is already complete. Manage store settings from /admin/payments instead." },
        { status: 403 },
      );
    }

    // Create the owner's login before saving anything else — if this fails, nothing else about
    // this tenant should be marked done either, since there'd be no way for anyone to sign in.
    const { data: existingMemberships, error: membershipsError } = await supabase
      .from("memberships")
      .select("id")
      .eq("tenant_id", tenantId)
      .limit(1);
    if (membershipsError) throw new Error(membershipsError.message);
    if (!existingMemberships || existingMemberships.length === 0) {
      const { data: created, error: createUserError } = await supabase.auth.admin.createUser({
        email: input.ownerEmail,
        password: input.ownerPassword,
        email_confirm: true,
      });
      if (createUserError || !created?.user) throw new Error(createUserError?.message || "Could not create your admin account");

      const { error: membershipError } = await supabase
        .from("memberships")
        .insert({ tenant_id: tenantId, user_id: created.user.id, role: "OWNER" });
      if (membershipError) throw new Error(membershipError.message);
    }

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
