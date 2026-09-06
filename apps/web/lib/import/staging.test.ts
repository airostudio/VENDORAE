import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { importProduct } = vi.hoisted(() => ({ importProduct: vi.fn() }));
vi.mock("@/lib/dropshipEngine", () => ({ importProduct }));
vi.mock("@/lib/import/categorize", () => ({ categorizeProduct: async () => null }));
vi.mock("@/lib/import/optionNames", () => ({ nameOptions: (skus: unknown[]) => skus }));

const { stageProduct } = await import("./staging");

const TENANT_ID = "tenant-1";

interface Written {
  op: "insert" | "update";
  values: Record<string, unknown>;
}

/**
 * Fake matching stageProduct's query chain: the existing-row lookup, the insert/update, and the
 * read-back that verifies the row is visible to the queue.
 */
function fakeSupabase(existingId: string | null, written: Written[]): SupabaseClient {
  const row = (values: Record<string, unknown>) => ({
    id: "staged-1",
    aliexpress_product_id: "ae-1",
    status: "ready",
    title: "A product",
    created_at: new Date().toISOString(),
    ...values,
  });

  let lookupCount = 0;
  return {
    from() {
      const node: any = {
        select: () => node,
        eq: () => node,
        neq: () => node,
        maybeSingle: async () => {
          lookupCount += 1;
          // First call is the "already queued?" lookup; later ones are the visibility read-back,
          // which must find the row or stageProduct throws.
          if (lookupCount === 1) return { data: existingId ? { id: existingId } : null, error: null };
          return { data: { id: "staged-1" }, error: null };
        },
        insert: (values: Record<string, unknown>) => {
          written.push({ op: "insert", values });
          return { select: () => ({ single: async () => ({ data: row(values), error: null }) }) };
        },
        update: (values: Record<string, unknown>) => {
          written.push({ op: "update", values });
          return { eq: () => ({ select: () => ({ single: async () => ({ data: row(values), error: null }) }) }) };
        },
      };
      return node;
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  importProduct.mockReset();
  importProduct.mockResolvedValue({
    aliexpressProductId: "ae-1",
    onBrandName: "A product",
    description: "Heading\nSome copy.\n\nMore.",
    imageUrls: ["https://example.com/a.jpg"],
    currencyCode: "USD",
    skus: [],
    attributes: [],
  });
});

describe("stageProduct", () => {
  it("publishes on confirm by default, so onboarding doesn't produce an invisible draft", async () => {
    const written: Written[] = [];
    await stageProduct(fakeSupabase(null, written), TENANT_ID, { aliexpressProductId: "ae-1" });

    const insert = written.find((w) => w.op === "insert");
    expect(insert).toBeDefined();
    expect(insert!.values.publish).toBe(true);
    expect(insert!.values.tenant_id).toBe(TENANT_ID);
  });

  it("leaves publish alone when re-staging an existing row, so it can't override an admin's choice", async () => {
    const written: Written[] = [];
    await stageProduct(fakeSupabase("staged-1", written), TENANT_ID, { aliexpressProductId: "ae-1" });

    const update = written.find((w) => w.op === "update");
    expect(update).toBeDefined();
    expect(update!.values).not.toHaveProperty("publish");
  });
});
