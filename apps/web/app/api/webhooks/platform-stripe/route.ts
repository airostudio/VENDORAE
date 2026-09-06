import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { platformStripe } from "@/lib/platform/stripe";
import { provisionTenantFromCheckoutSession, updateLicenseForSubscription } from "@/lib/platform/provisionTenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The PLATFORM's own Stripe webhook — for license/subscription lifecycle events on Vendorae's own
 * Stripe account. Distinct from apps/web/app/api/webhooks/stripe/route.ts, which handles a
 * TENANT's own Stripe account events for their customers' orders.
 *
 * Same verify-raw-body-before-parsing shape as that route: the signature is checked against
 * PLATFORM_STRIPE_WEBHOOK_SECRET before anything is read, so a forged request can't provision a
 * tenant or alter a license's status.
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
        const result = await provisionTenantFromCheckoutSession(session.id);
        if ("error" in result) {
          console.error(`[webhooks/platform-stripe] provisioning session ${session.id} failed: ${result.error}`);
        } else {
          console.log(`[webhooks/platform-stripe] provisioned tenant "${result.slug}" for session ${session.id}`);
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
