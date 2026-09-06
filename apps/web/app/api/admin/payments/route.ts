import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";
import { getSettings } from "@/lib/dropshipEngine";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

/** "sk_live_…"/"pk_live_…" vs "sk_test_…" — the only part of a key that's safe to report. */
function keyMode(key: string | undefined): "live" | "test" | null {
  if (!key) return null;
  if (key.includes("_live_")) return "live";
  if (key.includes("_test_")) return "test";
  return null;
}

/**
 * Reports how payments are configured, without ever returning a key.
 *
 * Stripe credentials are read from environment variables rather than stored in the database:
 * a secret key in a table is one SQL injection or careless query away from being leaked, and
 * rotating it should be a deploy setting, not a row edit. So this endpoint answers "is it set
 * up, and in which mode" — the questions an admin screen actually needs.
 */
export async function GET() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

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

  const secretMode = keyMode(secretKey);
  const publishableMode = keyMode(publishableKey);

  return NextResponse.json({
    stripe: {
      secretKeyConfigured: Boolean(secretKey),
      publishableKeyConfigured: Boolean(publishableKey),
      webhookSecretConfigured: Boolean(webhookSecret),
      mode: secretMode,
      // A live secret key paired with a test publishable key (or vice versa) fails at
      // checkout in a way that's tedious to diagnose from the error alone.
      modeMismatch: Boolean(secretMode && publishableMode && secretMode !== publishableMode),
    },
    sellingCurrency,
    storeCurrency,
    // Checkout is wired to Stripe (see /api/checkout/session and /api/webhooks/stripe); whether it
    // can actually take money now depends only on the credentials above.
    checkoutImplemented: true,
  });
}
