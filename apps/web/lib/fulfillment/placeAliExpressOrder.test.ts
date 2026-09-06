import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { fulfillOrder } = vi.hoisted(() => ({ fulfillOrder: vi.fn() }));
vi.mock("@/lib/dropshipEngine", () => ({ fulfillOrder }));

const { placeAliExpressOrder } = await import("./placeAliExpressOrder");

interface Calls {
  updates: Array<{ table: string; data: unknown }>;
  inserts: Array<{ table: string; data: unknown }>;
}

function fakeSupabase(
  fixture: {
    order?: { id: string; tenant_id: string; shipping_address: unknown } | null;
    items?: Array<{ quantity: number; variant_id: string; product_variants: { supplier: string | null }[] }>;
  },
  calls: Calls,
): SupabaseClient {
  return {
    from(table: string) {
      if (table === "orders") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => (fixture.order === null ? { data: null, error: { message: "not found" } } : { data: fixture.order, error: null }),
            }),
          }),
          update: (data: unknown) => ({
            eq: async () => {
              calls.updates.push({ table, data });
              return { data: null, error: null };
            },
          }),
        };
      }
      if (table === "order_items") {
        return { select: () => ({ eq: async () => ({ data: fixture.items ?? [], error: null }) }) };
      }
      if (table === "fulfillment_logs") {
        return {
          insert: async (data: unknown) => {
            calls.inserts.push({ table, data });
            return { data: null, error: null };
          },
        };
      }
      throw new Error(`fakeSupabase: unexpected table "${table}"`);
    },
  } as unknown as SupabaseClient;
}

const ORDER_ID = "order-1";
const baseOrder = { id: ORDER_ID, tenant_id: "tenant-1", shipping_address: { fullName: "A", line1: "1 St", city: "C", country: "US", phone: "+1" } };

beforeEach(() => {
  fulfillOrder.mockReset();
});

describe("placeAliExpressOrder", () => {
  it("fails when the order does not exist", async () => {
    const calls: Calls = { updates: [], inserts: [] };
    const result = await placeAliExpressOrder(fakeSupabase({ order: null }, calls), ORDER_ID);
    expect(result).toEqual({ ok: false, error: "Order not found" });
    expect(fulfillOrder).not.toHaveBeenCalled();
  });

  it("fails when the order has no shipping address", async () => {
    const calls: Calls = { updates: [], inserts: [] };
    const result = await placeAliExpressOrder(fakeSupabase({ order: { ...baseOrder, shipping_address: null } }, calls), ORDER_ID);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/shipping_address/);
  });

  it("skips as a success when there are no dropship-engine line items", async () => {
    const calls: Calls = { updates: [], inserts: [] };
    const items = [{ quantity: 1, variant_id: "v1", product_variants: [{ supplier: "manual" }] }];
    const result = await placeAliExpressOrder(fakeSupabase({ order: baseOrder, items }, calls), ORDER_ID);
    expect(result).toEqual({ ok: true, skipped: true });
    expect(fulfillOrder).not.toHaveBeenCalled();
  });

  it("fails closed when the shipping address has no phone", async () => {
    const calls: Calls = { updates: [], inserts: [] };
    const order = { ...baseOrder, shipping_address: { ...baseOrder.shipping_address, phone: undefined } };
    const items = [{ quantity: 1, variant_id: "v1", product_variants: [{ supplier: "dropship-engine" }] }];
    const result = await placeAliExpressOrder(fakeSupabase({ order, items }, calls), ORDER_ID);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/phone/i);
    expect(fulfillOrder).not.toHaveBeenCalled();
  });

  it("places the order, mirrors the result, and logs order_placed", async () => {
    const calls: Calls = { updates: [], inserts: [] };
    const items = [{ quantity: 2, variant_id: "v1", product_variants: [{ supplier: "dropship-engine" }] }];
    fulfillOrder.mockResolvedValue({ orderId: ORDER_ID, externalOrderId: ORDER_ID, skipped: false, aliexpressOrderId: "ae-123", fulfillmentStatus: "fulfillment_in_progress" });

    const result = await placeAliExpressOrder(fakeSupabase({ order: baseOrder, items }, calls), ORDER_ID);

    expect(result).toEqual({ ok: true, skipped: false, aliexpressOrderId: "ae-123" });
    expect(fulfillOrder).toHaveBeenCalledWith({
      externalOrderId: ORDER_ID,
      shippingAddress: baseOrder.shipping_address,
      lineItems: [{ externalVariantId: "v1", quantity: 2 }],
    });
    expect(calls.updates[0].data).toMatchObject({ aliexpress_order_id: "ae-123", status: "FULFILLING" });
    expect(calls.inserts[0].data).toMatchObject({ event: "order_placed", supplier_order_id: "ae-123" });
  });

  it("logs order_place_failed and returns ok:false when the engine call throws", async () => {
    const calls: Calls = { updates: [], inserts: [] };
    const items = [{ quantity: 1, variant_id: "v1", product_variants: [{ supplier: "dropship-engine" }] }];
    fulfillOrder.mockRejectedValue(new Error("engine unreachable"));

    const result = await placeAliExpressOrder(fakeSupabase({ order: baseOrder, items }, calls), ORDER_ID);

    expect(result).toEqual({ ok: false, error: "engine unreachable" });
    expect(calls.inserts[0].data).toMatchObject({ event: "order_place_failed", detail: { error: "engine unreachable" } });
  });
});
