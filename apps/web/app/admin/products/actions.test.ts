import { describe, expect, it, vi, beforeEach } from "vitest";

const TENANT_ID = "tenant-1";

interface UpdateCall {
  currency: string;
  productIds: string[];
}

interface DeleteCall {
  tenantId: string;
  handles: string[];
}

/** Records what the relabel actually wrote, per chunk, so batching is observable. */
function fakeSupabase(productIds: string[], calls: UpdateCall[]) {
  return {
    from(table: string) {
      if (table === "products") {
        const node: any = {
          select: () => node,
          eq: async () => ({ data: productIds.map((id) => ({ id })), error: null }),
        };
        return node;
      }
      if (table === "product_variants") {
        return {
          update: (patch: { currency: string }) => ({
            in: async (_col: string, ids: string[]) => {
              calls.push({ currency: patch.currency, productIds: ids });
              return { error: null };
            },
          }),
        };
      }
      throw new Error(`fakeSupabase: unexpected table "${table}"`);
    },
  };
}

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/data/client", () => ({
  db: () => (globalThis as any).__fakeSupabase,
  getTenantId: async () => TENANT_ID,
}));

const { setCatalogueCurrency, removeDemoProducts } = await import("./actions");
const { DEMO_PRODUCT_HANDLES } = await import("@/lib/data/demoProducts");

/** Records the delete's filters so we can assert it can only ever hit the seeded handles. */
function fakeDeleteSupabase(calls: DeleteCall[]) {
  return {
    from: () => ({
      delete: () => {
        let tenantId = "";
        const node: any = {
          eq: (_col: string, value: string) => {
            tenantId = value;
            return node;
          },
          in: async (_col: string, handles: string[]) => {
            calls.push({ tenantId, handles });
            return { error: null };
          },
        };
        return node;
      },
    }),
  };
}

function formData(currency: string): FormData {
  const fd = new FormData();
  fd.set("currency", currency);
  return fd;
}

let calls: UpdateCall[];
beforeEach(() => {
  calls = [];
});

describe("setCatalogueCurrency", () => {
  it("relabels every variant in the catalogue to the given currency", async () => {
    (globalThis as any).__fakeSupabase = fakeSupabase(["p1", "p2"], calls);
    await setCatalogueCurrency(formData("USD"));

    expect(calls).toHaveLength(1);
    expect(calls[0].currency).toBe("USD");
    expect(calls[0].productIds).toEqual(["p1", "p2"]);
  });

  it("uppercases the submitted code", async () => {
    (globalThis as any).__fakeSupabase = fakeSupabase(["p1"], calls);
    await setCatalogueCurrency(formData("usd"));
    expect(calls[0].currency).toBe("USD");
  });

  it("rejects anything that isn't a 3-letter code, without writing", async () => {
    (globalThis as any).__fakeSupabase = fakeSupabase(["p1"], calls);
    await expect(setCatalogueCurrency(formData("dollars"))).rejects.toThrow(/3-letter currency code/);
    expect(calls).toHaveLength(0);
  });

  it("chunks the update so a large catalogue can't overrun the query string", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `p${i}`);
    (globalThis as any).__fakeSupabase = fakeSupabase(ids, calls);
    await setCatalogueCurrency(formData("USD"));

    expect(calls.map((c) => c.productIds.length)).toEqual([200, 200, 50]);
    // Every product is covered exactly once.
    expect(calls.flatMap((c) => c.productIds)).toEqual(ids);
  });

  it("does nothing when the catalogue is empty", async () => {
    (globalThis as any).__fakeSupabase = fakeSupabase([], calls);
    await setCatalogueCurrency(formData("USD"));
    expect(calls).toHaveLength(0);
  });
});

describe("removeDemoProducts", () => {
  it("deletes only the exact seeded handles, scoped to the tenant", async () => {
    const deletes: DeleteCall[] = [];
    (globalThis as any).__fakeSupabase = fakeDeleteSupabase(deletes);

    await removeDemoProducts();

    expect(deletes).toHaveLength(1);
    expect(deletes[0].tenantId).toBe(TENANT_ID);
    // Exact-handle matching is the whole safety property: a real product can never be caught.
    expect(deletes[0].handles).toEqual([...DEMO_PRODUCT_HANDLES]);
    expect(deletes[0].handles).toContain("driftwood-kimono");
    expect(deletes[0].handles.every((h) => typeof h === "string" && !h.includes("*"))).toBe(true);
  });
});
