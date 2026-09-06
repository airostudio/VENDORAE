import "server-only";
import type Stripe from "stripe";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { platformStripe } from "@/lib/platform/stripe";
import { deriveAvailableSlug } from "@/lib/platform/slug";

export type ProvisionResult = { slug: string } | { error: string };

/**
 * Turns a paid platform Stripe Checkout Session into a real tenant. Safe to call more than once
 * for the same session — it is invoked from BOTH the platform webhook (`checkout.session.completed`)
 * AND the buyer's browser landing on /platform/welcome, whichever happens first. Idempotency is
 * enforced by the database, not by any in-memory guard here: `provision_tenant()` (see
 * supabase/schema.sql) uses `tenant_licenses.stripe_checkout_session_id`'s unique constraint as
 * the idempotency key, in a single transaction that creates tenants + tenant_settings +
 * tenant_licenses atomically — so two concurrent calls for the same session can race, but only
 * one ever wins the insert and the other is handed back that winner's tenant, never a duplicate
 * or a half-created tenant. See that function's comments for exactly how the race is resolved.
 */
export async function provisionTenantFromCheckoutSession(sessionId: string): Promise<ProvisionResult> {
  if (!sessionId) return { error: "Missing checkout session id" };

  let session: Stripe.Checkout.Session;
  try {
    session = await platformStripe().checkout.sessions.retrieve(sessionId, {
      expand: ["subscription", "customer"],
    });
  } catch (error) {
    return { error: `Could not retrieve checkout session: ${error instanceof Error ? error.message : error}` };
  }

  // Never provision for an unpaid/incomplete session — an async payment method (e.g. a bank
  // debit) can leave a "completed" session still unpaid for a while.
  if (session.payment_status !== "paid") {
    return { error: `Checkout session is not paid yet (payment_status=${session.payment_status})` };
  }

  const subscription = typeof session.subscription === "string" ? null : session.subscription;
  const subscriptionStatus = subscription?.status;
  if (subscription && !["active", "trialing"].includes(subscriptionStatus ?? "")) {
    return { error: `Subscription is not active (status=${subscriptionStatus})` };
  }

  const slugBase = session.metadata?.slug;
  const storeName = session.metadata?.storeName;
  if (!slugBase || !storeName) {
    return { error: "Checkout session is missing slug/storeName metadata" };
  }

  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
  const status = subscriptionStatus ?? "active";
  const currentPeriodEnd = subscription?.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  const supabase = createServiceRoleSupabaseClient();

  // Re-derive a free slug right before provisioning too (not just at checkout-initiation time in
  // the /api/platform/checkout route) — the DB function re-checks again itself as the final
  // authority, but doing it here as well means an obviously-taken slug doesn't even reach it.
  let candidateSlug: string;
  try {
    const derived = await deriveAvailableSlug(supabase, slugBase);
    candidateSlug = derived ?? slugBase;
  } catch {
    candidateSlug = slugBase;
  }

  const { data, error } = await supabase.rpc("provision_tenant", {
    p_checkout_session_id: session.id,
    p_slug_base: candidateSlug,
    p_store_name: storeName,
    p_stripe_customer_id: customerId,
    p_stripe_subscription_id: subscriptionId,
    p_status: status,
    p_current_period_end: currentPeriodEnd,
  });

  if (error) return { error: `Provisioning failed: ${error.message}` };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.slug) return { error: "Provisioning did not return a tenant" };

  return { slug: row.slug as string };
}

/**
 * Applies a subscription status change to the tenant_licenses row it belongs to (webhook-driven —
 * `customer.subscription.updated`/`customer.subscription.deleted`). A no-op, not an error, if no
 * tenant was ever provisioned for this subscription (e.g. the checkout session never completed).
 */
export async function updateLicenseForSubscription(
  subscriptionId: string,
  status: string,
  currentPeriodEnd: number | null,
): Promise<void> {
  const supabase = createServiceRoleSupabaseClient();
  await supabase
    .from("tenant_licenses")
    .update({
      status,
      current_period_end: currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : null,
    })
    .eq("stripe_subscription_id", subscriptionId);
}
