import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { importProduct } from "@/lib/dropshipEngine";
import { categorizeProduct } from "@/lib/import/categorize";
import { nameOptions } from "@/lib/import/optionNames";

export interface SkuOption {
  name: string | null;
  value: string;
  imageUrl?: string | null;
}

export interface ProductAttribute {
  name: string;
  value: string;
}

export interface StagedSku {
  aliexpressSkuId: string;
  properties: string | null;
  /** Variant options as name/value pairs, so the product gets real option1_name/option1_value. */
  options?: SkuOption[];
  retailPriceCents: number;
  compareAtCents: number | null;
  supplierCostCents: number;
  marginRate: number;
  stockOnHand: number;
  isActive: boolean;
}

export interface StagedProduct {
  id: string;
  aliexpressProductId: string;
  sourceUrl: string | null;
  status: "ready" | "failed" | "confirmed";
  error: string | null;
  title: string;
  shortDescription: string;
  description: string;
  seoTitle: string | null;
  seoDesc: string | null;
  categoryId: string | null;
  suggestedCategoryId: string | null;
  publish: boolean;
  productType: string;
  brand: string | null;
  currencyCode: string;
  imageUrls: string[];
  skus: StagedSku[];
  /** Shipping weight from AliExpress, in grams — written to the product so shipping can be rated. */
  packageWeightGrams: number | null;
  /** The supplier's spec table, editable before it becomes product_specs rows. */
  attributes: ProductAttribute[];
  confirmedProductId: string | null;
  createdAt: string;
}

const SELECT_COLUMNS =
  "id, aliexpress_product_id, source_url, status, error, title, short_description, description, seo_title, seo_desc, " +
  "category_id, suggested_category_id, publish, product_type, brand, currency_code, image_urls, skus, " +
  "package_weight_grams, attributes, confirmed_product_id, created_at";

export function rowToStagedProduct(row: Record<string, unknown>): StagedProduct {
  return {
    id: row.id as string,
    aliexpressProductId: row.aliexpress_product_id as string,
    sourceUrl: (row.source_url as string | null) ?? null,
    status: row.status as StagedProduct["status"],
    error: (row.error as string | null) ?? null,
    title: (row.title as string | null) ?? "",
    shortDescription: (row.short_description as string | null) ?? "",
    description: (row.description as string | null) ?? "",
    seoTitle: (row.seo_title as string | null) ?? null,
    seoDesc: (row.seo_desc as string | null) ?? null,
    categoryId: (row.category_id as string | null) ?? null,
    suggestedCategoryId: (row.suggested_category_id as string | null) ?? null,
    publish: Boolean(row.publish),
    productType: (row.product_type as string) ?? "STANDARD",
    brand: (row.brand as string | null) ?? null,
    currencyCode: (row.currency_code as string | null) ?? "USD",
    imageUrls: (row.image_urls as string[] | null) ?? [],
    skus: (row.skus as StagedSku[] | null) ?? [],
    packageWeightGrams: (row.package_weight_grams as number | null) ?? null,
    attributes: (row.attributes as ProductAttribute[] | null) ?? [],
    confirmedProductId: (row.confirmed_product_id as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

/** First paragraph of the rewritten description, as a sensible default short description. */
function deriveShortDescription(description: string): string {
  const firstBlock = description.split("\n\n")[0] ?? "";
  return firstBlock.split("\n").slice(1).join(" ").trim().slice(0, 300) || firstBlock.trim().slice(0, 300);
}

export async function listStagedProducts(supabase: SupabaseClient, tenantId: string): Promise<StagedProduct[]> {
  const { data, error } = await supabase
    .from("aliexpress_staged_products")
    .select(SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .neq("status", "confirmed")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load the staging queue: ${error.message}`);
  return (data ?? []).map((row) => rowToStagedProduct(row as unknown as Record<string, unknown>));
}

export async function getStagedProduct(supabase: SupabaseClient, tenantId: string, id: string): Promise<StagedProduct | null> {
  const { data, error } = await supabase
    .from("aliexpress_staged_products")
    .select(SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load staged product: ${error.message}`);
  return data ? rowToStagedProduct(data as unknown as Record<string, unknown>) : null;
}

/**
 * Fetches one AliExpress product through the engine (which applies this store's pricing rule and,
 * when ANTHROPIC_API_KEY is set, AI-rewrites the title/description), suggests a category, and parks
 * the result in the staging queue. Writes nothing to `products` — that only happens on confirm.
 *
 * A fetch failure is persisted as a `failed` row rather than thrown, so one dead link in a pasted
 * batch of twenty doesn't lose the other nineteen and the admin can see exactly which one broke.
 */
export async function stageProduct(
  supabase: SupabaseClient,
  tenantId: string,
  params: { aliexpressProductId: string; sourceUrl?: string | null },
): Promise<StagedProduct> {
  let imported;
  try {
    imported = await importProduct({ aliexpressProductId: params.aliexpressProductId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AliExpress fetch failed";
    return upsertStagedRow(supabase, tenantId, {
      aliexpress_product_id: params.aliexpressProductId,
      source_url: params.sourceUrl ?? null,
      status: "failed",
      error: message,
    });
  }

  const category = await categorizeProduct(supabase, tenantId, {
    title: imported.onBrandName,
    description: imported.description,
  });

  // AliExpress names options inconsistently; infer a name for any position it left blank so the
  // storefront picker has a real label instead of "Option 1".
  const skus: StagedSku[] = nameOptions(imported.skus.map((sku) => ({
    aliexpressSkuId: sku.aliexpressSkuId,
    properties: sku.properties,
    retailPriceCents: sku.retailPriceCents,
    compareAtCents: null,
    supplierCostCents: sku.supplierCostCents,
    marginRate: sku.marginRate,
    stockOnHand: sku.stockOnHand,
    isActive: sku.stockOnHand > 0,
    options: sku.options ?? [],
  })));

  return upsertStagedRow(supabase, tenantId, {
    aliexpress_product_id: imported.aliexpressProductId,
    source_url: params.sourceUrl ?? null,
    status: "ready",
    error: null,
    title: imported.onBrandName,
    short_description: deriveShortDescription(imported.description),
    description: imported.description,
    category_id: category?.categoryId ?? null,
    suggested_category_id: category?.categoryId ?? null,
    currency_code: imported.currencyCode,
    image_urls: imported.imageUrls,
    skus,
    package_weight_grams: imported.packageWeightGrams ?? null,
    attributes: imported.attributes ?? [],
    raw: imported,
  });
}

async function upsertStagedRow(
  supabase: SupabaseClient,
  tenantId: string,
  values: Record<string, unknown>,
): Promise<StagedProduct> {
  // Re-staging a product that's already queued refreshes it in place rather than
  // creating a duplicate card (matches the partial unique index in migration 0003).
  const { data: existing } = await supabase
    .from("aliexpress_staged_products")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("aliexpress_product_id", values.aliexpress_product_id as string)
    .neq("status", "confirmed")
    .maybeSingle();

  // New rows publish on confirm. The staging queue IS the review gate — a product reaching it has
  // been fetched, priced and rewritten, and confirming is the deliberate "put this in my store"
  // step — so landing it as a DRAFT nothing shows meant onboarding silently produced an invisible
  // product. The editor's publish toggle still allows staging without publishing, and is only
  // defaulted here on insert so re-staging never overrides a choice already made on the row.
  const query = existing
    ? supabase.from("aliexpress_staged_products").update(values).eq("id", existing.id as string)
    : supabase.from("aliexpress_staged_products").insert({ publish: true, ...values, tenant_id: tenantId });

  const { data, error } = await query.select(SELECT_COLUMNS).single();
  if (error || !data) throw new Error(`Could not stage product: ${error?.message}`);
  const staged = rowToStagedProduct(data as unknown as Record<string, unknown>);

  // Read the row back through exactly the filter the staging queue lists with (tenant +
  // not-confirmed). The write above can succeed and still leave nothing for the admin to find —
  // e.g. if it landed under a different tenant than the one being viewed — and reporting
  // "staged" for a row the queue can't see is what makes this fail silently. Better to fail the
  // request loudly, naming the tenant, than to claim a success the next screen contradicts.
  const { data: visible, error: verifyError } = await supabase
    .from("aliexpress_staged_products")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", staged.id)
    .neq("status", "confirmed")
    .maybeSingle();
  if (verifyError) throw new Error(`Staged product ${staged.id} could not be verified: ${verifyError.message}`);
  if (!visible) {
    throw new Error(
      `Staged product ${staged.id} was written but is not visible in the staging queue for tenant ${tenantId} — ` +
        `it will not appear for review. Check that this deployment's DEFAULT_TENANT_SLUG matches the tenant the queue reads.`,
    );
  }

  return staged;
}
