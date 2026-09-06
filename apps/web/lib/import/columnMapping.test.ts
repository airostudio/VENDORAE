import { describe, expect, it } from "vitest";
import { applyColumnMapping, parseHeaderRow, scoreMatch, suggestColumnMapping, PRODUCT_IMPORT_FIELDS } from "./columnMapping";

const field = (key: string) => PRODUCT_IMPORT_FIELDS.find((f) => f.key === key)!;

describe("parseHeaderRow", () => {
  it("reads a plain header line", () => {
    expect(parseHeaderRow("Title,Price,SKU\nRow,1,2")).toEqual(["Title", "Price", "SKU"]);
  });

  it("respects quoted headings containing commas", () => {
    expect(parseHeaderRow('"Name, full",Price')).toEqual(["Name, full", "Price"]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseHeaderRow('"He said ""hi""",Price')).toEqual(['He said "hi"', "Price"]);
  });

  it("handles CRLF line endings and drops empty headings", () => {
    expect(parseHeaderRow("Title,,Price\r\nrow")).toEqual(["Title", "Price"]);
  });

  it("returns nothing for empty input", () => {
    expect(parseHeaderRow("")).toEqual([]);
  });
});

describe("scoreMatch", () => {
  it("scores an exact match, ignoring case and punctuation, at 100", () => {
    expect(scoreMatch("Product Name", field("title"))).toBe(100);
    expect(scoreMatch("stock_on_hand", field("stock_on_hand"))).toBe(100);
    expect(scoreMatch("SKU", field("sku"))).toBe(100);
  });

  it("scores an unrelated heading below the auto-map threshold", () => {
    expect(scoreMatch("Warehouse bay", field("title"))).toBeLessThan(45);
  });
});

describe("suggestColumnMapping", () => {
  it("maps a typical export's headings to the right fields", () => {
    const mapping = suggestColumnMapping(["Product Name", "Price", "SKU", "Stock", "Description", "Image URL"]);
    expect(mapping.title).toBe("Product Name");
    expect(mapping.price).toBe("Price");
    expect(mapping.sku).toBe("SKU");
    expect(mapping.stock_on_hand).toBe("Stock");
    expect(mapping.description).toBe("Description");
    expect(mapping.image_urls).toBe("Image URL");
  });

  it("gives 'Compare at price' to compare_at and leaves 'Price' for price", () => {
    // The failure this guards against: a containment match handing "Compare at price" to `price`,
    // which would silently import the struck-through price as what the customer pays.
    const mapping = suggestColumnMapping(["Price", "Compare at price"]);
    expect(mapping.price).toBe("Price");
    expect(mapping.compare_at).toBe("Compare at price");
  });

  it("never assigns one heading to two fields", () => {
    const mapping = suggestColumnMapping(["Name", "Price"]);
    const used = Object.values(mapping).filter(Boolean);
    expect(new Set(used).size).toBe(used.length);
  });

  it("leaves a field unmapped when nothing in the file fits it", () => {
    const mapping = suggestColumnMapping(["Title", "Price"]);
    expect(mapping.material).toBeNull();
    expect(mapping.height_cm).toBeNull();
  });

  it("returns every known field as a key, so the UI can render a row per field", () => {
    const mapping = suggestColumnMapping(["Title"]);
    expect(Object.keys(mapping).sort()).toEqual(PRODUCT_IMPORT_FIELDS.map((f) => f.key).sort());
  });
});

describe("applyColumnMapping", () => {
  it("rewrites a row from the file's headings into importer keys", () => {
    const row = { "Product Name": "Sandal", "Retail Price": "29.00", Notes: "ignored" };
    expect(applyColumnMapping(row, { title: "Product Name", price: "Retail Price" })).toEqual({
      title: "Sandal",
      price: "29.00",
    });
  });

  it("skips unmapped fields rather than writing empty values", () => {
    const row = { "Product Name": "Sandal" };
    const out = applyColumnMapping(row, { title: "Product Name", price: null, sku: "Missing column" });
    expect(out).toEqual({ title: "Sandal" });
  });

  it("passes the row through untouched when a job has no mapping, so older imports still work", () => {
    const row = { title: "Sandal", price: "29.00" };
    expect(applyColumnMapping(row, null)).toEqual(row);
  });
});
