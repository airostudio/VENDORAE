import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { stripe } from "@/lib/checkout/stripe";
import { getStripeCredentials } from "@/lib/config/paymentCredentials";
import { markOrderPaid } from "@/lib/checkout/markOrderPaid";

export const runtime = "nodejs";

/**
 * Stripe's payment callbacks — the only place an order is ever marked paid.
 *
 * The signature is verified against STRIPE_WEBHOOK_SECRET before anything is read, so a forged
 * request can't mark an unpaid order as paid. That means reading the RAW body: any JSON parsing
 * first would change the bytes the signature covers and every event would be rejected.
 */
export async function POST(request: Request) {
  const { webhookSecret: secret } = await getStripeCredentials();
  if (!secret) {
    console.error("[webhooks/stripe] STRIPE_WEBHOOK_SECRET is not set — refusing to process events");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    const rawBody = await request.text();
    event = (await stripe()).webhooks.constructEvent(rawBody, signature, secret);
  } catch (error) {
    // An invalid signature is the expected shape of an attack, so it is a 400, not a 500.
    console.error(`[webhooks/stripe] signature verification failed: ${error instanceof Error ? error.message : error}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = createServiceRoleSupabaseClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        // `paid` is the real signal; a completed session can still be unpaid for async methods.
        if (session.payment_status !== "paid") {
          console.log(`[webhooks/stripe] session ${session.id} completed but payment_status=${session.payment_status}`);
          break;
        }
        await markOrderPaid(supabase, session);
        break;
      }

      case "checkout.session.async_payment_succeeded": {
        await markOrderPaid(supabase, event.data.object as Stripe.Checkout.Session);
        break;
      }

      case "checkout.session.expired":
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.orderId;
        if (orderId) {
          await supabase.from("payments").update({ status: "FAILED" }).eq("provider", "stripe").eq("provider_ref", session.id);
          // The order is left as-is rather than deleted: an abandoned checkout is a real record,
          // and the customer may retry.
          console.log(`[webhooks/stripe] order ${orderId} not paid (${event.type})`);
        }
        break;
      }

      default:
        // Everything else is acknowledged so Stripe stops retrying it.
        break;
    }
  } catch (error) {
    // A 500 makes Stripe retry, which is what we want for a transient database failure.
    console.error(`[webhooks/stripe] handling ${event.type} failed: ${error instanceof Error ? error.message : error}`);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
