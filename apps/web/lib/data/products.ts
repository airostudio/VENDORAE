import "server-only";
import { db, getTenantId } from "./client";
import { NEW_ARRIVALS_HANDLE, newArrivalsCutoffIso } from "../newArrivals";
import { isDisplayableImageUrl } from "../import/imageUrls";
import type { ProductDetail, ProductSpecGroup, ProductSummary, ProductType, ProductVariantSummary } from "../types";

const PRODUCT_TYPE_MAP: Record<string, ProductType> = {
  STANDARD: "standard",
  ACCESSORY: "accessory",
  CARE_PRODUCT: "care_product",
  BUNDLE: "bundle",
  GIFT_CARD: "bundle", // no dedicated storefront treatment yet — renders like a bundle
};

interface ProductRow {
  id: string;
  handle: string;
  title: string;
  product_type: string;
  short_description: string | null;
  description: string | null;
  stock_policy: string;
  care_instructions: string | null;
  warranty_details: string | null;
  warranty_months: number | null;
  production_days: number | null;
  dispatch_days: number | null;
  is_indexable: boolean;
}

const PRODUCT_COLUMNS =
  "id, handle, title, product_type, short_description, description, stock_policy, care_instructions, warranty_details, warranty_months, production_days, dispatch_days, is_indexable";

interface Hydrated {
  variantByProduct: Map<string, { priceCents: number; compareAtCents?: number; currency: string }>;
  mediaByProduct: Map<string, { url: string; alt: string | null }[]>;
  categoryHandlesByProduct: Map<string, string[]>;
  stockOnHandByProduct: Map<string, number>;
  ratingByProduct: Map<string, { avg: number; count: number }>;
}

async function hydrate(productIds: string[]): Promise<Hydrated> {
  const empty: Hydrated = {
    variantByProduct: new Map(),
    mediaByProduct: new Map(),
    categoryHandlesByProduct: new Map(),
    stockOnHandByProduct: new Map(),
    ratingByProduct: new Map(),
  };
  if (productIds.length === 0) return empty;

  const supabase = db();
  const [variantsRes, mediaRes, catLinksRes, reviewsRes] = await Promise.all([
    supabase.from("product_variants").select("id, product_id, price, compare_at, currency, is_active").in("product_id", productIds),
    supabase.from("product_media").select("product_id, url, alt, position").in("product_id", productIds).order("position"),
    supabase.from("product_categories").select("product_id, categories(handle)").in("product_id", productIds),
    supabase.from("reviews").select("product_id, rating").in("product_id", productIds).eq("is_approved", true),
  ]);

  const variantRows = (variantsRes.data ?? []) as { id: string; product_id: string; price: number; compare_at: number | null; currency: string; is_active: boolean }[];
  for (const productId of productIds) {
    const candidates = variantRows.filter((v) => v.product_id === productId && v.is_active);
    const pool = candidates.length > 0 ? candidates : variantRows.filter((v) => v.product_id === productId);
    if (pool.length === 0) continue;
    const cheapest = pool.reduce((min, v) => (v.price < min.price ? v : min), pool[0]);
    empty.variantByProduct.set(productId, {
      priceCents: cheapest.price,
      compareAtCents: cheapest.compare_at ?? undefined,
      currency: cheapest.currency,
    });
  }

  const variantIds = variantRows.map((v) => v.id);
  if (variantIds.length > 0) {
    const { data: invRows } = await supabase.from("inventory_items").select("variant_id, stock_on_hand").in("variant_id", variantIds);
    const stockByVariant = new Map(((invRows ?? []) as { variant_id: string; stock_on_hand: number }[]).map((r) => [r.variant_id, r.stock_on_hand]));
    for (const v of variantRows) {
      const stock = stockByVariant.get(v.id) ?? 0;
      empty.stockOnHandByProduct.set(v.product_id, (empty.stockOnHandByProduct.get(v.product_id) ?? 0) + stock);
    }
  }

  // Anything the image optimizer would reject is dropped here rather than handed to next/image,
  // which answers INVALID_IMAGE_OPTIMIZE_REQUEST and breaks the whole page. This also covers rows
  // imported before that was validated at write time.
  const mediaRows = ((mediaRes.data ?? []) as { product_id: string; url: string; alt: string | null }[]).filter((row) =>
    isDisplayableImageUrl(row.url),
  );
  for (const row of mediaRows) {
    const list = empty.mediaByProduct.get(row.product_id) ?? [];
    list.push({ url: row.url, alt: row.alt });
    empty.mediaByProduct.set(row.product_id, list);
  }

  const catLinkRows = (catLinksRes.data ?? []) as { product_id: string; categories: { handle: string } | { handle: string }[] | null }[];
  for (const row of catLinkRows) {
    const handles = Array.isArray(row.categories) ? row.categories.map((c) => c.handle) : row.categories ? [row.categories.handle] : [];
    const list = empty.categoryHandlesByProduct.get(row.product_id) ?? [];
    list.push(...handles);
    empty.categoryHandlesByProduct.set(row.product_id, list);
  }

  const reviewRows = (reviewsRes.data ?? []) as { product_id: string; rating: number }[];
  const sums = new Map<string, { sum: number; count: number }>();
  for (const row of reviewRows) {
    const cur = sums.get(row.product_id) ?? { sum: 0, count: 0 };
    cur.sum += row.rating;
    cur.count += 1;
    sums.set(row.product_id, cur);
  }
  for (const [productId, { sum, count }] of sums) empty.ratingByProduct.set(productId, { avg: sum / count, count });

  return empty;
}

function toSummary(row: ProductRow, hydrated: Hydrated): ProductSummary {
  const variant = hydrated.variantByProduct.get(row.id);
  const media = hydrated.mediaByProduct.get(row.id) ?? [];
  const categoryHandles = hydrated.categoryHandlesByProduct.get(row.id) ?? [];
  const rating = hydrated.ratingByProduct.get(row.id);
  const stockOnHand = hydrated.stockOnHandByProduct.get(row.id) ?? 0;

  return {
    id: row.id,
    slug: row.handle,
    title: row.title,
    productType: PRODUCT_TYPE_MAP[row.product_type] ?? "standard",
    categoryHandles,
    priceCents: variant?.priceCents ?? 0,
    compareAtCents: variant?.compareAtCents,
    currency: variant?.currency ?? "USD",
    shortDescription: row.short_description ?? "",
    imageUrl: media[0]?.url ?? "",
    imageAlt: media[0]?.alt ?? row.title,
    isNew: categoryHandles.includes("new-arrivals"),
    isBestSeller: categoryHandles.includes("best-sellers"),
    onSale: categoryHandles.includes("sale") || (variant?.compareAtCents !== undefined && variant.compareAtCents > variant.priceCents),
    readyToShip: row.stock_policy === "IN_STOCK" && stockOnHand > 0,
    rating: rating?.avg,
    reviewCount: rating?.count,
    tags: [],
    isIndexable: row.is_indexable,
  };
}

export async function getAllProducts(): Promise<ProductSummary[]> {
  const tenantId = await getTenantId();
  const { data, error } = await db().from("products").select(PRODUCT_COLUMNS).eq("tenant_id", tenantId).eq("status", "PUBLISHED");
  if (error) throw new Error(`Could not load products: ${error.message}`);
  const rows = (data ?? []) as ProductRow[];
  const hydrated = await hydrate(rows.map((r) => r.id));
  return rows.map((r) => toSummary(r, hydrated));
}

/** Admin views need drafts too (the WooCommerce importer lands everything as DRAFT for review) — no status filter. */
export interface AdminProductSummary extends ProductSummary {
  status: string;
  /**
   * The categories a customer could browse to this product through — everything except New
   * Arrivals, which every product joins on creation and leaves after NEW_ARRIVALS_DAYS, so it
   * says nothing about where the product actually lives. Includes a subcategory's parent even
   * when the product has no link of its own to it — `implied` marks those. See
   * mainCategoriesByProduct.
   */
  mainCategories: { id: string; name: string; implied?: boolean }[];
}

/**
 * Main-category memberships for a set of products, keyed by product id. See AdminProductSummary.
 *
 * A product tagged only under a subcategory (Vibrators) shows its parent (Adult Toys) here too,
 * by default — matching what a customer actually sees, since the storefront's parent category
 * page rolls up its children's products (see getProductsByCategory). The parent entry is
 * `implied: true` and never becomes a real product_categories row: showing it is purely a display
 * default, not an assignment, so a product doesn't end up doubly filed just because its
 * subcategory has a parent.
 */
async function mainCategoriesByProduct(
  productIds: string[],
): Promise<Map<string, { id: string; name: string; implied?: boolean }[]>> {
  const byProduct = new Map<string, { id: string; name: string; implied?: boolean }[]>();
  if (productIds.length === 0) return byProduct;

  const supabase = db();
  const tenantId = await getTenantId();

  const [{ data: links }, { data: allCategories }] = await Promise.all([
    supabase.from("product_categories").select("product_id, category_id").in("product_id", productIds),
    supabase.from("categories").select("id, name, handle, parent_id").eq("tenant_id", tenantId),
  ]);

  interface CategoryRow2 {
    id: string;
    name: string;
    handle: string;
    parent_id: string | null;
  }
  const categoryById = new Map(((allCategories ?? []) as CategoryRow2[]).map((c) => [c.id, c]));

  for (const link of (links ?? []) as { product_id: string; category_id: string }[]) {
    const category = categoryById.get(link.category_id);
    if (!category || category.handle === NEW_ARRIVALS_HANDLE) continue;

    const list = byProduct.get(link.product_id) ?? [];
    const parent = category.parent_id ? categoryById.get(category.parent_id) : undefined;
    // Parent first, so it reads as a breadcrumb (Adult Toys, Vibrators) rather than backwards.
    if (parent && parent.handle !== NEW_ARRIVALS_HANDLE && !list.some((c) => c.id === parent.id)) {
      list.push({ id: parent.id, name: parent.name, implied: true });
    }
    if (!list.some((c) => c.id === category.id)) list.push({ id: category.id, name: category.name });
    byProduct.set(link.product_id, list);
  }
  return byProduct;
}

export async function getAllProductsForAdmin(): Promise<AdminProductSummary[]> {
  const tenantId = await getTenantId();
  // Newest first, explicitly: without an ORDER BY, Postgres returns rows in arbitrary order and
  // PostgREST caps the response at its default page size — so a just-created product could be
  // missing from this list entirely on a catalogue of any size.
  const { data, error } = await db()
    .from("products")
    .select(`${PRODUCT_COLUMNS}, status`)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(`Could not load products: ${error.message}`);
  const rows = (data ?? []) as (ProductRow & { status: string })[];
  const ids = rows.map((r) => r.id);
  const [hydrated, categoriesByProduct] = await Promise.all([hydrate(ids), mainCategoriesByProduct(ids)]);
  return rows.map((r) => ({
    ...toSummary(r, hydrated),
    status: r.status,
    mainCategories: categoriesByProduct.get(r.id) ?? [],
  }));
}

export async function getProductsBySlugs(slugs: string[]): Promise<ProductSummary[]> {
  if (slugs.length === 0) return [];
  const tenantId = await getTenantId();
  const { data, error } = await db().from("products").select(PRODUCT_COLUMNS).eq("tenant_id", tenantId).eq("status", "PUBLISHED").in("handle", slugs);
  if (error) throw new Error(`Could not load products: ${error.message}`);
  const rows = (data ?? []) as ProductRow[];
  const hydrated = await hydrate(rows.map((r) => r.id));
  return rows.map((r) => toSummary(r, hydrated));
}

/**
 * Real (server-side, database) search rather than the client-side filter /product-finder runs
 * over an already-fetched product list — this queries only matching rows, so it stays cheap as
 * the catalogue grows instead of shipping every product to the browser to filter.
 *
 * No full-text-search column exists yet (no tsvector/GIN index in the schema), so this is
 * ILIKE substring matching, issued as two separate queries (title, then description) rather than
 * one `.or()` filter — building an `.or()` condition string by hand from unescaped user input
 * risks a malformed or unintended filter if the query contains a comma or parenthesis, which
 * `.or()`'s mini-syntax treats specially. Title matches are ranked first by concatenation order,
 * which is simple but good enough without a real ranking function.
 */
export async function searchProducts(query: string, limit = 24): Promise<ProductSummary[]> {
  const q = query.trim();
  if (q.length === 0) return [];

  const tenantId = await getTenantId();
  const supabase = db();
  // Escape LIKE's own wildcard characters so a query containing "%" or "_" is matched literally,
  // not as a pattern the searcher didn't intend.
  const escaped = q.replace(/[%_\\]/g, (m) => `\\${m}`);
  const pattern = `%${escaped}%`;

  const [{ data: titleRows, error: titleError }, { data: descRows, error: descError }] = await Promise.all([
    supabase.from("products").select(PRODUCT_COLUMNS).eq("tenant_id", tenantId).eq("status", "PUBLISHED").ilike("title", pattern).limit(limit),
    supabase.from("products").select(PRODUCT_COLUMNS).eq("tenant_id", tenantId).eq("status", "PUBLISHED").ilike("short_description", pattern).limit(limit),
  ]);
  if (titleError) throw new Error(`Could not search products: ${titleError.message}`);
  if (descError) throw new Error(`Could not search products: ${descError.message}`);

  const seen = new Set<string>();
  const rows: ProductRow[] = [];
  for (const row of [...((titleRows ?? []) as ProductRow[]), ...((descRows ?? []) as ProductRow[])]) {
    if (seen.has(row.id) || rows.length >= limit) continue;
    seen.add(row.id);
    rows.push(row);
  }

  const hydrated = await hydrate(rows.map((r) => r.id));
  return rows.map((r) => toSummary(r, hydrated));
}

export async function getProductsByCategory(handle: string): Promise<ProductSummary[]> {
  const tenantId = await getTenantId();
  const supabase = db();
  const { data: category } = await supabase.from("categories").select("id").eq("tenant_id", tenantId).eq("handle", handle).maybeSingle();
  if (!category) return [];

  // A parent category's page also shows everything filed under its subcategories, so visiting
  // "Adult Toys" isn't an empty shell when every product is actually tagged under "Vibrators" —
  // the nav (getNavCategories) already keeps Adult Toys listed on exactly that basis.
  const { data: children } = await supabase.from("categories").select("id").eq("tenant_id", tenantId).eq("parent_id", category.id);
  const categoryIds = [category.id, ...((children ?? []) as { id: string }[]).map((c) => c.id)];

  let query = supabase
    .from("products")
    .select(`${PRODUCT_COLUMNS}, product_categories!inner(category_id)`)
    .eq("tenant_id", tenantId)
    .eq("status", "PUBLISHED")
    .in("product_categories.category_id", categoryIds);

  // New Arrivals is time-boxed: a product belongs to it for NEW_ARRIVALS_DAYS after it was
  // created, and the cutoff is applied here rather than waited out by a job, so the listing is
  // right the instant a product ages out even if the housekeeping sweep hasn't run.
  if (handle === NEW_ARRIVALS_HANDLE) query = query.gte("created_at", newArrivalsCutoffIso());

  const { data, error } = await query;
  if (error) throw new Error(`Could not load products for category "${handle}": ${error.message}`);

  // A product filed under both the parent and one of its children joins twice with more than one
  // id in the filter — de-duplicated by id rather than avoided upstream, since collapsing it to
  // one row is simpler than trying to make the join itself not produce the second one.
  const seen = new Set<string>();
  const rows = ((data ?? []) as ProductRow[]).filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  const hydrated = await hydrate(rows.map((r) => r.id));
  return rows.map((r) => toSummary(r, hydrated));
}

export interface ProductNeedingCategory {
  id: string;
  title: string;
  handle: string;
}

/**
 * Products whose only category is New Arrivals, or which have none at all.
 *
 * These are the ones that quietly disappear from browsing when they age out of New Arrivals after
 * NEW_ARRIVALS_DAYS: still published, still buyable by direct link, but in no category anyone can
 * navigate to. The admin needs to pick a main category for them before that happens, so this backs
 * an alert rather than being left to be discovered later.
 */
export async function getProductsWithoutMainCategory(): Promise<ProductNeedingCategory[]> {
  const tenantId = await getTenantId();
  const supabase = db();

  const { data: products, error } = await supabase
    .from("products")
    .select("id, title, handle")
    .eq("tenant_id", tenantId)
    .neq("status", "ARCHIVED");
  if (error) throw new Error(`Could not load products: ${error.message}`);
  const rows = (products ?? []) as ProductNeedingCategory[];
  if (rows.length === 0) return [];

  const { data: newArrivals } = await supabase
    .from("categories")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("handle", NEW_ARRIVALS_HANDLE)
    .maybeSingle();
  const newArrivalsId = newArrivals?.id as string | undefined;

  const { data: links } = await supabase
    .from("product_categories")
    .select("product_id, category_id")
    .in(
      "product_id",
      rows.map((r) => r.id),
    );

  const mainCategoryCount = new Map<string, number>();
  for (const link of ((links ?? []) as { product_id: string; category_id: string }[])) {
    if (link.category_id === newArrivalsId) continue;
    mainCategoryCount.set(link.product_id, (mainCategoryCount.get(link.product_id) ?? 0) + 1);
  }

  return rows.filter((r) => (mainCategoryCount.get(r.id) ?? 0) === 0);
}

const GENERIC_WHATS_INCLUDED = ["Product", "Care instructions"];
const GENERIC_CARE_SUMMARY =
  "Hand wash or use a gentle cycle in cool water with a mild, fragrance-free detergent. Air dry out of direct sunlight before storage.";
const GENERIC_FAQS = [
  {
    q: "How is my order packaged?",
    a: "Every order ships in simple, unmarked packaging designed to keep your pieces in the same condition they left our workshop.",
  },
  {
    q: "What is your return policy?",
    a: "Unworn, unwashed items in original packaging are eligible for return within the window shown at checkout — see our Returns guide for details.",
  },
];

function deliverySummary(row: ProductRow): string {
  if (row.stock_policy === "MADE_TO_ORDER") {
    const days = row.production_days ?? 5;
    return `Made to order. Production time ${Math.max(1, days - 2)}–${days + 2} days, then standard delivery.`;
  }
  const dispatch = row.dispatch_days ?? 2;
  return `Ships within ${dispatch} business day${dispatch === 1 ? "" : "s"}.`;
}

function warrantySummary(row: ProductRow): string {
  if (row.warranty_details) return row.warranty_details;
  const months = row.warranty_months ?? 3;
  return `${months}-month limited warranty against manufacturing defects.`;
}

export async function getProductBySlug(slug: string): Promise<ProductDetail | undefined> {
  const tenantId = await getTenantId();
  const supabase = db();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("status", "PUBLISHED")
    .eq("handle", slug)
    .maybeSingle();
  if (error) throw new Error(`Could not load product "${slug}": ${error.message}`);
  if (!data) return undefined;
  const row = data as ProductRow;

  const [hydrated, specsRes, gallery, linksRes, variantsRes] = await Promise.all([
    hydrate([row.id]),
    supabase.from("product_specs").select("group, label, value, position").eq("product_id", row.id).order("position"),
    supabase.from("product_media").select("url, alt, position").eq("product_id", row.id).order("position"),
    supabase.from("compatibility_links").select("to_product_id, relation_type").eq("from_product_id", row.id),
    supabase
      .from("product_variants")
      .select("id, title, sku, price, compare_at, currency, is_active, option1_name, option1_value, option2_name, option2_value, option3_name, option3_value")
      .eq("product_id", row.id)
      .order("price"),
  ]);

  interface VariantRow {
    id: string;
    title: string | null;
    sku: string | null;
    price: number;
    compare_at: number | null;
    currency: string;
    is_active: boolean;
    option1_name: string | null;
    option1_value: string | null;
    option2_name: string | null;
    option2_value: string | null;
    option3_name: string | null;
    option3_value: string | null;
  }
  const variantRows = (variantsRes.data ?? []) as VariantRow[];
  const variantIds = variantRows.map((v) => v.id);
  const { data: stockRows } = variantIds.length
    ? await supabase.from("inventory_items").select("variant_id, stock_on_hand").in("variant_id", variantIds)
    : { data: [] as { variant_id: string; stock_on_hand: number }[] };
  const stockByVariant = new Map(
    ((stockRows ?? []) as { variant_id: string; stock_on_hand: number }[]).map((r) => [r.variant_id, r.stock_on_hand]),
  );

  const variants: ProductVariantSummary[] = variantRows.map((v) => ({
    id: v.id,
    title: v.title,
    sku: v.sku,
    priceCents: v.price,
    compareAtCents: v.compare_at ?? undefined,
    currency: v.currency,
    options: [
      [v.option1_name, v.option1_value],
      [v.option2_name, v.option2_value],
      [v.option3_name, v.option3_value],
    ]
      .filter(([, value]) => Boolean(value))
      .map(([name, value]) => ({ name: name ?? "Option", value: value as string })),
    inStock: v.is_active && (stockByVariant.get(v.id) ?? 0) > 0,
  }));

  const summary = toSummary(row, hydrated);

  const specRows = (specsRes.data ?? []) as { group: string; label: string; value: string }[];
  const specGroups: ProductSpecGroup[] = [];
  for (const s of specRows) {
    let group = specGroups.find((g) => g.group === s.group);
    if (!group) {
      group = { group: s.group, items: [] };
      specGroups.push(group);
    }
    group.items.push({ label: s.label, value: s.value });
  }

  const galleryRows = (gallery.data ?? []) as { url: string; alt: string | null }[];

  const linkRows = (linksRes.data ?? []) as { to_product_id: string; relation_type: string }[];
  const accessoryProductIds = linkRows
    .filter((l) => ["compatible_accessory", "care_product"].includes(l.relation_type))
    .map((l) => l.to_product_id);
  let compatibleAccessorySlugs: string[] = [];
  if (accessoryProductIds.length > 0) {
    const { data: accProducts } = await supabase.from("products").select("handle").in("id", accessoryProductIds).eq("status", "PUBLISHED");
    compatibleAccessorySlugs = ((accProducts ?? []) as { handle: string }[]).map((p) => p.handle);
  }

  // No explicit "related products" relation in the schema — fall back to
  // other published products sharing at least one of this product's categories.
  let relatedSlugs: string[] = [];
  if (summary.categoryHandles.length > 0) {
    const { data: catRows } = await supabase.from("categories").select("id").eq("tenant_id", tenantId).in("handle", summary.categoryHandles);
    const categoryIds = ((catRows ?? []) as { id: string }[]).map((c) => c.id);
    if (categoryIds.length > 0) {
      const { data: related } = await supabase
        .from("products")
        .select("handle, product_categories!inner(category_id)")
        .eq("tenant_id", tenantId)
        .eq("status", "PUBLISHED")
        .neq("id", row.id)
        .in("product_categories.category_id", categoryIds)
        .limit(4);
      relatedSlugs = [...new Set(((related ?? []) as { handle: string }[]).map((p) => p.handle))];
    }
  }

  return {
    ...summary,
    variants,
    gallery: galleryRows.length > 0 ? galleryRows.map((g) => ({ url: g.url, alt: g.alt ?? summary.title })) : [{ url: summary.imageUrl, alt: summary.imageAlt }],
    description: row.description ?? summary.shortDescription,
    specGroups,
    whatsIncluded: GENERIC_WHATS_INCLUDED,
    careSummary: row.care_instructions ?? GENERIC_CARE_SUMMARY,
    deliverySummary: deliverySummary(row),
    warrantySummary: warrantySummary(row),
    faqs: GENERIC_FAQS,
    compatibleAccessorySlugs,
    relatedSlugs,
  };
}
