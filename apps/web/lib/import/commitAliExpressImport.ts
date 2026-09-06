import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMapping } from "@/lib/dropshipEngine";
import type { StagedProduct } from "@/lib/import/staging";
import { linkToNewArrivals } from "./newArrivalsLink";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export interface CommitResult {
  productId: string;
  handle: string;
  isNewProduct: boolean;
  variantIds: string[];
}

/**
 * Writes a reviewed staged product into this store's own products/product_variants/product_media/
 * product_categories tables and registers each variant's mapping back with the engine.
 *
 * Everything written here comes from the staged row as the admin last edited it — the engine fetch
 * and AI rewrite happened when the product was staged, so confirming never re-runs them and never
 * discards a manual edit.
 */
export async function commitAliExpressImport(
  supabase: SupabaseClient,
  params: { tenantId: string; staged: StagedProduct },
): Promise<CommitResult> {
  const { staged } = params;
  const activeSkus = staged.skus.filter((sku) => sku.isActive || sku.stockOnHand > 0 || staged.skus.length === 1);
  const skus = activeSkus.length > 0 ? activeSkus : staged.skus;

  const { data: existingVariant } = await supabase
    .from("product_variants")
    .select("product_id")
    .eq("supplier", "dropship-engine")
    .eq("supplier_product_id", staged.aliexpressProductId)
    .limit(1)
    .maybeSingle();

  let productId: string;
  let handle: string;
  let isNewProduct = false;

  const productFields = {
    packaged_weight_grams: staged.packageWeightGrams,
    title: staged.title,
    short_description: staged.shortDescription || null,
    description: staged.description,
    seo_title: staged.seoTitle,
    seo_desc: staged.seoDesc,
    brand: staged.brand ?? "Beach Footprints",
    status: staged.publish ? "PUBLISHED" : "DRAFT",
  };

  if (existingVariant) {
    productId = existingVariant.product_id as string;
    const { data: existingProduct } = await supabase.from("products").select("handle").eq("id", productId).single();
    handle = (existingProduct?.handle as string | undefined) ?? slugify(staged.title);
    await supabase.from("products").update(productFields).eq("id", productId);
  } else {
    isNewProduct = true;
    handle = `${slugify(staged.title)}-${staged.aliexpressProductId}`;
    const { data: inserted, error } = await supabase
      .from("products")
      .insert({
        tenant_id: params.tenantId,
        product_type: staged.productType,
        handle,
        shipping_class: "STANDARD",
        stock_policy: "IN_STOCK",
        ...productFields,
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(`Could not create product: ${error?.message}`);
    productId = inserted.id as string;
  }

  const variantIds: string[] = [];
  for (const sku of skus) {
    const { data: upserted, error } = await supabase
      .from("product_variants")
      .upsert(
        {
          product_id: productId,
          title: sku.properties,
          sku: `AE-${sku.aliexpressSkuId}`,
          // Real option columns, so the storefront can render a proper variant picker
          // instead of one opaque "Blue / M" string.
          option1_name: sku.options?.[0]?.name ?? null,
          option1_value: sku.options?.[0]?.value ?? null,
          option2_name: sku.options?.[1]?.name ?? null,
          option2_value: sku.options?.[1]?.value ?? null,
          option3_name: sku.options?.[2]?.name ?? null,
          option3_value: sku.options?.[2]?.value ?? null,
          weight_grams: staged.packageWeightGrams,
          price: sku.retailPriceCents,
          compare_at: sku.compareAtCents,
          currency: staged.currencyCode,
          cost: sku.supplierCostCents,
          margin_rate: sku.marginRate,
          supplier: "dropship-engine",
          supplier_product_id: staged.aliexpressProductId,
          supplier_sku_id: sku.aliexpressSkuId,
          supplier_synced_at: new Date().toISOString(),
          is_active: sku.isActive,
        },
        { onConflict: "product_id,sku" },
      )
      .select("id")
      .single();
    if (error || !upserted) throw new Error(`Could not upsert variant ${sku.aliexpressSkuId}: ${error?.message}`);

    const variantId = upserted.id as string;
    variantIds.push(variantId);
    await supabase.from("inventory_items").upsert({ variant_id: variantId, stock_on_hand: sku.stockOnHand }, { onConflict: "variant_id" });

    // Tell the engine which of this store's variants this SKU is, so catalog sync keeps it priced/stocked and fires webhooks on changes.
    await createMapping({
      externalProductId: productId,
      externalVariantId: variantId,
      aliexpressProductId: staged.aliexpressProductId,
      aliexpressSkuId: sku.aliexpressSkuId,
      onBrandName: staged.title,
    });
  }

  // Media is synced on EVERY commit, not just for new products: re-confirming an already-imported
  // product (the normal way to pick up corrected images) would otherwise take the update path and
  // never attach them. The staged editor is where images are curated, so it owns the set — replace
  // rather than append, so re-confirming can't accumulate duplicates.
  if (staged.imageUrls.length > 0) {
    await supabase.from("product_media").delete().eq("product_id", productId);
    const { error: mediaError } = await supabase
      .from("product_media")
      .insert(staged.imageUrls.map((url, position) => ({ product_id: productId, url, position, alt: staged.title })));
    // Previously unchecked, so a failed media insert left a product with no images while the
    // confirm still reported success.
    if (mediaError) throw new Error(`Product saved but its images could not be attached: ${mediaError.message}`);
  }

  // Specifications, synced like media: replaced on every commit so re-confirming picks up
  // supplier changes and edits without duplicating rows.
  if (staged.attributes.length > 0) {
    await supabase.from("product_specs").delete().eq("product_id", productId);
    const { error: specsError } = await supabase.from("product_specs").insert(
      staged.attributes.map((attr, position) => ({
        product_id: productId,
        group: "Specifications",
        label: attr.name,
        value: attr.value,
        position,
      })),
    );
    if (specsError) throw new Error(`Product saved but its specifications could not be attached: ${specsError.message}`);
  }

  if (staged.categoryId) {
    await supabase
      .from("product_categories")
      .upsert({ product_id: productId, category_id: staged.categoryId }, { onConflict: "product_id,category_id" });
  }

  // Every new product joins New Arrivals, whatever its main category — it ages out on its own
  // after NEW_ARRIVALS_DAYS (see lib/newArrivals.ts).
  if (isNewProduct) await linkToNewArrivals(supabase, params.tenantId, productId);

  await supabase.from("fulfillment_logs").insert({
    tenant_id: params.tenantId,
    variant_id: variantIds[0] ?? null,
    event: "product_imported",
    detail: {
      aliexpressProductId: staged.aliexpressProductId,
      handle,
      isNewProduct,
      categoryId: staged.categoryId,
      stagedId: staged.id,
    },
  });

  return { productId, handle, isNewProduct, variantIds };
}
