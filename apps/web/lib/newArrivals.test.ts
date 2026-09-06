import { describe, expect, it } from "vitest";
import { NEW_ARRIVALS_DAYS, newArrivalsCutoffIso } from "./newArrivals";

describe("newArrivalsCutoffIso", () => {
  it("is exactly NEW_ARRIVALS_DAYS before the given moment", () => {
    const now = new Date("2026-09-10T12:00:00.000Z");
    expect(newArrivalsCutoffIso(now)).toBe("2026-09-05T12:00:00.000Z");
  });

  it("keeps a product created just inside the window", () => {
    const now = new Date("2026-09-10T12:00:00.000Z");
    const createdAt = new Date(now.getTime() - (NEW_ARRIVALS_DAYS * 24 - 1) * 60 * 60 * 1000).toISOString();
    // The listing filters with `created_at >= cutoff`, so this is the comparison it makes.
    expect(createdAt >= newArrivalsCutoffIso(now)).toBe(true);
  });

  it("drops a product created just outside the window", () => {
    const now = new Date("2026-09-10T12:00:00.000Z");
    const createdAt = new Date(now.getTime() - (NEW_ARRIVALS_DAYS * 24 + 1) * 60 * 60 * 1000).toISOString();
    expect(createdAt >= newArrivalsCutoffIso(now)).toBe(false);
  });
});
