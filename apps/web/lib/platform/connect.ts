import "server-only";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { platformStripe } from "@/lib/platform/stripe";

export interface ConnectStatus {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

export interface ConnectCheckoutContext {
  stripeAccountId: string;
  commissionBps: number;
}

/**
 * Returns the tenant's connected Stripe Express account id, creating one on first call. This is
 * the account THEIR customers' checkout money settles into directly (a Connect direct charge) —
 * entirely separate from the platform's own Stripe account (apps/web/lib/platform/stripe.ts's
 * `platformStripe()`, used to charge the SaaS license fee) and from a tenant's own pasted keys
 * (apps/web/lib/config/paymentCredentials.ts, the legacy/fallback checkout path).
 *
 * Idempotent by DB row, not by asking Stripe: a tenant already holding a row gets that account id
 * back without a Stripe call at all, so this is cheap to call from a page load.
 */
export async function getOrCreateConnectAccount(tenantId: string): Promise<string> {
  const supabase = createServiceRoleSupabaseClient();

  const { data: existing } = await supabase
    .from("tenant_stripe_accounts")
    .select("stripe_account_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (existing) return existing.stripe_account_id as string;

  const account = await platformStripe().accounts.create({
    type: "express",
    metadata: { tenantId },
  });

  const { error } = await supabase.from("tenant_stripe_accounts").insert({
    tenant_id: tenantId,
    stripe_account_id: account.id,
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
  });
  // A concurrent call could have raced this insert (two admin tabs clicking "Connect" at once) —
  // the unique constraint on tenant_id catches that; re-read rather than fail the whole flow.
  if (error) {
    const { data: winner } = await supabase
      .from("tenant_stripe_accounts")
      .select("stripe_account_id")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (winner) return winner.stripe_account_id as string;
    throw new Error(`Could not record the connected account: ${error.message}`);
  }

  return account.id;
}

/**
 * Stripe-hosted onboarding: Stripe collects and validates KYC/business details itself, so
 * Vendorae never touches that data. `returnUrl`/`refreshUrl` both send the owner back to
 * /admin/payments, which re-syncs status on load (see syncConnectStatus) rather than trusting
 * that the redirect alone means onboarding finished.
 */
export async function createOnboardingLink(tenantId: string, returnUrl: string, refreshUrl: string): Promise<string> {
  const accountId = await getOrCreateConnectAccount(tenantId);
  const link = await platformStripe().accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });
  return link.url;
}

/**
 * Refreshes a tenant's connect status straight from Stripe and writes it back. Exists so the
 * return_url landing page can show up-to-date status immediately instead of waiting on the
 * `account.updated` webhook (see apps/web/app/api/webhooks/platform-stripe/route.ts) to arrive.
 * Returns null if the tenant has never started Connect onboarding at all.
 */
export async function syncConnectStatus(tenantId: string): Promise<ConnectStatus | null> {
  const supabase = createServiceRoleSupabaseClient();

  const { data: row } = await supabase
    .from("tenant_stripe_accounts")
    .select("stripe_account_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!row) return null;

  const account = await platformStripe().accounts.retrieve(row.stripe_account_id as string);
  const status: ConnectStatus = {
    chargesEnabled: Boolean(account.charges_enabled),
    payoutsEnabled: Boolean(account.payouts_enabled),
    detailsSubmitted: Boolean(account.details_submitted),
  };

  await supabase
    .from("tenant_stripe_accounts")
    .update({
      charges_enabled: status.chargesEnabled,
      payouts_enabled: status.payoutsEnabled,
      details_submitted: status.detailsSubmitted,
    })
    .eq("tenant_id", tenantId);

  return status;
}

/**
 * What checkout actually calls. Returns null — meaning "use today's legacy tenant-owns-keys
 * checkout path, unchanged" — unless the tenant has a connected account with charges_enabled.
 * Once it does, returns the account id plus the commission to attach as an application fee.
 *
 * commission_bps defaults to 0, not tenant_licenses' SQL column default of 200, for any tenant
 * with no tenant_licenses row at all (every tenant provisioned before Phase 2, including the
 * original pre-existing default tenant) — that column default only applies to newly-inserted
 * rows, and a legacy tenant must not silently start losing 2% of every sale it never agreed to.
 */
export async function getConnectContextForCheckout(tenantId: string): Promise<ConnectCheckoutContext | null> {
  const supabase = createServiceRoleSupabaseClient();

  const { data: account } = await supabase
    .from("tenant_stripe_accounts")
    .select("stripe_account_id, charges_enabled")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!account || !account.charges_enabled) return null;

  const { data: license } = await supabase
    .from("tenant_licenses")
    .select("commission_bps")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const commissionBps = license ? (license.commission_bps as number) : 0;

  return { stripeAccountId: account.stripe_account_id as string, commissionBps };
}
