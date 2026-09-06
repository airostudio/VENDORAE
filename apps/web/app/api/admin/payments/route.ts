import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";
import { getSettings } from "@/lib/dropshipEngine";
import { getPayPalCredentials, getStripeCredentials } from "@/lib/config/paymentCredentials";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

/** "sk_live_…"/"pk_live_…" vs "sk_test_…" — the only part of a key that's safe to report. */
function keyMode(key: string | undefined | null): "live" | "test" | null {
  if (!key) return null;
  if (key.includes("_live_")) return "live";
  if (key.includes("_test_")) return "test";
  return null;
}

/**
 * Reports how payments are configured, without ever returning a key.
 *
 * Credentials come from getStripeCredentials()/getPayPalCredentials() — this deployment's own env
 * vars if set, otherwise whatever the /onboarding wizard saved for the tenant — so this screen
 * reflects what checkout will actually use either way, along with which source each field came
 * from ("env" vs "database"), the questions an admin screen actually needs.
 */
export async function GET() {
  const [stripeCreds, paypalCreds] = await Promise.all([getStripeCredentials(), getPayPalCredentials()]);

  let sellingCurrency: string | null = null;
  try {
    const { settings } = await getSettings();
    sellingCurrency = settings.import.targetCurrency ?? null;
  } catch {
    // The engine being unreachable shouldn't blank the whole payments screen.
  }

  let storeCurrency: string | null = null;
  try {
    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase);
    const { data } = await supabase.from("product_variants").select("currency").limit(1).maybeSingle();
    storeCurrency = (data?.currency as string | undefined) ?? null;
    void tenantId;
  } catch {
    // Same — best-effort context, not the point of the endpoint.
  }

  const secretMode = keyMode(stripeCreds.secretKey);
  const publishableMode = keyMode(stripeCreds.publishableKey);

  return NextResponse.json({
    stripe: {
      secretKeyConfigured: Boolean(stripeCreds.secretKey),
      publishableKeyConfigured: Boolean(stripeCreds.publishableKey),
      webhookSecretConfigured: Boolean(stripeCreds.webhookSecret),
      secretKeySource: stripeCreds.secretKeySource,
      publishableKeySource: stripeCreds.publishableKeySource,
      webhookSecretSource: stripeCreds.webhookSecretSource,
      mode: secretMode,
      // A live secret key paired with a test publishable key (or vice versa) fails at
      // checkout in a way that's tedious to diagnose from the error alone.
      modeMismatch: Boolean(secretMode && publishableMode && secretMode !== publishableMode),
    },
    paypal: {
      clientIdConfigured: Boolean(paypalCreds.clientId),
      clientSecretConfigured: Boolean(paypalCreds.clientSecret),
      clientIdSource: paypalCreds.clientIdSource,
      clientSecretSource: paypalCreds.clientSecretSource,
      mode: paypalCreds.mode,
    },
    sellingCurrency,
    storeCurrency,
    // Checkout is wired to Stripe (see /api/checkout/session and /api/webhooks/stripe); whether it
    // can actually take money now depends only on the credentials above. PayPal credentials can be
    // saved and are reported here, but checkout does not yet offer PayPal as a payment method —
    // see packages/core/src/providers/adapters/paypal-payment.ts.
    checkoutImplemented: true,
  });
}
