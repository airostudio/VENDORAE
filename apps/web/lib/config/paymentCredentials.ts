import "server-only";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";

export interface StripeCredentials {
  secretKey: string | null;
  publishableKey: string | null;
  webhookSecret: string | null;
  /** Where each configured field ultimately came from, for the admin status screen. */
  secretKeySource: "env" | "database" | null;
  publishableKeySource: "env" | "database" | null;
  webhookSecretSource: "env" | "database" | null;
}

export interface PayPalCredentials {
  clientId: string | null;
  clientSecret: string | null;
  mode: "sandbox" | "live";
  clientIdSource: "env" | "database" | null;
  clientSecretSource: "env" | "database" | null;
}

interface TenantSettingsPaymentRow {
  stripe_secret_key: string | null;
  stripe_publishable_key: string | null;
  stripe_webhook_secret: string | null;
  paypal_client_id: string | null;
  paypal_client_secret: string | null;
  paypal_mode: string | null;
}

/**
 * Reads the tenant's wizard-saved payment credentials, if any. Returns null fields (rather than
 * throwing) when the database is unreachable or nothing has been saved yet — callers fall back to
 * env vars either way.
 */
async function readTenantSettingsRow(): Promise<TenantSettingsPaymentRow | null> {
  try {
    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase);
    const { data } = await supabase
      .from("tenant_settings")
      .select("stripe_secret_key, stripe_publishable_key, stripe_webhook_secret, paypal_client_id, paypal_client_secret, paypal_mode")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    return (data as TenantSettingsPaymentRow | null) ?? null;
  } catch (error) {
    console.error(`[paymentCredentials] could not read tenant_settings: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * Resolves the Stripe credentials this deployment should actually use.
 *
 * Environment variables always win when set — that is the intentional design for an operator who
 * controls the deployment (see the comment on stripe() below): a secret key belongs in a deploy
 * setting, not a database row, and rotating it shouldn't require a DB write. The tenant_settings
 * columns are a fallback for a self-serve owner using the /onboarding wizard, who has no access to
 * this deployment's environment variables at all.
 */
export async function getStripeCredentials(): Promise<StripeCredentials> {
  const envSecret = process.env.STRIPE_SECRET_KEY || null;
  const envPublishable = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || null;
  const envWebhook = process.env.STRIPE_WEBHOOK_SECRET || null;

  const row = envSecret && envPublishable && envWebhook ? null : await readTenantSettingsRow();

  const secretKey = envSecret || row?.stripe_secret_key || null;
  const publishableKey = envPublishable || row?.stripe_publishable_key || null;
  const webhookSecret = envWebhook || row?.stripe_webhook_secret || null;

  return {
    secretKey,
    publishableKey,
    webhookSecret,
    secretKeySource: envSecret ? "env" : secretKey ? "database" : null,
    publishableKeySource: envPublishable ? "env" : publishableKey ? "database" : null,
    webhookSecretSource: envWebhook ? "env" : webhookSecret ? "database" : null,
  };
}

/** Same env-first, tenant_settings-fallback resolution as Stripe, for PayPal. */
export async function getPayPalCredentials(): Promise<PayPalCredentials> {
  const envClientId = process.env.PAYPAL_CLIENT_ID || null;
  const envClientSecret = process.env.PAYPAL_CLIENT_SECRET || null;
  const envMode = process.env.PAYPAL_MODE === "live" ? "live" : process.env.PAYPAL_MODE === "sandbox" ? "sandbox" : null;

  const row = envClientId && envClientSecret ? null : await readTenantSettingsRow();

  const clientId = envClientId || row?.paypal_client_id || null;
  const clientSecret = envClientSecret || row?.paypal_client_secret || null;
  const mode: "sandbox" | "live" = envMode ?? (row?.paypal_mode === "live" ? "live" : "sandbox");

  return {
    clientId,
    clientSecret,
    mode,
    clientIdSource: envClientId ? "env" : clientId ? "database" : null,
    clientSecretSource: envClientSecret ? "env" : clientSecret ? "database" : null,
  };
}
