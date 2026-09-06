import { describe, expect, it, vi } from "vitest";

const TENANT_ID = "tenant-1";

/** Chainable stub resolving to `{ data }` — enough for getStoreCurrency's single lookup. */
function fakeSupabase(row: { base_currency: string } | null) {
  const node: any = {
    select: () => node,
    eq: () => node,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { from: () => node };
}

vi.mock("./client", () => ({
  db: () => (globalThis as any).__fakeSupabase,
  getTenantId: async () => TENANT_ID,
}));

const { getStoreCurrency } = await import("./settings");

describe("getStoreCurrency", () => {
  it("defaults to USD when the tenant has no settings row yet", async () => {
    (globalThis as any).__fakeSupabase = fakeSupabase(null);
    expect(await getStoreCurrency()).toBe("USD");
  });

  it("returns the configured currency once one is set", async () => {
    (globalThis as any).__fakeSupabase = fakeSupabase({ base_currency: "AUD" });
    expect(await getStoreCurrency()).toBe("AUD");
  });
});
