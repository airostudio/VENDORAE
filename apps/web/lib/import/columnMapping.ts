/**
 * Matching a CSV's own column headings to the fields the product importer understands.
 *
 * Deliberately not "server-only": the admin picks the mapping in the browser before anything is
 * uploaded, and the processor applies the same mapping server-side, so both sides share this file
 * and can't drift apart.
 */

export interface ImportField {
  /** The key upsertProductRows reads (see ProductCsvRecord). */
  key: string;
  label: string;
  /** title and price are the only two a row can't be imported without. */
  required?: boolean;
  hint?: string;
  /** Other headings a store's export might call this. Matched loosely — see scoreMatch. */
  synonyms: string[];
}

export const PRODUCT_IMPORT_FIELDS: ImportField[] = [
  { key: "title", label: "Title", required: true, synonyms: ["name", "product name", "product title", "item name"] },
  {
    key: "price",
    label: "Price",
    required: true,
    hint: "In dollars, e.g. 189.00",
    synonyms: ["retail price", "unit price", "selling price", "regular price", "sale price"],
  },
  {
    key: "handle",
    label: "Handle",
    hint: "URL slug. Derived from the title when not mapped.",
    synonyms: ["slug", "url key", "permalink", "product handle", "url"],
  },
  { key: "sku", label: "SKU", synonyms: ["item number", "part number", "mpn", "product code", "barcode"] },
  { key: "stock_on_hand", label: "Stock", synonyms: ["stock", "quantity", "qty", "inventory", "stock quantity", "inventory quantity", "in stock"] },
  { key: "compare_at", label: "Compare-at price", hint: "Shown struck through", synonyms: ["compare at price", "rrp", "msrp", "was price", "list price", "original price"] },
  { key: "short_description", label: "Short description", synonyms: ["summary", "excerpt", "subtitle", "short desc"] },
  { key: "description", label: "Description", synonyms: ["long description", "body", "body html", "details", "product description", "content"] },
  { key: "category_handles", label: "Categories", hint: "Pipe- or comma-separated", synonyms: ["category", "categories", "category handles", "product category", "collection", "collections"] },
  { key: "image_urls", label: "Image URLs", hint: "Pipe- or comma-separated, first is primary", synonyms: ["image", "images", "image url", "image urls", "photo", "photos", "picture", "image src", "images src", "featured image"] },
  { key: "brand", label: "Brand", synonyms: ["vendor", "manufacturer", "make"] },
  { key: "product_type", label: "Product type", hint: "STANDARD, ACCESSORY, CARE_PRODUCT, BUNDLE or GIFT_CARD", synonyms: ["type", "item type"] },
  { key: "material", label: "Material", synonyms: ["fabric", "composition", "made of"] },
  { key: "height_cm", label: "Height (cm)", synonyms: ["height", "height cm"] },
  { key: "status", label: "Status", hint: "DRAFT, PUBLISHED or ARCHIVED", synonyms: ["published", "visibility", "state"] },
];

export const REQUIRED_IMPORT_FIELDS = PRODUCT_IMPORT_FIELDS.filter((f) => f.required).map((f) => f.key);

/** Comparison form: case, spaces, underscores and punctuation all stop mattering. */
export function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * How well one CSV heading fits one field, 0–100. An exact match on the field key or any synonym
 * scores 100, which is what stops "Compare at price" being handed to `price`: the greedy
 * assignment below places that exact match first, so the looser containment match never gets a
 * chance to claim the column.
 */
export function scoreMatch(header: string, field: ImportField): number {
  const h = normalizeHeader(header);
  if (!h) return 0;

  let best = 0;
  for (const candidate of [field.key, field.label, ...field.synonyms]) {
    const c = normalizeHeader(candidate);
    if (!c) continue;
    if (h === c) return 100;
    if (h.startsWith(c) || h.endsWith(c)) best = Math.max(best, 70 + Math.round((c.length / h.length) * 20));
    else if (h.includes(c)) best = Math.max(best, 50 + Math.round((c.length / h.length) * 20));
    else if (c.includes(h)) best = Math.max(best, 40 + Math.round((h.length / c.length) * 20));
  }
  return best;
}

/** Below this a guess is worse than leaving the field unmapped for the admin to decide. */
const MIN_SCORE = 45;

/**
 * Best-fit mapping of field key → CSV heading, for the admin to correct before importing.
 *
 * Greedy on the strongest match first, with each heading and each field used at most once, so a
 * file with both "Price" and "Sale price" gives each to the field that fits it best rather than
 * letting whichever field happened to be checked first take both.
 */
export function suggestColumnMapping(headers: string[]): Record<string, string | null> {
  const pairs: { field: string; header: string; score: number }[] = [];
  for (const field of PRODUCT_IMPORT_FIELDS) {
    for (const header of headers) {
      const score = scoreMatch(header, field);
      if (score >= MIN_SCORE) pairs.push({ field: field.key, header, score });
    }
  }
  // Strongest first; ties go to the shorter heading, which is the more literal match.
  pairs.sort((a, b) => b.score - a.score || a.header.length - b.header.length);

  const mapping: Record<string, string | null> = Object.fromEntries(PRODUCT_IMPORT_FIELDS.map((f) => [f.key, null]));
  const usedHeaders = new Set<string>();
  for (const pair of pairs) {
    if (mapping[pair.field] || usedHeaders.has(pair.header)) continue;
    mapping[pair.field] = pair.header;
    usedHeaders.add(pair.header);
  }
  return mapping;
}

/**
 * Rewrites one row (keyed by the file's own headings) into the keys the importer reads.
 *
 * A job with no stored mapping keeps the old behaviour of treating the file's headings as already
 * canonical, so imports created before mapping existed still process correctly.
 */
export function applyColumnMapping(
  row: Record<string, string>,
  fieldMap: Record<string, string | null> | null | undefined,
): Record<string, string> {
  if (!fieldMap) return row;
  const out: Record<string, string> = {};
  for (const [field, header] of Object.entries(fieldMap)) {
    if (!header) continue;
    const value = row[header];
    if (value !== undefined) out[field] = value;
  }
  return out;
}

/** The header line of a CSV, for the mapping UI to offer as options. */
export function parseHeaderRow(text: string): string[] {
  const [firstLine] = text.split(/\r?\n/);
  if (!firstLine) return [];
  const headers: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < firstLine.length; i++) {
    const char = firstLine[i];
    if (inQuotes) {
      if (char === '"') {
        if (firstLine[i + 1] === '"') {
          current += '"';
          i++;
        } else inQuotes = false;
      } else current += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ",") {
      headers.push(current.trim());
      current = "";
    } else current += char;
  }
  headers.push(current.trim());
  return headers.filter((h) => h.length > 0);
}
