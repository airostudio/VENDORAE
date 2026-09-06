import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureCategoriesExist } from "./categories";
import { linkToNewArrivals } from "./newArrivalsLink";
import { isDisplayableImageUrl, parseImageUrls } from "./imageUrls";
import { rehostImages, type ImageFetchCredentials } from "./rehostImages";

export interface ImportImageOptions {
  /** Copy source images into this store's own public bucket instead of linking to them. */
  rehost?: boolean;
  /** Sent as HTTP Basic auth when the image host requires a login. Never persisted. */
  credentials?: ImageFetchCredentials | null;
  /** Wall-clock budget for image fetching in this chunk, so a slow host can't blow the invocation. */
  deadline?: number;
}

/**
 * Maps one CSV data row (after header zip) into the columns the product
 * importer understands. Extra/missing CSV columns are tolerated — anything
 * required-but-missing becomes a per-row error rather than aborting the
 * whole chunk.
 */
export interface ProductCsvRecord {
  handle?: string;
  title?: string;
  product_type?: string;
  short_description?: string;
  description?: string;
  price?: string; // dollars, e.g. "189.00"
  compare_at?: string;
  sku?: string;
  stock_on_hand?: string;
  category_handles?: string; // pipe- or comma-separated existing category handles
  brand?: string;
  material?: string;
  height_cm?: string;
  status?: string; // DRAFT | PUBLISHED | ARCHIVED
  image_urls?: string; // pipe- or comma-separated, already-hosted image URLs, first = primary
}

export interface ImportRowError {
  rowNumber: number;
  handle?: string;
  message: string;
}

export interface ImportChunkResult {
  processed: number;
  errors: ImportRowError[];
  /** Rows that named a handle already present in the store — left untouched, not overwritten. */
  skippedExisting: number;
  /** Every handle seen in this chunk's valid rows (inserted or skipped), for the optional "mark missing as out of stock" pass. */
  seenHandles: string[];
  /** Every brand value seen in this chunk's valid rows, same purpose. */
  seenBrands: string[];
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function toCents(dollars: string | undefined): number | undefined {
  if (!dollars) return undefined;
  const n = Number.parseFloat(dollars.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}

const PRODUCT_TYPES = new Set([
  "STANDARD",
  "ACCESSORY",
  "CARE_PRODUCT",
  "BUNDLE",
  "GIFT_CARD",
]);

/**
 * Upsert one chunk's worth of already-parsed CSV rows. Called once per
 * byte-range chunk by the import processor route — batches all DB writes
 * for the chunk into a handful of upsert() calls rather than one round trip
 * per row, so a chunk of a few hundred rows stays comfortably inside a
 * single serverless invocation's time budget.
 */
export async function upsertProductRows(
  supabase: SupabaseClient,
  tenantId: string,
  records: { rowNumber: number; data: ProductCsvRecord }[],
  imageOptions?: ImportImageOptions,
): Promise<ImportChunkResult> {
  const errors: ImportRowError[] = [];
  const valid: { rowNumber: number; data: ProductCsvRecord; handle: string; priceCents: number }[] = [];

  for (const rec of records) {
    const title = rec.data.title?.trim();
    if (!title) {
      errors.push({ rowNumber: rec.rowNumber, message: "Missing required column: title" });
      continue;
    }
    const priceCents = toCents(rec.data.price);
    if (priceCents === undefined) {
      errors.push({ rowNumber: rec.rowNumber, handle: rec.data.handle, message: "Missing or invalid price" });
      continue;
    }
    const handle = rec.data.handle?.trim() ? slugify(rec.data.handle) : slugify(title);
    valid.push({ rowNumber: rec.rowNumber, data: rec.data, handle, priceCents });
  }

  const seenHandles = [...new Set(valid.map((v) => v.handle))];
  const seenBrands = [...new Set(valid.map((v) => v.data.brand?.trim()).filter((b): b is string => Boolean(b)))];

  if (valid.length === 0) return { processed: 0, errors, skippedExisting: 0, seenHandles, seenBrands };

  // Existing products are left completely untouched by default — only rows
  // whose handle isn't already in the store get written. (Opt-in "mark
  // missing as out of stock" is a separate pass the caller runs afterward,
  // scoped to the handles/brands returned here.)
  const { data: existingProducts, error: existingErr } = await supabase
    .from("products")
    .select("handle")
    .eq("tenant_id", tenantId)
    .in("handle", seenHandles);
  if (existingErr) {
    for (const v of valid) errors.push({ rowNumber: v.rowNumber, handle: v.handle, message: `Could not check for existing products: ${existingErr.message}` });
    return { processed: 0, errors, skippedExisting: 0, seenHandles, seenBrands };
  }
  const existingHandles = new Set((existingProducts ?? []).map((p) => p.handle as string));
  const toInsert = valid.filter((v) => !existingHandles.has(v.handle));
  const skippedExisting = valid.length - toInsert.length;

  if (toInsert.length === 0) return { processed: 0, errors, skippedExisting, seenHandles, seenBrands };

  // 0) Categories go in FIRST — a product referencing a category handle
  // that doesn't exist yet must not be able to land before that category
  // does, so every handle these rows will need (including "/"-nested
  // ancestors) is created up front, before any product row is written.
  const categoryHandlesNeeded = toInsert.flatMap((v) =>
    v.data.category_handles ? v.data.category_handles.split(/[|,]/).map((h) => h.trim()).filter(Boolean) : [],
  );
  const { errors: categoryErrors } = await ensureCategoriesExist(supabase, tenantId, categoryHandlesNeeded);
  errors.push(...categoryErrors.map((message) => ({ rowNumber: -1, message })));

  // 1) Insert new products only — never overwrite an existing one
  const productPayload = toInsert.map((v) => {
    const productType = v.data.product_type?.trim().toUpperCase();
    return {
      tenant_id: tenantId,
      handle: v.handle,
      title: v.data.title!.trim(),
      product_type: productType && PRODUCT_TYPES.has(productType) ? productType : "STANDARD",
      short_description: v.data.short_description?.trim() || null,
      description: v.data.description?.trim() || null,
      status: (v.data.status?.trim().toUpperCase() as "DRAFT" | "PUBLISHED" | "ARCHIVED") || "PUBLISHED",
      brand: v.data.brand?.trim() || null,
    };
  });

  const { data: insertedProducts, error: productErr } = await supabase
    .from("products")
    .insert(productPayload)
    .select("id, handle");

  if (productErr) {
    for (const v of toInsert) errors.push({ rowNumber: v.rowNumber, handle: v.handle, message: `Product insert failed: ${productErr.message}` });
    return { processed: 0, errors, skippedExisting, seenHandles, seenBrands };
  }

  const productIdByHandle = new Map((insertedProducts ?? []).map((p) => [p.handle as string, p.id as string]));

  // Downstream steps only ever touch newly-inserted products — existing
  // ones were filtered out above and stay completely untouched.
  // 2) Upsert one default variant per product
  const variantPayload = toInsert
    .map((v) => {
      const productId = productIdByHandle.get(v.handle);
      if (!productId) return null;
      return {
        product_id: productId,
        sku: v.data.sku?.trim() || `${v.handle}-DEFAULT`.toUpperCase(),
        price: v.priceCents,
        compare_at: toCents(v.data.compare_at) ?? null,
        currency: "USD",
        is_active: true,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const { data: upsertedVariants, error: variantErr } = await supabase
    .from("product_variants")
    .upsert(variantPayload, { onConflict: "product_id,sku" })
    .select("id, product_id, sku");

  if (variantErr) {
    for (const v of toInsert) errors.push({ rowNumber: v.rowNumber, handle: v.handle, message: `Variant upsert failed: ${variantErr.message}` });
  }

  // 3) Upsert inventory for each variant
  if (upsertedVariants && upsertedVariants.length > 0) {
    const stockByProductId = new Map(toInsert.map((v) => [productIdByHandle.get(v.handle), v.data.stock_on_hand]));
    const inventoryPayload = upsertedVariants.map((variant) => ({
      variant_id: variant.id as string,
      stock_on_hand: Number.parseInt(stockByProductId.get(variant.product_id as string) ?? "0", 10) || 0,
    }));
    const { error: invErr } = await supabase.from("inventory_items").upsert(inventoryPayload, { onConflict: "variant_id" });
    if (invErr) {
      errors.push({ rowNumber: -1, message: `Inventory upsert failed for chunk: ${invErr.message}` });
    }
  }

  // 4) Structured specs (material / height) instead of dumping into one blob
  const specRows = toInsert.flatMap((v) => {
    const productId = productIdByHandle.get(v.handle);
    if (!productId) return [];
    const specs: { product_id: string; group: string; label: string; value: string }[] = [];
    if (v.data.material?.trim()) specs.push({ product_id: productId, group: "Materials", label: "Material", value: v.data.material.trim() });
    if (v.data.height_cm?.trim()) specs.push({ product_id: productId, group: "Physical", label: "Height", value: `${v.data.height_cm.trim()} cm` });
    return specs;
  });
  if (specRows.length > 0) {
    // No natural unique key on product_specs, so avoid duplicate rows across
    // repeated imports by clearing this import's known labels first.
    const productIds = [...new Set(specRows.map((s) => s.product_id))];
    await supabase.from("product_specs").delete().in("product_id", productIds).in("label", ["Material", "Height"]);
    const { error: specErr } = await supabase.from("product_specs").insert(specRows);
    if (specErr) errors.push({ rowNumber: -1, message: `Spec insert failed for chunk: ${specErr.message}` });
  }

  // 5) Product imagery. Unusable links are dropped with a reason rather than stored: a URL that
  // can't load is a permanently broken image on the storefront, and it must never cost the row.
  const wantsImages = toInsert.filter((v) => v.data.image_urls?.trim());
  if (wantsImages.length > 0) {
    const productIds = wantsImages.map((v) => productIdByHandle.get(v.handle)).filter((id): id is string => Boolean(id));
    if (productIds.length > 0) {
      // Re-imports replace the gallery for these products rather than appending duplicates.
      await supabase.from("product_media").delete().in("product_id", productIds);
    }

    const parsedByHandle = new Map<string, ReturnType<typeof parseImageUrls>>();
    for (const v of wantsImages) {
      const parsed = parseImageUrls(v.data.image_urls);
      parsedByHandle.set(v.handle, parsed);
      for (const bad of parsed.rejected) {
        errors.push({ rowNumber: v.rowNumber, handle: v.handle, message: `Image skipped (${bad.reason}): ${bad.value}` });
      }
    }

    // When re-hosting is on, copy the bytes into our own public bucket — the source may be behind
    // a login or plain http, neither of which a customer's browser can load.
    let rehosted = new Map<string, string>();
    if (imageOptions?.rehost) {
      const allUrls = [...new Set([...parsedByHandle.values()].flatMap((p) => p.urls))];
      const outcome = await rehostImages(supabase, tenantId, allUrls, {
        credentials: imageOptions.credentials ?? null,
        deadline: imageOptions.deadline ?? Date.now() + 25_000,
      });
      rehosted = outcome.rehosted;
      for (const [handle, parsed] of parsedByHandle) {
        const row = wantsImages.find((v) => v.handle === handle);
        for (const failure of outcome.failures.filter((f) => parsed.urls.includes(f.url))) {
          errors.push({ rowNumber: row?.rowNumber ?? -1, handle, message: `Image skipped (${failure.reason}): ${failure.url}` });
        }
      }
    }

    const mediaRows: { product_id: string; url: string; alt: string; position: number }[] = [];
    for (const v of wantsImages) {
      const productId = productIdByHandle.get(v.handle);
      if (!productId) continue;
      const parsed = parsedByHandle.get(v.handle);
      if (!parsed) continue;
      // Without re-hosting we can only keep images the storefront can actually render. An http
      // URL is correct and reachable and still cannot be displayed (see isDisplayableImageUrl),
      // so it's reported rather than stored as an image that would 400 on every page view.
      let usable: string[];
      if (imageOptions?.rehost) {
        usable = parsed.urls.map((u) => rehosted.get(u)).filter((u): u is string => Boolean(u));
      } else {
        usable = parsed.urls.filter((u) => isDisplayableImageUrl(u));
        for (const url of parsed.urls.filter((u) => !isDisplayableImageUrl(u))) {
          errors.push({
            rowNumber: v.rowNumber,
            handle: v.handle,
            message: `Image skipped (http images can't be displayed — turn on "Copy images into this store" to import it): ${url}`,
          });
        }
      }
      usable.forEach((url, i) => mediaRows.push({ product_id: productId, url, alt: v.data.title?.trim() ?? v.handle, position: i }));
    }
    if (mediaRows.length > 0) {
      const { error: mediaErr } = await supabase.from("product_media").insert(mediaRows);
      if (mediaErr) errors.push({ rowNumber: -1, message: `Image insert failed for chunk: ${mediaErr.message}` });
    }
  }

  // 6) Category assignments by handle (categories must already exist)
  const wantsCategories = toInsert.filter((v) => v.data.category_handles?.trim());
  if (wantsCategories.length > 0) {
    const { data: categories } = await supabase.from("categories").select("id, handle").eq("tenant_id", tenantId);
    const categoryIdByHandle = new Map((categories ?? []).map((c) => [c.handle as string, c.id as string]));

    const links: { product_id: string; category_id: string }[] = [];
    for (const v of wantsCategories) {
      const productId = productIdByHandle.get(v.handle);
      if (!productId) continue;
      const handles = v.data.category_handles!.split(/[|,]/).map((h) => h.trim()).filter(Boolean);
      for (const h of handles) {
        const categoryId = categoryIdByHandle.get(h);
        if (categoryId) links.push({ product_id: productId, category_id: categoryId });
        else errors.push({ rowNumber: v.rowNumber, handle: v.handle, message: `Unknown category handle: ${h}` });
      }
    }
    if (links.length > 0) {
      const { error: catErr } = await supabase.from("product_categories").upsert(links, { onConflict: "product_id,category_id" });
      if (catErr) errors.push({ rowNumber: -1, message: `Category assignment failed for chunk: ${catErr.message}` });
    }
  }

  // Every product imported in this chunk also joins New Arrivals, whatever categories the file
  // gave it — it ages out on its own after NEW_ARRIVALS_DAYS (see lib/newArrivals.ts).
  for (const productId of productIdByHandle.values()) {
    await linkToNewArrivals(supabase, tenantId, productId);
  }

  return { processed: toInsert.length, errors, skippedExisting, seenHandles, seenBrands };
}

/**
 * Opt-in pass, run once after the whole file has been processed: marks
 * stock at zero for every variant of tenant products that share a brand
 * seen in this import but whose handle was NOT seen in this import — i.e.
 * "products this supplier used to carry that no longer appear in their
 * latest export". Scoped to the imported brand(s) so it never touches
 * unrelated products from other suppliers already in the store. Does not
 * delete, unpublish, or otherwise alter the product itself.
 */
export async function markMissingProductsOutOfStock(
  supabase: SupabaseClient,
  tenantId: string,
  seenHandles: string[],
  seenBrands: string[],
): Promise<{ markedProducts: number; error?: string }> {
  if (seenBrands.length === 0) return { markedProducts: 0 };

  let query = supabase.from("products").select("id, handle").eq("tenant_id", tenantId).in("brand", seenBrands);
  if (seenHandles.length > 0) query = query.not("handle", "in", `(${seenHandles.map((h) => `"${h}"`).join(",")})`);
  const { data: missingProducts, error: selectErr } = await query;
  if (selectErr) return { markedProducts: 0, error: selectErr.message };
  if (!missingProducts || missingProducts.length === 0) return { markedProducts: 0 };

  const productIds = missingProducts.map((p) => p.id as string);
  const { data: variants, error: variantErr } = await supabase
    .from("product_variants")
    .select("id")
    .in("product_id", productIds);
  if (variantErr) return { markedProducts: 0, error: variantErr.message };
  if (!variants || variants.length === 0) return { markedProducts: missingProducts.length };

  const { error: invErr } = await supabase
    .from("inventory_items")
    .update({ stock_on_hand: 0 })
    .in("variant_id", variants.map((v) => v.id as string));
  if (invErr) return { markedProducts: 0, error: invErr.message };

  return { markedProducts: missingProducts.length };
}
