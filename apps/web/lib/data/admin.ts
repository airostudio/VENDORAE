import "server-only";
import { db, getTenantId } from "./client";

export interface DashboardKpis {
  revenueCents30d: number;
  orders30d: number;
  avgOrderValueCents: number;
  pendingOrders: number;
  fulfillingOrders: number;
  lowStockItems: number;
  currency: string;
}

const REVENUE_STATUSES = ["PAID", "FULFILLING", "FULFILLED", "DELIVERED"];

/** All real — this store has no live checkout wired up yet (see README), so these are legitimately zero until orders exist. */
export async function getDashboardKpis(): Promise<DashboardKpis> {
  const tenantId = await getTenantId();
  const supabase = db();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: orders }, { count: pendingOrders }, { count: fulfillingOrders }, { data: productIds }] = await Promise.all([
    supabase.from("orders").select("total, currency, status").eq("tenant_id", tenantId).gte("created_at", since),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "PENDING_PAYMENT"),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "FULFILLING"),
    supabase.from("products").select("id").eq("tenant_id", tenantId),
  ]);

  const revenueOrders = (orders ?? []).filter((o) => REVENUE_STATUSES.includes(o.status as string));
  const revenueCents30d = revenueOrders.reduce((sum, o) => sum + (o.total as number), 0);
  const currency = (revenueOrders[0]?.currency as string) ?? "USD";

  let lowStockItems = 0;
  const ids = ((productIds ?? []) as { id: string }[]).map((p) => p.id);
  if (ids.length > 0) {
    const { data: variants } = await supabase.from("product_variants").select("id").in("product_id", ids);
    const variantIds = ((variants ?? []) as { id: string }[]).map((v) => v.id);
    if (variantIds.length > 0) {
      // PostgREST filters compare a column to a literal, not another column —
      // fetch both and compare in JS rather than reach for a DB view/RPC for this.
      const { data: inv } = await supabase.from("inventory_items").select("stock_on_hand, low_stock_threshold").in("variant_id", variantIds);
      lowStockItems = ((inv ?? []) as { stock_on_hand: number; low_stock_threshold: number }[]).filter(
        (i) => i.stock_on_hand <= i.low_stock_threshold,
      ).length;
    }
  }

  return {
    revenueCents30d,
    orders30d: revenueOrders.length,
    avgOrderValueCents: revenueOrders.length > 0 ? Math.round(revenueCents30d / revenueOrders.length) : 0,
    pendingOrders: pendingOrders ?? 0,
    fulfillingOrders: fulfillingOrders ?? 0,
    lowStockItems,
    currency,
  };
}

/** The jsonb snapshot checkout writes to orders.shipping_address — what was actually shipped to. */
export interface OrderAddress {
  fullName?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  phone?: string | null;
}

export interface AdminOrderSummary {
  id: string;
  createdAt: string;
  status: string;
  fulfillmentStatus: string | null;
  totalCents: number;
  currency: string;
  customerEmail: string | null;
  customerName: string | null;
  customerPhone: string | null;
  shippingAddress: OrderAddress | null;
  itemCount: number;
  trackingNumber: string | null;
  aliexpressOrderId: string | null;
  hasStockShortfall: boolean;
}

/**
 * Real orders, newest first. Everything a customer buys through Stripe checkout lands here as
 * PENDING_PAYMENT and becomes PAID only when Stripe's webhook confirms the money moved, so this
 * list is also how you spot payments that started but never completed.
 */
export async function getAdminOrders(limit = 200): Promise<AdminOrderSummary[]> {
  const tenantId = await getTenantId();
  const supabase = db();

  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, created_at, status, fulfillment_status, total, currency, customer_id, shipping_address, tracking_number, aliexpress_order_id",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load orders: ${error.message}`);

  interface OrderRow {
    id: string;
    created_at: string;
    status: string;
    fulfillment_status: string | null;
    total: number;
    currency: string;
    customer_id: string | null;
    shipping_address: unknown;
    tracking_number: string | null;
    aliexpress_order_id: string | null;
  }
  const rows = (data ?? []) as OrderRow[];
  if (rows.length === 0) return [];

  const orderIds = rows.map((r) => r.id);
  const customerIds = [...new Set(rows.map((r) => r.customer_id).filter((id): id is string => Boolean(id)))];

  const [{ data: itemRows }, { data: customerRows }, { data: shortfallRows }] = await Promise.all([
    supabase.from("order_items").select("order_id, quantity").in("order_id", orderIds),
    customerIds.length > 0
      ? supabase.from("customers").select("id, email, name, phone").in("id", customerIds)
      : Promise.resolve({ data: [] as { id: string; email: string; name: string | null; phone: string | null }[] }),
    supabase.from("fulfillment_logs").select("order_id").eq("event", "stock_shortfall").in("order_id", orderIds),
  ]);

  const itemsByOrder = new Map<string, number>();
  for (const item of ((itemRows ?? []) as { order_id: string; quantity: number }[])) {
    itemsByOrder.set(item.order_id, (itemsByOrder.get(item.order_id) ?? 0) + item.quantity);
  }
  const customerById = new Map(
    ((customerRows ?? []) as { id: string; email: string; name: string | null; phone: string | null }[]).map((c) => [c.id, c]),
  );
  const shortfallOrderIds = new Set(((shortfallRows ?? []) as { order_id: string }[]).map((r) => r.order_id));

  return rows.map((r) => {
    const customer = r.customer_id ? customerById.get(r.customer_id) : undefined;
    const address = (r.shipping_address ?? null) as OrderAddress | null;
    return {
      id: r.id,
      createdAt: r.created_at,
      status: r.status,
      fulfillmentStatus: r.fulfillment_status,
      totalCents: r.total,
      currency: r.currency,
      customerEmail: customer?.email ?? null,
      customerName: customer?.name ?? address?.fullName ?? null,
      customerPhone: customer?.phone ?? address?.phone ?? null,
      shippingAddress: address,
      itemCount: itemsByOrder.get(r.id) ?? 0,
      trackingNumber: r.tracking_number,
      aliexpressOrderId: r.aliexpress_order_id,
      hasStockShortfall: shortfallOrderIds.has(r.id),
    };
  });
}

export interface AdminOrderItem {
  title: string;
  sku: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface AdminOrderPayment {
  provider: string;
  providerRef: string;
  status: string;
  amountCents: number;
  createdAt: string;
}

export interface AdminOrderEvent {
  event: string;
  detail: unknown;
  supplierOrderId: string | null;
  createdAt: string;
}

export interface AdminOrderDetail extends AdminOrderSummary {
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  discountCents: number;
  carrier: string | null;
  fulfilledAt: string | null;
  shippedAt: string | null;
  items: AdminOrderItem[];
  payments: AdminOrderPayment[];
  events: AdminOrderEvent[];
}

/** One order with everything an admin needs to act on it: what was bought, who by, what was paid, and what fulfillment has done since. */
export async function getAdminOrder(id: string): Promise<AdminOrderDetail | null> {
  const tenantId = await getTenantId();
  const supabase = db();

  const { data: order, error } = await supabase
    .from("orders")
    .select(
      "id, created_at, status, fulfillment_status, subtotal, tax_total, shipping_total, discount_total, total, currency, " +
        "customer_id, shipping_address, tracking_number, carrier, aliexpress_order_id, fulfilled_at, shipped_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load order: ${error.message}`);
  if (!order) return null;

  interface OrderDetailRow {
    id: string;
    created_at: string;
    status: string;
    fulfillment_status: string | null;
    subtotal: number;
    tax_total: number;
    shipping_total: number;
    discount_total: number;
    total: number;
    currency: string;
    customer_id: string | null;
    shipping_address: unknown;
    tracking_number: string | null;
    carrier: string | null;
    aliexpress_order_id: string | null;
    fulfilled_at: string | null;
    shipped_at: string | null;
  }
  const row = order as unknown as OrderDetailRow;

  const [{ data: itemRows }, { data: paymentRows }, { data: eventRows }, { data: customer }] = await Promise.all([
    supabase.from("order_items").select("title, sku, quantity, unit_price, line_total").eq("order_id", id),
    supabase.from("payments").select("provider, provider_ref, status, amount, created_at").eq("order_id", id).order("created_at"),
    supabase
      .from("fulfillment_logs")
      .select("event, detail, supplier_order_id, created_at")
      .eq("order_id", id)
      .order("created_at", { ascending: false }),
    row.customer_id
      ? supabase.from("customers").select("email, name, phone").eq("id", row.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const items = ((itemRows ?? []) as { title: string; sku: string | null; quantity: number; unit_price: number; line_total: number }[]).map(
    (i) => ({ title: i.title, sku: i.sku, quantity: i.quantity, unitPriceCents: i.unit_price, lineTotalCents: i.line_total }),
  );
  const address = (row.shipping_address ?? null) as OrderAddress | null;
  const person = customer as unknown as { email: string; name: string | null; phone: string | null } | null;

  return {
    id: row.id,
    createdAt: row.created_at,
    status: row.status,
    fulfillmentStatus: row.fulfillment_status,
    subtotalCents: row.subtotal,
    taxCents: row.tax_total,
    shippingCents: row.shipping_total,
    discountCents: row.discount_total,
    totalCents: row.total,
    currency: row.currency,
    customerEmail: person?.email ?? null,
    customerName: person?.name ?? address?.fullName ?? null,
    customerPhone: person?.phone ?? address?.phone ?? null,
    shippingAddress: address,
    itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
    trackingNumber: row.tracking_number,
    carrier: row.carrier,
    aliexpressOrderId: row.aliexpress_order_id,
    fulfilledAt: row.fulfilled_at,
    shippedAt: row.shipped_at,
    hasStockShortfall: ((eventRows ?? []) as { event: string }[]).some((e) => e.event === "stock_shortfall"),
    items,
    payments: ((paymentRows ?? []) as { provider: string; provider_ref: string; status: string; amount: number; created_at: string }[]).map(
      (p) => ({ provider: p.provider, providerRef: p.provider_ref, status: p.status, amountCents: p.amount, createdAt: p.created_at }),
    ),
    events: ((eventRows ?? []) as { event: string; detail: unknown; supplier_order_id: string | null; created_at: string }[]).map((e) => ({
      event: e.event,
      detail: e.detail,
      supplierOrderId: e.supplier_order_id,
      createdAt: e.created_at,
    })),
  };
}
