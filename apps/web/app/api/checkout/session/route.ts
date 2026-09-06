import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";
import { resolveCart } from "@/lib/checkout/pricing";
import { siteUrl, stripe } from "@/lib/checkout/stripe";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({
  lines: z.array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(99) })).min(1).max(50),
  email: z.string().email(),
  phone: z.string().optional(),
  fullName: z.string().min(2),
  line1: z.string().min(3),
  line2: z.string().optional(),
  city: z.string().min(1),
  region: z.string().optional(),
  postalCode: z.string().min(1),
  country: z.string().min(2).max(2),
});

/**
 * Starts a payment: prices the cart from the database, records a PENDING_PAYMENT order, and hands
 * back a Stripe Checkout URL for the browser to redirect to.
 *
 * Two deliberate choices:
 * - Amounts are built from `resolveCart`, never from the request body, so the browser cannot
 *   influence what is charged.
 * - The order is written *before* redirecting, so a payment always has a local order to attach to.
 *   It stays PENDING_PAYMENT until Stripe's webhook confirms the money actually moved — this route
 *   never marks anything paid, because a customer reaching the success page proves nothing.
 */
export async function POST(request: Request) {
  // Each call writes a PENDING_PAYMENT order and a Stripe session before the customer has paid
  // anything, so hitting this repeatedly litters both with no charge ever resulting — limit by IP.
  const rateLimit = checkRateLimit(`checkout-session:${clientIp(request)}`, 10, 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many checkout attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Please check the details entered.", detail: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  let client;
  try {
    client = stripe();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payments are not configured." }, { status: 503 });
  }

  const supabase = createServiceRoleSupabaseClient();

  try {
    const tenantId = await resolveTenantId(supabase);
    const cart = await resolveCart(supabase, tenantId, input.lines);

    const unavailable = cart.lines.filter((l) => !l.purchasable);
    if (unavailable.length > 0) {
      return NextResponse.json(
        {
          error: "Some items are no longer available.",
          unavailable: unavailable.map((l) => ({ variantId: l.variantId, title: l.title, reason: l.unavailableReason })),
        },
        { status: 409 },
      );
    }
    if (cart.lines.length === 0 || cart.totalCents <= 0) {
      return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
    }

    // Guests are customers too — keyed by email so repeat orders attach to one record.
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .upsert({ tenant_id: tenantId, email: input.email, name: input.fullName, phone: input.phone ?? null }, { onConflict: "tenant_id,email" })
      .select("id")
      .single();
    if (customerError || !customer) throw new Error(`Could not record the customer: ${customerError?.message}`);

    const shippingAddress = {
      fullName: input.fullName,
      line1: input.line1,
      line2: input.line2 ?? null,
      city: input.city,
      region: input.region ?? null,
      postalCode: input.postalCode,
      country: input.country,
      phone: input.phone ?? null,
    };

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        tenant_id: tenantId,
        customer_id: customer.id as string,
        status: "PENDING_PAYMENT",
        currency: cart.currency,
        subtotal: cart.subtotalCents,
        tax_total: cart.taxCents,
        shipping_total: cart.shippingCents,
        discount_total: 0,
        total: cart.totalCents,
        shipping_address: shippingAddress,
      })
      .select("id")
      .single();
    if (orderError || !order) throw new Error(`Could not create the order: ${orderError?.message}`);
    const orderId = order.id as string;

    const { error: itemsError } = await supabase.from("order_items").insert(
      cart.lines.map((l) => ({
        order_id: orderId,
        variant_id: l.variantId,
        title: l.variantTitle ? `${l.title} — ${l.variantTitle}` : l.title,
        sku: l.sku,
        quantity: l.quantity,
        unit_price: l.unitPriceCents,
        line_total: l.lineTotalCents,
      })),
    );
    if (itemsError) throw new Error(`Could not record the order items: ${itemsError.message}`);

    const base = siteUrl(request);
    const session = await client.checkout.sessions.create({
      mode: "payment",
      customer_email: input.email,
      // Stripe wants the lowest denomination; our prices are already integer cents.
      line_items: [
        ...cart.lines.map((l) => ({
          quantity: l.quantity,
          price_data: {
            currency: cart.currency.toLowerCase(),
            unit_amount: l.unitPriceCents,
            product_data: {
              name: l.variantTitle ? `${l.title} — ${l.variantTitle}` : l.title,
              ...(l.imageUrl ? { images: [l.imageUrl] } : {}),
            },
          },
        })),
        ...(cart.shippingCents > 0
          ? [
              {
                quantity: 1,
                price_data: {
                  currency: cart.currency.toLowerCase(),
                  unit_amount: cart.shippingCents,
                  product_data: { name: "Shipping" },
                },
              },
            ]
          : []),
        ...(cart.taxCents > 0
          ? [
              {
                quantity: 1,
                price_data: {
                  currency: cart.currency.toLowerCase(),
                  unit_amount: cart.taxCents,
                  product_data: { name: "Tax" },
                },
              },
            ]
          : []),
      ],
      // The webhook trusts this to find the order — it is set by us, not the browser.
      metadata: { orderId, tenantId },
      payment_intent_data: { metadata: { orderId, tenantId } },
      success_url: `${base}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/checkout?canceled=1`,
      // Stripe collects and validates the shipping address itself where it can, but we keep ours
      // as the record of what the customer actually entered.
      shipping_address_collection: { allowed_countries: [input.country.toUpperCase() as "AU"] },
    });

    if (!session.url) throw new Error("Stripe did not return a checkout URL.");

    await supabase.from("payments").insert({
      order_id: orderId,
      provider: "stripe",
      provider_ref: session.id,
      status: "PROCESSING",
      amount: cart.totalCents,
    });

    return NextResponse.json({ url: session.url, orderId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start checkout";
    console.error(`[checkout/session] ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
