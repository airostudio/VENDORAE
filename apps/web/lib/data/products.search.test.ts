import { describe, expect, it, vi } from "vitest";

const TENANT_ID = "tenant-1";

/** A thenable, fully-chainable stub that always resolves to `{ data, error: null }` — enough for
 * hydrate()'s incidental queries (variants/media/categories/reviews/inventory), whose content
 * doesn't matter for these search-ranking assertions. */
function emptyNode(data: unknown[] = []) {
  const node: any = {
    select: () => node,
    eq: () => node,
    in: () => node,
    ilike: () => node,
    order: () => node,
    limit: () => node,
    single: async () => ({ data: null, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: any, reject: any) => Promise.resolve({ data, error: null }).then(resolve, reject),
  };
  return node;
}

function productRow(overrides: Partial<{ id: string; handle: string; title: string; short_description: string | null }> = {}) {
  return {
    id: "product-1",
    handle: "sandal",
    title: "Sandal",
    product_type: "STANDARD",
    short_description: null,
    description: null,
    stock_policy: "IN_STOCK",
    care_instructions: null,
    warranty_details: null,
    warranty_months: null,
    production_days: null,
    dispatch_days: null,
    is_indexable: true,
    ...overrides,
  };
}

/** Tracks every ilike() call made against "products" and returns per-column fixture rows. */
function fakeSupabase(fixtures: { title: ReturnType<typeof productRow>[]; short_description: ReturnType<typeof productRow>[] }, calls: Array<{ column: string; pattern: string }>) {
  return {
    from(table: string) {
      if (table !== "products") return emptyNode([]);
      let column = "";
      const node: any = {
        select: () => node,
        eq: () => node,
        ilike: (col: string, pattern: string) => {
          column = col;
          calls.push({ column: col, pattern });
          return node;
        },
        limit: async () => ({ data: fixtures[column as "title" | "short_description"] ?? [], error: null }),
      };
      return node;
    },
  };
}

vi.mock("./client", () => ({
  db: () => (globalThis as any).__fakeSupabase,
  getTenantId: async () => TENANT_ID,
}));

const { searchProducts } = await import("./products");

describe("searchProducts", () => {
  it("returns nothing for a blank query without hitting the database", async () => {
    const calls: Array<{ column: string; pattern: string }> = [];
    (globalThis as any).__fakeSupabase = fakeSupabase({ title: [], short_description: [] }, calls);
    expect(await searchProducts("   ")).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("escapes LIKE wildcard characters in the query", async () => {
    const calls: Array<{ column: string; pattern: string }> = [];
    (globalThis as any).__fakeSupabase = fakeSupabase({ title: [], short_description: [] }, calls);
    await searchProducts("50% off_all");
    expect(calls[0].pattern).toBe("%50\\% off\\_all%");
  });

  it("ranks title matches before description-only matches, deduped", async () => {
    const titleMatch = productRow({ id: "p-title", handle: "title-match", title: "Beach Sandal" });
    const descMatch = productRow({ id: "p-desc", handle: "desc-match", title: "Other Item", short_description: "Great beach accessory" });
    const both = productRow({ id: "p-both", handle: "both", title: "Beach Towel", short_description: "beach essential" });

    const calls: Array<{ column: string; pattern: string }> = [];
    (globalThis as any).__fakeSupabase = fakeSupabase(
      { title: [titleMatch, both], short_description: [descMatch, both] },
      calls,
    );

    const results = await searchProducts("beach", 10);
    expect(results.map((r) => r.id)).toEqual(["p-title", "p-both", "p-desc"]);
  });

  it("caps results at the requested limit", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => productRow({ id: `p-${i}`, handle: `p-${i}`, title: `Beach ${i}` }));
    const calls: Array<{ column: string; pattern: string }> = [];
    (globalThis as any).__fakeSupabase = fakeSupabase({ title: rows, short_description: [] }, calls);

    const results = await searchProducts("beach", 3);
    expect(results).toHaveLength(3);
  });
});
