# WooCommerce product-export → Beach Footprints importer CSV

Converts a WooCommerce product-export `.xlsx` into the CSV format
`apps/web/lib/import/product-import.ts` — and therefore
`/admin/products/import` — already expects.

This is a much better source than scraping: it's the source store's own
structured product data (real prices, real hosted image URLs, real
descriptions), not something reconstructed by guessing at page markup.

## Usage

```bash
pip install pandas openpyxl beautifulsoup4
python3 convert.py wc-product-export.xlsx -o products.csv
```

Then take `products.csv` to `/admin/products/import` — it handles files of
any size via the existing chunked pipeline.

## What it does

- **Classifies `product_type`** from the title + WooCommerce category path:
  care items (cleaner, detergent, repair spray, ...) → `CARE_PRODUCT`; bags,
  totes, hats, belts, jewelry, anything explicitly tagged "Accessories" →
  `ACCESSORY`; everything else → `STANDARD`. All keyword matching is
  **word-boundary**, not substring, to avoid false positives against
  unrelated words that happen to contain a keyword.
- **Parses the spec table** WooCommerce descriptions here embed as an HTML
  `<table>` (Material, Fabric, ...) to populate `material` accurately,
  rather than guessing from the title. Falls back to the "Shop By Material"
  category when a product has no spec table.
- **Strips HTML** from descriptions, including a literal `\n` (backslash-n
  as two characters, not a real newline) artifact baked into the source
  export's table markup.
- **Excludes non-product rows** — WooCommerce order-adjustment placeholders
  ("Make Up The Difference In Freight Costs...") and test entries — rather
  than importing them as fake $0 products. Reports what it excluded.
- **All rows land as `status: DRAFT`**, regardless of the source's own
  published state — review pricing, wording, and category assignment for
  *this* store before publishing each one.
- `category_handles` only ever references handles already seeded in
  `supabase/seed.sql` (`dresses-kimonos`, `swim`, `accessories`, `care`,
  `new-arrivals`, `best-sellers`, `sale`, `bundles`) — if the real category
  taxonomy differs, adjust `classify_product_type_and_categories()`.

## Verified

Output round-trips exactly through the actual TypeScript CSV chunk parser
(`packages/core/src/csv.ts`) used by the live importer.
