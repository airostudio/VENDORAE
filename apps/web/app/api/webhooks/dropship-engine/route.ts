import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@trend/db";

export const runtime = "nodejs";

type Db = ReturnType<typeof createServiceRoleSupabaseClient>;

interface WebhookEnvelope {
  event: string;
  data: Record<string, unknown>;
  sentAt: string;
}

function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.DROPSHIP_ENGINE_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function logEvent(supabase: Db, params: { event: string; variantId?: string; orderId?: string; detail?: unknown }): Promise<void> {
  let tenantId: string | undefined;
  if (params.orderId) {
    tenantId = (await supabase.from("orders").select("tenant_id").eq("id", params.orderId).single()).data?.tenant_id;
  } else if (params.variantId) {
    const { data } = await supabase.from("product_variants").select("products(tenant_id)").eq("id", params.variantId).single();
    tenantId = (data as any)?.products?.tenant_id;
  }
  if (!tenantId) return; // variant/order already gone locally — nothing to attribute the log row to

  await supabase.from("fulfillment_logs").insert({
    tenant_id: tenantId,
    order_id: params.orderId ?? null,
    variant_id: params.variantId ?? null,
    event: params.event,
    detail: params.detail ?? null,
  });
}

/**
 * Receives product/order events from the dropship-engine (see its README's
 * webhook list) and applies them to Beach Footprints' own products/orders —
 * the mirror image of the admin routes that call *into* the engine. Every
 * payload is scoped to this store's own ids (externalProductId/
 * externalVariantId/externalOrderId), never the engine's internal ids.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifySignature(rawBody, request.headers.get("X-Dropship-Signature"))) {
    return NextResponse.json({ error: "Invalid or missing signature" }, { status: 401 });
  }

  const envelope = JSON.parse(rawBody) as WebhookEnvelope;
  const supabase = createServiceRoleSupabaseClient();

  switch (envelope.event) {
    case "product.price_changed": {
      const { externalVariantId, previousPriceCents, newPriceCents } = envelope.data as {
        externalVariantId: string;
        previousPriceCents: number;
        newPriceCents: number;
      };
      await supabase.from("product_variants").update({ price: newPriceCents }).eq("id", externalVariantId);
      await logEvent(supabase, { event: "webhook_price_changed", variantId: externalVariantId, detail: { previousPriceCents, newPriceCents } });
      break;
    }
    case "product.out_of_stock": {
      const { externalVariantId, externalProductId } = envelope.data as { externalVariantId: string; externalProductId: string };
      await supabase.from("product_variants").update({ is_active: false }).eq("id", externalVariantId);
      await supabase.from("inventory_items").update({ stock_on_hand: 0 }).eq("variant_id", externalVariantId);
      await maybeToggleProductStock(supabase, externalProductId);
      await logEvent(supabase, { event: "webhook_out_of_stock", variantId: externalVariantId });
      break;
    }
    case "product.restocked": {
      const { externalVariantId, externalProductId, stockOnHand } = envelope.data as { externalVariantId: string; externalProductId: string; stockOnHand: number };
      await supabase.from("product_variants").update({ is_active: true }).eq("id", externalVariantId);
      await supabase.from("inventory_items").update({ stock_on_hand: stockOnHand }).eq("variant_id", externalVariantId);
      await supabase.from("products").update({ status: "PUBLISHED" }).eq("id", externalProductId).eq("status", "OUT_OF_STOCK");
      await logEvent(supabase, { event: "webhook_restocked", variantId: externalVariantId, detail: { stockOnHand } });
      break;
    }
    case "order.shipped": {
      const { externalOrderId, trackingNumber, carrier } = envelope.data as { externalOrderId: string; trackingNumber: string; carrier: string };
      await supabase
        .from("orders")
        .update({ status: "FULFILLED", fulfillment_status: "shipped", tracking_number: trackingNumber, carrier, shipped_at: new Date().toISOString() })
        .eq("id", externalOrderId);
      await logEvent(supabase, { event: "webhook_shipped", orderId: externalOrderId, detail: { trackingNumber, carrier } });
      await notifyCustomerShipped(supabase, envelope.data as { externalOrderId: string; trackingNumber: string; carrier: string; trackingUrl?: string });
      break;
    }
    case "order.delivered": {
      const { externalOrderId } = envelope.data as { externalOrderId: string };
      await supabase.from("orders").update({ status: "DELIVERED", fulfillment_status: "delivered" }).eq("id", externalOrderId);
      await logEvent(supabase, { event: "webhook_delivered", orderId: externalOrderId });
      break;
    }
    case "order.fulfillment_failed": {
      const { externalOrderId } = envelope.data as { externalOrderId: string };
      await supabase.from("orders").update({ fulfillment_status: "fulfillment_failed" }).eq("id", externalOrderId);
      await logEvent(supabase, { event: "webhook_fulfillment_failed", orderId: externalOrderId });
      break;
    }
  }

  return NextResponse.json({ received: true });
}

/** If every variant of a product is now out of stock, mark the product itself OUT_OF_STOCK (mirrors the old in-repo engine's behavior). */
async function maybeToggleProductStock(supabase: Db, productId: string): Promise<void> {
  const { data: variants } = await supabase.from("product_variants").select("is_active").eq("product_id", productId);
  if (variants && variants.length > 0 && variants.every((v) => !v.is_active)) {
    await supabase.from("products").update({ status: "OUT_OF_STOCK" }).eq("id", productId).eq("status", "PUBLISHED");
  }
}

async function notifyCustomerShipped(
  supabase: Db,
  event: { externalOrderId: string; trackingNumber: string; carrier: string; trackingUrl?: string },
): Promise<void> {
  const { getEmailProvider } = await import("@/lib/email/getEmailProvider");
  const { data: order } = await supabase.from("orders").select("id, customers(email)").eq("id", event.externalOrderId).single();
  const customerEmail = (order as any)?.customers?.email;
  if (!customerEmail) return;

  await getEmailProvider().sendTransactionalEmail({
    to: customerEmail,
    templateKey: "order-shipped",
    subject: "Your Beach Footprints order has shipped",
    data: { orderId: event.externalOrderId, trackingNumber: event.trackingNumber, carrier: event.carrier, trackingUrl: event.trackingUrl },
  });
}
