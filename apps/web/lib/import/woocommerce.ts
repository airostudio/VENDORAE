import "server-only";
import ExcelJS from "exceljs";
import * as cheerio from "cheerio";
import { writeCsvRows } from "@trend/core";
import type { ProductCsvRecord } from "./product-import";

/**
 * Converts a WooCommerce product-export .xlsx into the exact CSV format
 * /admin/products/import already understands, so the upload can hand off to
 * the existing (tested, byte-range-chunked) import pipeline unchanged —
 * this only replaces the "get a CSV" step, not how it's imported afterward.
 *
 * TypeScript port of tools/wc-import-convert/convert.py — keep the two in
 * sync if the classification/extraction rules change. The Python tool
 * remains useful for local one-off conversions without deploying; this is
 * the same logic wired into the admin UI.
 */

export const PRODUCT_CSV_COLUMNS = [
  "handle", "title", "product_type", "short_description", "description",
  "price", "compare_at", "sku", "stock_on_hand", "category_handles",
  "brand", "material", "height_cm", "status", "image_urls",
] as const satisfies readonly (keyof ProductCsvRecord)[];

const CARE_KEYWORDS = ["cleaner", "detergent", "stain remover", "repair", "spray", "conditioner", "wash"];
const ACCESSORY_KEYWORDS = ["bag", "tote", "hat", "belt", "jewelry", "jewellery", "accessories", "accessory"];

// Not real catalog products — WooCommerce order-adjustment/test placeholder
// rows that occasionally end up exported alongside the real catalogue.
const EXCLUDE_PATTERNS = [/making\s+up\s+the\s+difference/i, /make\s+up\s+the\s+difference/i, /^test\d*$/i];

const HEIGHT_RE = /(\d{2,3})\s?cm/i;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Word-boundary matching, not naive substring matching.
function matchesAny(haystack: string, keywords: string[]): boolean {
  return keywords.some((kw) => new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(haystack));
}

function classifyProductTypeAndCategory(name: string, categories: string): { productType: string; categoryHandles: string } {
  const haystack = `${name} ${categories}`.toLowerCase();

  if (matchesAny(haystack, CARE_KEYWORDS)) return { productType: "CARE_PRODUCT", categoryHandles: "care" };
  if (matchesAny(haystack, ACCESSORY_KEYWORDS)) return { productType: "ACCESSORY", categoryHandles: "accessories" };
  return { productType: "STANDARD", categoryHandles: "new-arrivals" };
}

// The source export has a literal backslash-n (two characters, not a real
// newline) sitting directly inside <tbody>/<tr> between table cells — an
// export artifact. That's non-whitespace text in a position only <td>/<th>
// may occupy, so HTML5 parsing's foster-parenting rule kicks in: cheerio
// hoists it entirely out of the table (in front of it), leaving the two
// <td>s' own text concatenated with nothing between them ("MaterialTPE").
// Stripping it — and adding a safety-net space between any exactly-adjacent
// tags — before parsing avoids that rather than trying to un-garble it after.
function normalizeHtml(html: string): string {
  return html.replace(/\\n/g, " ").replace(/></g, "> <");
}

function stripHtml(html: string): string {
  if (!html || !html.trim()) return "";
  const $ = cheerio.load(normalizeHtml(html));
  return $.root().text().replace(/\s+/g, " ").trim();
}

/** Extracts label->value pairs from the <table><tr><td>Label</td><td>Value</td></tr>... spec table these descriptions embed. */
function parseSpecTable(html: string): Map<string, string> {
  const specs = new Map<string, string>();
  if (!html || !html.includes("<table")) return specs;
  const $ = cheerio.load(normalizeHtml(html));
  $("tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length >= 2) {
      let label = $(cells[0]).text().trim();
      const value = $(cells[1]).text().trim();
      label = label.replace(/[:\s]+$/, "").trim(); // trailing ":" made "height:" a separate key from "height"
      if (label) specs.set(label.toLowerCase(), value);
    }
  });
  return specs;
}

function extractMaterial(categories: string, specs: Map<string, string>): string {
  const fromSpec = specs.get("material") || specs.get("materials") || specs.get("fabric");
  if (fromSpec) return fromSpec;
  const match = categories.match(/Shop By Material\s*>\s*([^,]+)/);
  return match ? match[1].trim() : "";
}

function extractHeight(name: string, specs: Map<string, string>): string {
  const fromSpec = specs.get("height") || specs.get("body height");
  if (fromSpec) {
    const m = fromSpec.match(HEIGHT_RE);
    if (m) return m[1];
  }
  const m = name.match(HEIGHT_RE);
  return m ? m[1] : "";
}


/**
 * WooCommerce products that don't manage stock levels export "In stock?" = 1 with no quantity —
 * meaning "available", with no number attached. This store's model needs a number (checkout
 * refuses a line whose stock won't cover it), so an unmanaged in-stock product gets a nominal
 * quantity rather than the zero that would make it unbuyable the moment it imported.
 */
export const UNMANAGED_STOCK_DEFAULT = 100;

/**
 * Reads stock out of a WooCommerce row, which can express it three different ways: a managed
 * quantity in "Stock", a yes/no in "In stock?", or a "Stock status" of instock/outofstock.
 */
export function readWooCommerceStock(values: {
  stock?: string;
  inStock?: string;
  stockStatus?: string;
}): string {
  const quantity = values.stock?.trim();
  if (quantity) {
    const parsed = Number.parseInt(quantity.replace(/[^0-9-]/g, ""), 10);
    // A managed quantity of 0 is a real answer: the product is genuinely out of stock.
    if (Number.isFinite(parsed)) return String(Math.max(0, parsed));
  }

  const inStock = values.inStock?.trim().toLowerCase();
  const status = values.stockStatus?.trim().toLowerCase();
  const saysInStock =
    inStock === "1" || inStock === "yes" || inStock === "true" || status === "instock" || status === "onbackorder";
  const saysOutOfStock = inStock === "0" || inStock === "no" || inStock === "false" || status === "outofstock";

  if (saysInStock) return String(UNMANAGED_STOCK_DEFAULT);
  if (saysOutOfStock) return "0";

  // Column absent entirely: treat the product as available rather than importing a catalogue
  // nobody can buy from. An export that says nothing about stock isn't saying "none".
  return String(UNMANAGED_STOCK_DEFAULT);
}

function cellText(row: ExcelJS.Row, colByHeader: Map<string, number>, header: string): string {
  const col = colByHeader.get(header);
  if (!col) return "";
  const value = row.getCell(col).value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("text" in value) return String((value as { text: unknown }).text ?? "");
    if ("richText" in value) {
      return (value as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
    }
    if (value instanceof Date) return value.toISOString();
    return "";
  }
  return String(value);
}

export interface WooCommerceConversionResult {
  csv: string;
  totalRows: number;
  excludedTitles: string[];
  typeCounts: Record<string, number>;
}

export async function convertWooCommerceWorkbook(buffer: Buffer): Promise<WooCommerceConversionResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("No worksheet found in the uploaded file");

  const colByHeader = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const text = String(cell.value ?? "").trim();
    if (text) colByHeader.set(text, colNumber);
  });
  if (!colByHeader.has("Name")) {
    throw new Error('Expected a "Name" column — is this a WooCommerce product export?');
  }

  const usedHandles = new Set<string>();
  const rows: Record<string, string>[] = [];
  const excludedTitles: string[] = [];
  const typeCounts: Record<string, number> = {};

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header

    const name = cellText(row, colByHeader, "Name").trim();
    if (!name) return;
    if (EXCLUDE_PATTERNS.some((p) => p.test(name))) {
      excludedTitles.push(name);
      return;
    }

    const wcId = cellText(row, colByHeader, "ID").trim();
    const baseHandle = slugify(name);
    let handle = baseHandle;
    let suffix = 2;
    while (usedHandles.has(handle)) handle = `${baseHandle}-${suffix++}`;
    usedHandles.add(handle);

    const categories = cellText(row, colByHeader, "Categories");
    const descriptionHtml = cellText(row, colByHeader, "Description");
    const specs = parseSpecTable(descriptionHtml);
    const { productType, categoryHandles } = classifyProductTypeAndCategory(name, categories);
    typeCounts[productType] = (typeCounts[productType] ?? 0) + 1;

    const regularPrice = cellText(row, colByHeader, "Regular price").trim();
    const salePrice = cellText(row, colByHeader, "Sale price").trim();
    const price = salePrice || regularPrice;
    const compareAt = salePrice ? regularPrice : "";

    rows.push({
      handle,
      title: name,
      product_type: productType,
      short_description: stripHtml(cellText(row, colByHeader, "Short description")).slice(0, 500),
      description: stripHtml(descriptionHtml),
      price,
      compare_at: compareAt,
      sku: wcId ? `WC-${wcId}` : "",
      stock_on_hand: readWooCommerceStock({
        stock: cellText(row, colByHeader, "Stock"),
        inStock: cellText(row, colByHeader, "In stock?"),
        stockStatus: cellText(row, colByHeader, "Stock status"),
      }),
      category_handles: categoryHandles,
      brand: "",
      material: extractMaterial(categories, specs),
      height_cm: extractHeight(name, specs),
      status: "DRAFT",
      // Already-hosted URLs straight from the source site — passed through
      // as-is rather than re-hosted, on purpose (their bandwidth, their data).
      image_urls: cellText(row, colByHeader, "Images").trim(),
    });
  });

  const csv = writeCsvRows(PRODUCT_CSV_COLUMNS, rows);
  return { csv, totalRows: rows.length, excludedTitles, typeCounts };
}
