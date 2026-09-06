import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fulfillOrder, type EngineAddress } from "@/lib/dropshipEngine";

export interface PlaceOrderOutcome {
  ok: boolean;
  skipped?: boolean;
  aliexpressOrderId?: string | null;
  error?: string;
}

/**
 * Places the AliExpress dropshipping order for a paid local order, via the dropship-engine.
 * Idempotency is the engine's job (an atomic claim on its own orders table, keyed by this store's
 * order id) — this just forwards the request and mirrors the result into Beach Footprints' own
 * `orders` row. Shared by the admin manual-trigger route and the auto-place-on-payment webhook path
 * so there is exactly one implementation of "what it means to place this order".
 */
export async function placeAliExpressOrder(supabase: SupabaseClient, orderId: string): Promise<PlaceOrderOutcome> {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, tenant_id, shipping_address")
    .eq("id", orderId)
    .single();
  if (orderError || !order) return { ok: false, error: "Order not found" };
  if (!order.shipping_address) return { ok: false, error: "Order has no shipping_address on file" };

  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select("quantity, variant_id, product_variants!inner(supplier)")
    .eq("order_id", orderId);
  if (itemsError) return { ok: false, error: itemsError.message };

  // Supabase types a `!inner` join as an array even though it's a one-to-one relationship here.
  const dropshipItems = ((items ?? []) as unknown as Array<{ quantity: number; variant_id: string; product_variants: { supplier: string | null }[] }>).filter(
    (item) => item.product_variants?.[0]?.supplier === "dropship-engine",
  );
  if (dropshipItems.length === 0) {
    // Not an error: an order can be entirely non-dropshipped products, and there is nothing to place.
    return { ok: true, skipped: true };
  }

  // AliExpress requires a phone number on the shipping address; checkout's phone field is
  // optional, so this can legitimately be missing. Fail closed with a clear reason rather than
  // sending the engine a request it will itself reject less legibly.
  const address = order.shipping_address as EngineAddress;
  if (!address.phone) {
    return { ok: false, error: "Order has no phone number on file — AliExpress requires one to place the order" };
  }

  try {
    const result = await fulfillOrder({
      externalOrderId: order.id as string,
      shippingAddress: address,
      lineItems: dropshipItems.map((item) => ({ externalVariantId: item.variant_id, quantity: item.quantity })),
    });

    await supabase
      .from("orders")
      .update({
        aliexpress_order_id: result.aliexpressOrderId,
        fulfillment_status: result.fulfillmentStatus ?? "fulfillment_in_progress",
        fulfilled_at: result.skipped ? undefined : new Date().toISOString(),
        status: result.aliexpressOrderId ? "FULFILLING" : undefined,
      })
      .eq("id", orderId);

    await supabase.from("fulfillment_logs").insert({
      tenant_id: order.tenant_id,
      order_id: orderId,
      event: result.skipped ? "order_place_skipped" : "order_placed",
      supplier_order_id: result.aliexpressOrderId,
    });

    return { ok: true, skipped: result.skipped, aliexpressOrderId: result.aliexpressOrderId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "AliExpress order placement failed";
    // Logged so a stuck PAID order is traceable from the runtime logs — the webhook path in
    // particular never surfaces this to a human synchronously, since there is no request/response
    // round-trip with the customer at this point.
    await supabase.from("fulfillment_logs").insert({
      tenant_id: order.tenant_id,
      order_id: orderId,
      event: "order_place_failed",
      detail: { error: message },
    });
    return { ok: false, error: message };
  }
}
