import { describe, expect, it } from "vitest";
import { UNMANAGED_STOCK_DEFAULT, readWooCommerceStock } from "./woocommerce";

describe("readWooCommerceStock", () => {
  it("uses a managed quantity when the export has one", () => {
    expect(readWooCommerceStock({ stock: "42" })).toBe("42");
  });

  it("treats a managed zero as genuinely out of stock", () => {
    // The one case where 0 is a real answer rather than an absent one.
    expect(readWooCommerceStock({ stock: "0", inStock: "1" })).toBe("0");
  });

  it("clamps a negative backorder quantity to zero", () => {
    expect(readWooCommerceStock({ stock: "-3" })).toBe("0");
  });

  it("gives an unmanaged in-stock product a usable quantity", () => {
    // WooCommerce says "available, no number". Importing 0 would make it unbuyable on arrival,
    // which is what was happening to every product in these exports.
    expect(readWooCommerceStock({ inStock: "1" })).toBe(String(UNMANAGED_STOCK_DEFAULT));
    expect(readWooCommerceStock({ stockStatus: "instock" })).toBe(String(UNMANAGED_STOCK_DEFAULT));
    expect(readWooCommerceStock({ inStock: "yes" })).toBe(String(UNMANAGED_STOCK_DEFAULT));
  });

  it("respects an explicit out-of-stock flag", () => {
    expect(readWooCommerceStock({ inStock: "0" })).toBe("0");
    expect(readWooCommerceStock({ stockStatus: "outofstock" })).toBe("0");
  });

  it("treats backordered as available", () => {
    expect(readWooCommerceStock({ stockStatus: "onbackorder" })).toBe(String(UNMANAGED_STOCK_DEFAULT));
  });

  it("defaults to available when the export says nothing about stock", () => {
    // An export with no stock columns isn't asserting "none" — importing a catalogue nobody can
    // buy from is the worse reading.
    expect(readWooCommerceStock({})).toBe(String(UNMANAGED_STOCK_DEFAULT));
  });

  it("ignores thousands separators in a quantity", () => {
    expect(readWooCommerceStock({ stock: "1,200" })).toBe("1200");
  });
});
