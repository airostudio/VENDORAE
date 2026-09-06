import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ResolvedLine {
  variantId: string;
  productId: string;
  handle: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  imageUrl: string | null;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  currency: string;
  stockOnHand: number;
  /** False when the variant is inactive, unpublished, or short on stock — checkout refuses these. */
  purchasable: boolean;
  unavailableReason: string | null;
}

export interface ResolvedCart {
  lines: ResolvedLine[];
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
}

/** Fallbacks if a tenant has no tenant_settings row yet — match this table's own column defaults. */
const DEFAULT_SHIPPING_FLAT_CENTS = 995;
const DEFAULT_FREE_SHIPPING_THRESHOLD_CENTS = 10000;
const DEFAULT_TAX_RATE_PERCENT = 0;

/**
 * Resolves cart lines against the database — the single source of truth for what anything costs.
 *
 * Prices, availability and currency all come from `product_variants`/`inventory_items` here, never
 * from the client, so the amount charged can't be influenced by anything the browser sends. The
 * client only ever chooses a variant id and a quantity.
 */
export async function resolveCart(
  supabase: SupabaseClient,
  tenantId: string,
  requested: Array<{ variantId: string; quantity: number }>,
): Promise<ResolvedCart> {
  const wanted = requested
    .filter((l) => typeof l.variantId === "string" && Number.isFinite(l.quantity) && l.quantity > 0)
    .map((l) => ({ variantId: l.variantId, quantity: Math.min(99, Math.floor(l.quantity)) }));

  if (wanted.length === 0) {
    return { lines: [], currency: "USD", subtotalCents: 0, shippingCents: 0, taxCents: 0, totalCents: 0 };
  }

  const [{ data, error }, { data: settingsRow }] = await Promise.all([
    supabase
      .from("product_variants")
      .select("id, product_id, title, sku, price, currency, is_active, products!inner(id, tenant_id, title, handle, status)")
      .in(
        "id",
        wanted.map((l) => l.variantId),
      ),
    supabase
      .from("tenant_settings")
      .select("shipping_flat_rate_cents, free_shipping_threshold_cents, tax_rate_percent")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);
  if (error) throw new Error(`Could not price the cart: ${error.message}`);

  const shippingFlatCents = settingsRow?.shipping_flat_rate_cents ?? DEFAULT_SHIPPING_FLAT_CENTS;
  const freeShippingThresholdCents = settingsRow?.free_shipping_threshold_cents ?? DEFAULT_FREE_SHIPPING_THRESHOLD_CENTS;
  const taxRatePercent = settingsRow?.tax_rate_percent ?? DEFAULT_TAX_RATE_PERCENT;

  interface VariantRow {
    id: string;
    product_id: string;
    title: string | null;
    sku: string | null;
    price: number;
    currency: string;
    is_active: boolean;
    products: { id: string; tenant_id: string; title: string; handle: string; status: string } | null;
  }
  const rows = (data ?? []) as unknown as VariantRow[];

  const variantIds = rows.map((r) => r.id);
  const [{ data: stockRows }, { data: mediaRows }] = await Promise.all([
    supabase.from("inventory_items").select("variant_id, stock_on_hand").in("variant_id", variantIds),
    supabase
      .from("product_media")
      .select("product_id, url, position")
      .in("product_id", rows.map((r) => r.product_id))
      .order("position"),
  ]);
  const stockByVariant = new Map(
    ((stockRows ?? []) as { variant_id: string; stock_on_hand: number }[]).map((r) => [r.variant_id, r.stock_on_hand]),
  );
  const imageByProduct = new Map<string, string>();
  for (const m of (mediaRows ?? []) as { product_id: string; url: string }[]) {
    if (!imageByProduct.has(m.product_id)) imageByProduct.set(m.product_id, m.url);
  }

  const lines: ResolvedLine[] = [];
  for (const want of wanted) {
    const row = rows.find((r) => r.id === want.variantId);
    // A variant that has vanished, belongs to another tenant, or whose product isn't published
    // is simply dropped — it should never appear in a cart, let alone be charged for.
    if (!row || !row.products || row.products.tenant_id !== tenantId) continue;

    const stockOnHand = stockByVariant.get(row.id) ?? 0;
    const published = row.products.status === "PUBLISHED";
    const purchasable = published && row.is_active && stockOnHand >= want.quantity;

    lines.push({
      variantId: row.id,
      productId: row.product_id,
      handle: row.products.handle,
      title: row.products.title,
      variantTitle: row.title,
      sku: row.sku,
      imageUrl: imageByProduct.get(row.product_id) ?? null,
      unitPriceCents: row.price,
      quantity: want.quantity,
      lineTotalCents: row.price * want.quantity,
      currency: row.currency,
      stockOnHand,
      purchasable,
      unavailableReason: !published
        ? "No longer available"
        : !row.is_active
          ? "Currently unavailable"
          : stockOnHand < want.quantity
            ? stockOnHand === 0
              ? "Out of stock"
              : `Only ${stockOnHand} left`
            : null,
    });
  }

  // The cart's currency is the first line's. Anything priced differently is refused rather than
  // added in: summing mixed currencies and charging the total under one of them would take the
  // wrong amount of money. A catalogue should be single-currency, but an old import or a changed
  // setting can leave a stray variant behind, and that must not reach Stripe.
  const currency = lines[0]?.currency ?? "USD";
  for (const line of lines) {
    if (line.currency !== currency) {
      line.purchasable = false;
      line.unavailableReason = `Priced in ${line.currency}, but this cart is in ${currency}`;
    }
  }

  const subtotalCents = lines.filter((l) => l.purchasable).reduce((sum, l) => sum + l.lineTotalCents, 0);
  const shippingCents = subtotalCents === 0 || subtotalCents >= freeShippingThresholdCents ? 0 : shippingFlatCents;
  // A single flat rate, merchant-configured — not real jurisdiction-based tax (US nexus/state,
  // GST/VAT). Zero (the default) is honest until a merchant sets one or a real tax engine is
  // connected; this never invents a rate on its own.
  const taxCents = Math.round((subtotalCents * taxRatePercent) / 100);

  return {
    lines,
    currency,
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents: subtotalCents + shippingCents + taxCents,
  };
}
