import "server-only";

/**
 * Thin adapter over the dropship-engine REST API (see /dropship-engine's
 * README). Beach Footprints is just one connected store — this file is the
 * whole integration surface: everything below sends externalProductId/
 * externalVariantId/externalOrderId as this store's own products.id/
 * product_variants.id/orders.id, and never has to know or store any of the
 * engine's internal ids.
 */

export interface EngineAddress {
  fullName: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode?: string;
  country: string;
  phone: string;
}

export interface SkuOption {
  name: string | null;
  value: string;
  imageUrl?: string | null;
}

export interface ProductAttribute {
  name: string;
  value: string;
}

export interface ImportedSku {
  aliexpressSkuId: string;
  properties: string | null;
  supplierCostCents: number;
  stockOnHand: number;
  retailPriceCents: number;
  marginRate: number;
  compareAtPriceCents?: number | null;
  options?: SkuOption[];
}

export interface ImportProductResult {
  aliexpressProductId: string;
  onBrandName: string;
  description: string;
  imageUrls: string[];
  currencyCode: string;
  skus: ImportedSku[];
  packageWeightGrams?: number | null;
  productUnit?: string | null;
  aliexpressCategoryId?: number | null;
  /** The supplier's spec table (Material, Style…), written to product_specs on confirm. */
  attributes?: ProductAttribute[];
}

export interface FulfillOrderResult {
  orderId: string;
  externalOrderId: string;
  skipped: boolean;
  aliexpressOrderId: string | null;
  fulfillmentStatus: string | null;
}

export interface OrderStatusResult {
  externalOrderId: string;
  fulfillmentStatus: string;
  aliexpressOrderId: string | null;
  trackingNumber: string | null;
  carrier: string | null;
}

export type RoundingMode = "none" | "up-95" | "up-99" | "up-00";
export type PricingRule =
  | { type: "percent_margin"; marginRate: number; rounding: RoundingMode }
  | { type: "fixed_markup"; markupCents: number; rounding: RoundingMode }
  | { type: "tiered_margin"; tiers: Array<{ maxCostCents?: number; marginRate: number }>; rounding: RoundingMode };

export interface StoreSettings {
  pricing: {
    minPriceCents?: number;
    maxPriceCents?: number;
    ignorePriceChangeBelowPercent?: number;
    compareAtRule?: PricingRule;
    /** The markup applied to every imported SKU's supplier cost. */
    rule?: PricingRule;
  };
  import: {
    defaultStatus: "draft" | "published";
    /** ISO 4217 currency the store sells in — AliExpress quotes imports in it. */
    targetCurrency?: string;
    /** ISO 3166-1 alpha-2 destination the price is quoted for. */
    shipToCountry?: string;
  };
  stock: { outOfStockBehavior: "mark_unavailable" | "keep_visible"; ignoreStockChangeBelowUnits?: number };
  shipping: { preferredLogisticsService?: string };
  notifications: {
    priceChanged: boolean;
    outOfStock: boolean;
    restocked: boolean;
    orderShipped: boolean;
    orderDelivered: boolean;
    fulfillmentFailed: boolean;
  };
}

class DropshipEngineError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "DropshipEngineError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function engineFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = requireEnv("DROPSHIP_ENGINE_URL").replace(/\/$/, "");
  const apiKey = requireEnv("DROPSHIP_ENGINE_API_KEY");

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new DropshipEngineError(body?.error ? JSON.stringify(body.error) : `Engine request failed (${res.status})`, res.status);
  return body as T;
}

export function importProduct(params: { aliexpressProductId: string; pricingRuleId?: string }): Promise<ImportProductResult> {
  return engineFetch("/v1/products/import", { method: "POST", body: JSON.stringify(params) });
}

export function createMapping(params: {
  externalProductId: string;
  externalVariantId: string;
  aliexpressProductId: string;
  aliexpressSkuId: string;
  onBrandName?: string;
}): Promise<{ id: string; supplierCostCents: number; retailPriceCents: number }> {
  return engineFetch("/v1/products/mappings", { method: "POST", body: JSON.stringify(params) });
}

export function fulfillOrder(params: {
  externalOrderId: string;
  shippingAddress: EngineAddress;
  lineItems: Array<{ externalVariantId: string; quantity: number }>;
}): Promise<FulfillOrderResult> {
  return engineFetch("/v1/orders/fulfill", { method: "POST", body: JSON.stringify(params) });
}

export function getOrderStatus(externalOrderId: string): Promise<OrderStatusResult> {
  return engineFetch(`/v1/orders/${encodeURIComponent(externalOrderId)}`);
}

export function triggerCatalogSync(): Promise<{ priceChanges: number; markedOutOfStock: number; restocked: number; mappingsChecked: number; errors: unknown[] }> {
  return engineFetch("/v1/sync/catalog", { method: "POST" });
}

export function triggerTrackingSync(): Promise<{ polled: number; shipped: number; delivered: number; errors: unknown[] }> {
  return engineFetch("/v1/sync/tracking", { method: "POST" });
}

/** Advanced/optional — only needed if this store wants its own AliExpress Open Platform app instead of the engine's shared one. */
export function connectAliExpressApp(params: { appKey: string; appSecret: string }): Promise<{ connected: boolean; message?: string }> {
  return engineFetch("/v1/aliexpress/connection", { method: "POST", body: JSON.stringify(params) });
}

export function getAliExpressStatus(): Promise<{ connected: boolean; connectedAt: string | null }> {
  return engineFetch("/v1/aliexpress/status");
}

export function getAuthorizeUrl(redirectUri: string): Promise<{ authorizeUrl: string }> {
  return engineFetch(`/v1/aliexpress/authorize-url?redirectUri=${encodeURIComponent(redirectUri)}`);
}

export function exchangeAuthorizationCode(params: { code: string; redirectUri: string }): Promise<{ connected: boolean }> {
  return engineFetch("/v1/aliexpress/callback", { method: "POST", body: JSON.stringify(params) });
}

export function registerWebhook(params: { url: string; secret: string }): Promise<{ registered: boolean }> {
  return engineFetch("/v1/webhooks", { method: "POST", body: JSON.stringify(params) });
}

export function getSettings(): Promise<{ settings: StoreSettings }> {
  return engineFetch("/v1/settings");
}

export function updateSettings(patch: Partial<StoreSettings>): Promise<{ settings: StoreSettings }> {
  return engineFetch("/v1/settings", { method: "PUT", body: JSON.stringify(patch) });
}
