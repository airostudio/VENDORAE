import "server-only";
import type Stripe from "stripe";
import type { createServiceRoleSupabaseClient } from "@trend/db";
import { placeAliExpressOrder } from "@/lib/fulfillment/placeAliExpressOrder";
import { getEmailProvider } from "@/lib/email/getEmailProvider";

/**
 * Marks the order paid and draws down stock. Safe to run concurrently or twice: Stripe retries
 * events, `checkout.session.completed` and `async_payment_succeeded` can both arrive for one
 * order, and (since Stripe Connect) the SAME session can be delivered on both the tenant's own
 * webhook and the platform's Connect-events webhook depending on how an operator has configured
 * their endpoints — the conditional update below only lets one delivery actually claim the order,
 * and every other delivery (whether it arrives before or after, from either endpoint) returns
 * without touching stock or payments.
 *
 * This is the ONLY place an order is ever marked paid — called from both
 * apps/web/app/api/webhooks/stripe/route.ts (a tenant's own Stripe account, the legacy/fallback
 * checkout path) and apps/web/app/api/webhooks/platform-stripe/route.ts's Connect-charge branch
 * (a tenant's connected account). Do not reimplement this logic a second time anywhere — the
 * compare-and-swap idempotency here is exactly the kind of thing that causes real financial bugs
 * if two copies of it ever drift apart.
 */
export async function markOrderPaid(
  supabase: ReturnType<typeof createServiceRoleSupabaseClient>,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const orderId = session.metadata?.orderId;
  if (!orderId) {
    console.error(`[markOrderPaid] session ${session.id} has no orderId in metadata`);
    return;
  }

  const { data: order } = await supabase.from("orders").select("id, tenant_id, status, total").eq("id", orderId).maybeSingle();
  if (!order) {
    console.error(`[markOrderPaid] order ${orderId} not found for session ${session.id}`);
    return;
  }
  if (order.status !== "PENDING_PAYMENT") {
    console.log(`[markOrderPaid] order ${orderId} already ${order.status} — ignoring duplicate event`);
    return;
  }

  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;

  // The read above is not a lock: multiple deliveries can both pass it before either writes. The
  // `.eq("status", "PENDING_PAYMENT")` guard means only the delivery that still finds the row
  // PENDING actually updates it — without this check, two deliveries would both fall through and
  // double-decrement stock below.
  const { data: claimed, error: orderError } = await supabase
    .from("orders")
    .update({ status: "PAID" })
    .eq("id", orderId)
    .eq("status", "PENDING_PAYMENT")
    .select("id");
  if (orderError) throw new Error(`Could not mark order ${orderId} paid: ${orderError.message}`);
  if (!claimed || claimed.length === 0) {
    console.log(`[markOrderPaid] order ${orderId} was claimed by a concurrent delivery — skipping`);
    return;
  }

  await supabase
    .from("payments")
    .update({ status: "SUCCEEDED", provider_ref: paymentIntentId ?? session.id, amount: session.amount_total ?? order.total })
    .eq("provider", "stripe")
    .eq("provider_ref", session.id);

  // Draw down stock for what was actually bought. Read-then-write rather than an atomic
  // decrement because PostgREST has no expression update; oversell risk is bounded by the
  // availability check at session creation and by AliExpress being the real stock authority.
  //
  // That check ran when the Stripe session was created, not now — a slow checkout (or two
  // customers racing for the last unit) can still leave less stock than this order needs by the
  // time payment actually clears. The payment has already succeeded at this point, so this never
  // blocks or reverses the order; it clamps the ledger at zero as before and logs a
  // stock_shortfall entry so it's visible in Orders instead of silently going negative-in-spirit.
  const { data: items } = await supabase.from("order_items").select("variant_id, quantity, title").eq("order_id", orderId);
  for (const item of ((items ?? []) as { variant_id: string; quantity: number; title: string }[])) {
    const { data: inventory } = await supabase
      .from("inventory_items")
      .select("stock_on_hand")
      .eq("variant_id", item.variant_id)
      .maybeSingle();
    if (!inventory) continue;
    const available = inventory.stock_on_hand as number;
    const remaining = Math.max(0, available - item.quantity);
    await supabase.from("inventory_items").update({ stock_on_hand: remaining }).eq("variant_id", item.variant_id);

    if (available < item.quantity) {
      await supabase.from("fulfillment_logs").insert({
        tenant_id: order.tenant_id,
        order_id: orderId,
        variant_id: item.variant_id,
        event: "stock_shortfall",
        detail: { title: item.title, requested: item.quantity, availableAtPayment: available },
      });
      console.warn(`[markOrderPaid] order ${orderId}: paid for ${item.quantity} × ${item.title}, only ${available} in stock`);
    }
  }

  console.log(`[markOrderPaid] order ${orderId} PAID (${session.amount_total} ${session.currency}) intent=${paymentIntentId}`);

  await sendOrderConfirmation(session, orderId, order.total, session.currency ?? "usd", (items ?? []) as { quantity: number; title: string }[]);

  // Auto-place with the supplier immediately on payment — no human review gate. A failure here
  // is caught and logged to fulfillment_logs by placeAliExpressOrder itself rather than thrown,
  // so it never turns a successful payment into a 500 that makes Stripe retry the whole handler
  // (which would re-run the payment/stock updates above against an already-PAID order).
  const placement = await placeAliExpressOrder(supabase, orderId);
  if (!placement.ok) {
    console.error(`[markOrderPaid] order ${orderId} PAID but AliExpress placement failed: ${placement.error}`);
  }
}

/**
 * Fire-and-forget-ish: a failed confirmation email must never fail the webhook, since the
 * payment itself already succeeded and Stripe should not retry the handler over an email issue.
 */
async function sendOrderConfirmation(
  session: Stripe.Checkout.Session,
  orderId: string,
  total: number,
  currency: string,
  items: { quantity: number; title: string }[],
): Promise<void> {
  const to = session.customer_details?.email;
  if (!to) {
    console.log(`[markOrderPaid] order ${orderId} has no customer email on the Stripe session — skipping confirmation email`);
    return;
  }
  try {
    await getEmailProvider().sendTransactionalEmail({
      to,
      templateKey: "order-confirmation",
      data: {
        orderId,
        total: `${(total / 100).toFixed(2)} ${currency.toUpperCase()}`,
        items: items.map((item) => ({ name: item.title, quantity: item.quantity })),
      },
    });
  } catch (error) {
    console.error(`[markOrderPaid] order ${orderId} PAID but confirmation email failed: ${error instanceof Error ? error.message : error}`);
  }
}
