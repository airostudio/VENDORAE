import "server-only";

export interface RawOption {
  name: string | null;
  value: string;
  imageUrl?: string | null;
}

/**
 * AliExpress supplies an option's name (`sku_property_name`) inconsistently — plenty of listings
 * return only the value, so a variant arrives as "Blue" with no indication it's a colour. A product
 * page needs the name to label its picker, so this infers one from the values when the supplier
 * didn't give one.
 *
 * Inference looks at the WHOLE column of values for a position rather than each value alone: "S"
 * could be a size or a colour code, but a column of {S, M, L, XL} is unambiguous. Anything that
 * can't be classified with confidence falls back to a neutral name rather than a wrong one.
 */

const SIZE_TOKENS = new Set([
  "xxs", "xs", "s", "m", "l", "xl", "xxl", "xxxl", "2xl", "3xl", "4xl", "5xl",
  "one size", "onesize", "free size", "os",
]);

const COLOR_WORDS = new Set([
  "black", "white", "red", "blue", "green", "yellow", "pink", "purple", "orange", "brown", "grey",
  "gray", "beige", "navy", "khaki", "gold", "silver", "ivory", "cream", "tan", "burgundy", "teal",
  "turquoise", "coral", "mint", "olive", "maroon", "lavender", "apricot", "wine", "sky blue",
  "light blue", "dark blue", "light green", "dark green", "rose", "champagne", "multicolor",
  "multicolour", "transparent", "clear",
]);

const COUNTRY_WORDS = new Set([
  "china", "united states", "usa", "us", "russian federation", "russia", "spain", "france",
  "germany", "italy", "australia", "poland", "czech republic", "united kingdom", "uk", "japan",
  "korea", "brazil", "canada", "turkey", "belgium", "netherlands",
]);

const PLUG_WORDS = new Set(["us plug", "eu plug", "uk plug", "au plug", "cn plug", "us", "eu", "uk", "au"]);

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Proportion of values matching a predicate — inference needs a clear majority, not one lucky hit. */
function ratio(values: string[], predicate: (v: string) => boolean): number {
  if (values.length === 0) return 0;
  return values.filter((v) => predicate(normalize(v))).length / values.length;
}

const CONFIDENT = 0.6;

/** Infers a name for one option position from every value that appears in it. */
export function inferOptionName(values: string[], position: number): string {
  const unique = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  if (unique.length === 0) return `Option ${position + 1}`;

  if (ratio(unique, (v) => SIZE_TOKENS.has(v)) >= CONFIDENT) return "Size";
  // Numeric-with-unit columns are sizes too: "39", "40 cm", "XL(50kg-60kg)".
  if (ratio(unique, (v) => /^\d+(\.\d+)?\s*(cm|mm|inch|in|")?$/.test(v)) >= CONFIDENT) return "Size";

  if (ratio(unique, (v) => COLOR_WORDS.has(v) || [...COLOR_WORDS].some((c) => v.includes(c))) >= CONFIDENT) {
    return "Color";
  }
  if (ratio(unique, (v) => PLUG_WORDS.has(v) || v.includes("plug")) >= CONFIDENT) return "Plug Type";
  if (ratio(unique, (v) => COUNTRY_WORDS.has(v)) >= CONFIDENT) return "Ships From";
  if (ratio(unique, (v) => /\b(\d+)\s*(pcs|pieces|pack|set)\b/.test(v)) >= CONFIDENT) return "Quantity";
  if (ratio(unique, (v) => v.includes("style") || v.includes("model") || v.includes("type")) >= CONFIDENT) {
    return "Style";
  }

  // A wrong label is worse than a generic one — a shopper can read the values either way.
  return position === 0 ? "Option" : `Option ${position + 1}`;
}

/**
 * Fills in missing option names across a product's SKUs. Names supplied by AliExpress always win;
 * only positions where every SKU lacks a name are inferred.
 */
export function nameOptions<T extends { options?: RawOption[] | null }>(skus: T[]): T[] {
  const positions = Math.max(0, ...skus.map((s) => s.options?.length ?? 0));
  const namesByPosition: string[] = [];

  for (let i = 0; i < positions; i++) {
    const supplied = skus.map((s) => s.options?.[i]?.name).find((n) => Boolean(n && n.trim()));
    if (supplied) {
      namesByPosition[i] = supplied.trim();
      continue;
    }
    const values = skus.map((s) => s.options?.[i]?.value).filter((v): v is string => Boolean(v));
    namesByPosition[i] = inferOptionName(values, i);
  }

  return skus.map((sku) => ({
    ...sku,
    options: (sku.options ?? []).map((opt, i) => ({ ...opt, name: opt.name?.trim() || namesByPosition[i] || `Option ${i + 1}` })),
  }));
}
