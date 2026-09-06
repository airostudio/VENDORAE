import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { platformStripe } from "@/lib/platform/stripe";
import { provisionTenantFromCheckoutSession, updateLicenseForSubscription } from "@/lib/platform/provisionTenant";
import { markOrderPaid } from "@/lib/checkout/markOrderPaid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The PLATFORM's own Stripe webhook — for license/subscription lifecycle events on Vendorae's own
 * Stripe account, AND (since Stripe Connect) for events on every tenant's connected Express
 * account, via Stripe's "Listen to events on Connected accounts" endpoint option. One endpoint,
 * one signing secret (PLATFORM_STRIPE_WEBHOOK_SECRET) verifies both — Stripe sets `event.account`
 * to the connected account's id for a Connect-sourced event, and leaves it unset for the
 * platform's own events, which is how every case below disambiguates.
 *
 * Distinct from apps/web/app/api/webhooks/stripe/route.ts, which is a TENANT's own (non-Connect,
 * pasted-key) Stripe account webhook for their customers' orders — the legacy/fallback checkout
 * path that stays wired up alongside this one.
 *
 * Same verify-raw-body-before-parsing shape as that route: the signature is checked against
 * PLATFORM_STRIPE_WEBHOOK_SECRET before anything is read, so a forged request can't provision a
 * tenant, alter a license's status, or mark an order paid.
 */
export async function POST(request: Request) {
  const secret = process.env.PLATFORM_STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhooks/platform-stripe] PLATFORM_STRIPE_WEBHOOK_SECRET is not set — refusing to process events");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    const rawBody = await request.text();
    event = platformStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (error) {
    console.error(`[webhooks/platform-stripe] signature verification failed: ${error instanceof Error ? error.message : error}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        if (event.account) {
          // A Connect-sourced event: this is a tenant's own customer completing a direct-charge
          // order on their connected account, NOT a platform license purchase (which never
          // carries event.account). `paid` is the real signal — a completed session can still be
          // unpaid for async payment methods — matching the same guard in
          // apps/web/app/api/webhooks/stripe/route.ts for the legacy path.
          if (session.payment_status !== "paid") {
            console.log(`[webhooks/platform-stripe] connect session ${session.id} (account ${event.account}) completed but payment_status=${session.payment_status}`);
            break;
          }
          await markOrderPaid(createServiceRoleSupabaseClient(), session);
          break;
        }

        // No event.account: the platform's own checkout session — a license purchase.
        const result = await provisionTenantFromCheckoutSession(session.id);
        if ("error" in result) {
          console.error(`[webhooks/platform-stripe] provisioning session ${session.id} failed: ${result.error}`);
        } else {
          console.log(`[webhooks/platform-stripe] provisioned tenant "${result.slug}" for session ${session.id}`);
        }
        break;
      }

      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        const supabase = createServiceRoleSupabaseClient();
        const { data: updated, error } = await supabase
          .from("tenant_stripe_accounts")
          .update({
            charges_enabled: Boolean(account.charges_enabled),
            payouts_enabled: Boolean(account.payouts_enabled),
            details_submitted: Boolean(account.details_submitted),
          })
          .eq("stripe_account_id", account.id)
          .select("tenant_id");
        if (error) {
          console.error(`[webhooks/platform-stripe] updating connect status for account ${account.id} failed: ${error.message}`);
        } else if (!updated || updated.length === 0) {
          // No matching row — e.g. an account created directly in the Stripe dashboard, or a
          // stale/test event. Not an error: nothing to reconcile.
          console.log(`[webhooks/platform-stripe] account.updated for unknown account ${account.id} — no tenant_stripe_accounts row`);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await updateLicenseForSubscription(subscription.id, subscription.status, subscription.current_period_end);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await updateLicenseForSubscription(subscription.id, "canceled", subscription.current_period_end);
        break;
      }

      default:
        break;
    }
  } catch (error) {
    console.error(`[webhooks/platform-stripe] handling ${event.type} failed: ${error instanceof Error ? error.message : error}`);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
