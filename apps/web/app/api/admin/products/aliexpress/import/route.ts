import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";
import { categorizeProduct } from "@/lib/import/categorize";
import { createMapping, importProduct } from "@/lib/dropshipEngine";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  productId: z.string().min(1),
  tenant: z.string().optional(),
  publish: z.boolean().optional(),
});

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Imports a single AliExpress product via the dropship-engine (see
 * /dropship-engine's README): the engine fetches the live listing, applies
 * this store's pricing rule and brand voice, and returns priced, on-brand
 * data. This route's only job is writing that into Beach Footprints' own
 * products/product_variants tables and registering the mapping back with
 * the engine — the engine never touches this database directly.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = createServiceRoleSupabaseClient();
  const tenantId = await resolveTenantId(supabase, parsed.data.tenant);

  try {
    const imported = await importProduct({ aliexpressProductId: parsed.data.productId });

    const { data: existingVariant } = await supabase
      .from("product_variants")
      .select("product_id")
      .eq("supplier", "dropship-engine")
      .eq("supplier_product_id", imported.aliexpressProductId)
      .limit(1)
      .maybeSingle();

    let productId: string;
    let handle: string;
    let isNewProduct = false;

    if (existingVariant) {
      productId = existingVariant.product_id as string;
      const { data: existingProduct } = await supabase.from("products").select("handle").eq("id", productId).single();
      handle = existingProduct?.handle ?? slugify(imported.onBrandName);
      await supabase.from("products").update({ title: imported.onBrandName, description: imported.description }).eq("id", productId);
    } else {
      isNewProduct = true;
      handle = `${slugify(imported.onBrandName)}-${imported.aliexpressProductId}`;
      const { data: inserted, error } = await supabase
        .from("products")
        .insert({
          tenant_id: tenantId,
          product_type: "STANDARD",
          title: imported.onBrandName,
          handle,
          short_description: imported.description.split("\n\n")[0]?.split("\n").slice(1).join(" ").slice(0, 300),
          description: imported.description,
          status: parsed.data.publish ? "PUBLISHED" : "DRAFT",
          brand: "Beach Footprints",
          shipping_class: "STANDARD",
          stock_policy: "IN_STOCK",
        })
        .select("id")
        .single();
      if (error || !inserted) throw new Error(`Could not create product: ${error?.message}`);
      productId = inserted.id as string;
    }

    const variantIds: string[] = [];
    for (const sku of imported.skus) {
      const { data: upserted, error } = await supabase
        .from("product_variants")
        .upsert(
          {
            product_id: productId,
            title: sku.properties,
            sku: `AE-${sku.aliexpressSkuId}`,
            price: sku.retailPriceCents,
            currency: imported.currencyCode,
            cost: sku.supplierCostCents,
            margin_rate: sku.marginRate,
            supplier: "dropship-engine",
            supplier_product_id: imported.aliexpressProductId,
            supplier_sku_id: sku.aliexpressSkuId,
            supplier_synced_at: new Date().toISOString(),
            is_active: sku.stockOnHand > 0,
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
        aliexpressProductId: imported.aliexpressProductId,
        aliexpressSkuId: sku.aliexpressSkuId,
        onBrandName: imported.onBrandName,
      });
    }

    if (isNewProduct && imported.imageUrls.length > 0) {
      await supabase.from("product_media").insert(imported.imageUrls.map((url, position) => ({ product_id: productId, url, position })));
    }

    // Auto-assign to an existing category, best-effort — never invents a new one, and never
    // overrides a category an admin may have already set by hand on a re-import.
    let categoryHandle: string | null = null;
    if (isNewProduct) {
      const match = await categorizeProduct(supabase, tenantId, { title: imported.onBrandName, description: imported.description });
      if (match) {
        await supabase.from("product_categories").upsert({ product_id: productId, category_id: match.categoryId }, { onConflict: "product_id,category_id" });
        categoryHandle = match.categoryHandle;
      }
    }

    await supabase.from("fulfillment_logs").insert({
      tenant_id: tenantId,
      variant_id: variantIds[0] ?? null,
      event: "product_imported",
      detail: { aliexpressProductId: imported.aliexpressProductId, handle, isNewProduct, categoryHandle },
    });

    return NextResponse.json({ productId, handle, isNewProduct, variantIds, categoryHandle });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AliExpress import failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
