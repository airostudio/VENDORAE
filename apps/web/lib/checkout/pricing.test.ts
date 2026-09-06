import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveCart } from "./pricing";

const TENANT_ID = "tenant-1";

interface VariantFixture {
  id: string;
  product_id: string;
  title: string | null;
  sku: string | null;
  price: number;
  currency: string;
  is_active: boolean;
  products: { id: string; tenant_id: string; title: string; handle: string; status: string } | null;
}

/**
 * A hand-rolled fake matching exactly the query chain resolveCart issues — not a general
 * Supabase mock, just enough surface for this function's three queries (product_variants,
 * inventory_items, product_media) so the pricing math is tested without a live database.
 */
function fakeSupabase(fixtures: {
  variants: VariantFixture[];
  stock: Record<string, number>;
  media?: Record<string, string>;
  settings?: { shipping_flat_rate_cents?: number; free_shipping_threshold_cents?: number; tax_rate_percent?: number } | null;
}): SupabaseClient {
  return {
    from(table: string) {
      if (table === "product_variants") {
        return { select: () => ({ in: async () => ({ data: fixtures.variants, error: null }) }) };
      }
      if (table === "inventory_items") {
        return {
          select: () => ({
            in: async (_col: string, ids: string[]) => ({
              data: ids.map((id) => ({ variant_id: id, stock_on_hand: fixtures.stock[id] ?? 0 })),
            }),
          }),
        };
      }
      if (table === "product_media") {
        return {
          select: () => ({
            in: () => ({
              order: async () => ({
                data: Object.entries(fixtures.media ?? {}).map(([product_id, url]) => ({ product_id, url, position: 0 })),
              }),
            }),
          }),
        };
      }
      if (table === "tenant_settings") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: fixtures.settings ?? null, error: null }) }) }) };
      }
      throw new Error(`fakeSupabase: unexpected table "${table}"`);
    },
  } as unknown as SupabaseClient;
}

function variant(overrides: Partial<VariantFixture> = {}): VariantFixture {
  return {
    id: "variant-1",
    product_id: "product-1",
    title: "Regular",
    sku: "SKU-1",
    price: 2500,
    currency: "USD",
    is_active: true,
    products: { id: "product-1", tenant_id: TENANT_ID, title: "Sandal", handle: "sandal", status: "PUBLISHED" },
    ...overrides,
  };
}

describe("resolveCart", () => {
  it("returns an empty cart for no requested lines", async () => {
    const cart = await resolveCart(fakeSupabase({ variants: [], stock: {} }), TENANT_ID, []);
    expect(cart).toEqual({ lines: [], currency: "USD", subtotalCents: 0, shippingCents: 0, taxCents: 0, totalCents: 0 });
  });

  it("prices a purchasable line from the database, not the request", async () => {
    const supabase = fakeSupabase({ variants: [variant({ price: 2500 })], stock: { "variant-1": 10 } });
    const cart = await resolveCart(supabase, TENANT_ID, [{ variantId: "variant-1", quantity: 2 }]);

    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].purchasable).toBe(true);
    expect(cart.lines[0].unitPriceCents).toBe(2500);
    expect(cart.lines[0].lineTotalCents).toBe(5000);
    expect(cart.subtotalCents).toBe(5000);
  });

  it("charges flat shipping under the free-shipping threshold", async () => {
    const supabase = fakeSupabase({ variants: [variant({ price: 2500 })], stock: { "variant-1": 10 } });
    const cart = await resolveCart(supabase, TENANT_ID, [{ variantId: "variant-1", quantity: 1 }]);
    expect(cart.subtotalCents).toBe(2500);
    expect(cart.shippingCents).toBe(995);
    expect(cart.totalCents).toBe(3495);
  });

  it("waives shipping at or above the free-shipping threshold", async () => {
    const supabase = fakeSupabase({ variants: [variant({ price: 10000 })], stock: { "variant-1": 10 } });
    const cart = await resolveCart(supabase, TENANT_ID, [{ variantId: "variant-1", quantity: 1 }]);
    expect(cart.subtotalCents).toBe(10000);
    expect(cart.shippingCents).toBe(0);
  });

  it("marks a line unpurchasable and excludes it from the subtotal when stock is short", async () => {
    const supabase = fakeSupabase({ variants: [variant({ price: 2500 })], stock: { "variant-1": 1 } });
    const cart = await resolveCart(supabase, TENANT_ID, [{ variantId: "variant-1", quantity: 3 }]);

    expect(cart.lines[0].purchasable).toBe(false);
    expect(cart.lines[0].unavailableReason).toBe("Only 1 left");
    expect(cart.subtotalCents).toBe(0);
  });

  it("reports out of stock distinctly from low stock", async () => {
    const supabase = fakeSupabase({ variants: [variant({ price: 2500 })], stock: { "variant-1": 0 } });
    const cart = await resolveCart(supabase, TENANT_ID, [{ variantId: "variant-1", quantity: 1 }]);
    expect(cart.lines[0].unavailableReason).toBe("Out of stock");
  });

  it("refuses a variant belonging to another tenant by dropping it silently", async () => {
    const supabase = fakeSupabase({
      variants: [variant({ products: { id: "product-1", tenant_id: "other-tenant", title: "Sandal", handle: "sandal", status: "PUBLISHED" } })],
      stock: { "variant-1": 10 },
    });
    const cart = await resolveCart(supabase, TENANT_ID, [{ variantId: "variant-1", quantity: 1 }]);
    expect(cart.lines).toHaveLength(0);
  });

  it("marks an unpublished product's line unpurchasable", async () => {
    const supabase = fakeSupabase({
      variants: [variant({ products: { id: "product-1", tenant_id: TENANT_ID, title: "Sandal", handle: "sandal", status: "DRAFT" } })],
      stock: { "variant-1": 10 },
    });
    const cart = await resolveCart(supabase, TENANT_ID, [{ variantId: "variant-1", quantity: 1 }]);
    expect(cart.lines[0].purchasable).toBe(false);
    expect(cart.lines[0].unavailableReason).toBe("No longer available");
  });

  it("refuses to sum lines priced in different currencies into one total", async () => {
    const supabase = fakeSupabase({
      variants: [
        variant({ id: "variant-1", price: 2500, currency: "USD" }),
        variant({ id: "variant-2", product_id: "product-2", price: 3000, currency: "AUD" }),
      ],
      stock: { "variant-1": 10, "variant-2": 10 },
    });
    const cart = await resolveCart(supabase, TENANT_ID, [
      { variantId: "variant-1", quantity: 1 },
      { variantId: "variant-2", quantity: 1 },
    ]);

    expect(cart.currency).toBe("USD");
    const stray = cart.lines.find((l) => l.variantId === "variant-2")!;
    expect(stray.purchasable).toBe(false);
    expect(stray.unavailableReason).toMatch(/Priced in AUD/);
    // Only the USD line counts toward the charge.
    expect(cart.subtotalCents).toBe(2500);
  });

  it("clamps requested quantity to 99 and drops non-positive quantities", async () => {
    const supabase = fakeSupabase({ variants: [variant({ price: 100 })], stock: { "variant-1": 1000 } });
    const cart = await resolveCart(supabase, TENANT_ID, [
      { variantId: "variant-1", quantity: 500 },
      { variantId: "variant-1", quantity: 0 },
    ]);
    // Second entry (quantity 0) is filtered out entirely, so only the clamped-to-99 line remains.
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].quantity).toBe(99);
  });

  it("defaults to the previous hardcoded shipping/tax behavior when a tenant has no settings row", async () => {
    const supabase = fakeSupabase({ variants: [variant({ price: 2500 })], stock: { "variant-1": 10 }, settings: null });
    const cart = await resolveCart(supabase, TENANT_ID, [{ variantId: "variant-1", quantity: 1 }]);
    expect(cart.shippingCents).toBe(995);
    expect(cart.taxCents).toBe(0);
  });

  it("applies a merchant-configured flat shipping rate and free-shipping threshold", async () => {
    const supabase = fakeSupabase({
      variants: [variant({ price: 5000 })],
      stock: { "variant-1": 10 },
      settings: { shipping_flat_rate_cents: 500, free_shipping_threshold_cents: 6000 },
    });
    const cart = await resolveCart(supabase, TENANT_ID, [{ variantId: "variant-1", quantity: 1 }]);
    expect(cart.shippingCents).toBe(500);
  });

  it("applies a merchant-configured flat tax rate to the subtotal, rounded to the cent", async () => {
    const supabase = fakeSupabase({
      variants: [variant({ price: 999 })],
      stock: { "variant-1": 10 },
      settings: { tax_rate_percent: 8.25 },
    });
    const cart = await resolveCart(supabase, TENANT_ID, [{ variantId: "variant-1", quantity: 1 }]);
    // 999 * 8.25% = 82.4175 -> rounds to 82
    expect(cart.taxCents).toBe(82);
    expect(cart.totalCents).toBe(cart.subtotalCents + cart.shippingCents + cart.taxCents);
  });
});
