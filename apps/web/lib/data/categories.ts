import "server-only";
import { db, getTenantId } from "./client";
import type { Category } from "../types";
import { NEW_ARRIVALS_HANDLE, newArrivalsCutoffIso } from "../newArrivals";
import { isDisplayableImageUrl } from "../import/imageUrls";

interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  handle: string;
  description: string | null;
  hero_image_url: string | null;
}

function rowToCategory(row: CategoryRow, handleById: Map<string, string>): Category {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    description: row.description ?? undefined,
    heroImageUrl: row.hero_image_url ?? undefined,
    parentHandle: row.parent_id ? handleById.get(row.parent_id) : undefined,
  };
}

export async function getCategories(): Promise<Category[]> {
  const tenantId = await getTenantId();
  const { data, error } = await db()
    .from("categories")
    .select("id, parent_id, name, handle, description, hero_image_url")
    .eq("tenant_id", tenantId)
    .eq("is_hidden", false)
    .order("position");
  if (error) throw new Error(`Could not load categories: ${error.message}`);

  const rows = (data ?? []) as CategoryRow[];
  const handleById = new Map(rows.map((r) => [r.id, r.handle]));
  return rows.map((r) => rowToCategory(r, handleById));
}

export async function getCategoryTree() {
  const categories = await getCategories();
  const top = categories.filter((c) => !c.parentHandle);
  return top.map((c) => ({ ...c, children: categories.filter((s) => s.parentHandle === c.handle) }));
}

export async function getCategoryByHandle(handle: string): Promise<Category | undefined> {
  const categories = await getCategories();
  return categories.find((c) => c.handle === handle);
}

export interface FeatureCategory extends Category {
  /** The newest published product's main image, falling back to the category's own hero image. */
  imageUrl?: string;
  productCount: number;
}

/**
 * Categories that have something to show, with a count and a representative image.
 *
 * "Has something to show" means at least one published product a customer could actually reach by
 * clicking through. New Arrivals is counted against its own cutoff (see lib/newArrivals.ts)
 * rather than its stored links, so it can't advertise itself while everything in it has aged out
 * and the listing behind it is empty.
 */
async function getCategoriesWithProducts(): Promise<FeatureCategory[]> {
  const tenantId = await getTenantId();
  const supabase = db();
  const categories = await getCategories();
  if (categories.length === 0) return [];

  const categoryIds = categories.map((c) => c.id);

  const { data: links } = await supabase
    .from("product_categories")
    .select("category_id, products!inner(id, created_at, status, tenant_id)")
    .in("category_id", categoryIds)
    .eq("products.tenant_id", tenantId)
    .eq("products.status", "PUBLISHED");

  interface LinkRow {
    category_id: string;
    products: { id: string; created_at: string } | { id: string; created_at: string }[];
  }
  const newArrivalsId = categories.find((c) => c.handle === NEW_ARRIVALS_HANDLE)?.id;
  const cutoff = newArrivalsCutoffIso();

  const newestByCategory = new Map<string, { id: string; created_at: string }>();
  const countByCategory = new Map<string, number>();
  for (const link of (links ?? []) as unknown as LinkRow[]) {
    const product = Array.isArray(link.products) ? link.products[0] : link.products;
    if (!product) continue;
    // A product past the cutoff is no longer in New Arrivals as far as the listing is concerned,
    // so it mustn't keep that category looking populated here either.
    if (link.category_id === newArrivalsId && product.created_at < cutoff) continue;
    countByCategory.set(link.category_id, (countByCategory.get(link.category_id) ?? 0) + 1);
    const current = newestByCategory.get(link.category_id);
    if (!current || product.created_at > current.created_at) newestByCategory.set(link.category_id, product);
  }

  const newestProductIds = [...newestByCategory.values()].map((p) => p.id);
  const imageByProduct = new Map<string, string>();
  if (newestProductIds.length > 0) {
    const { data: media } = await supabase
      .from("product_media")
      .select("product_id, url, position")
      .in("product_id", newestProductIds)
      .order("position");
    for (const row of (media ?? []) as { product_id: string; url: string }[]) {
      if (!imageByProduct.has(row.product_id) && isDisplayableImageUrl(row.url)) imageByProduct.set(row.product_id, row.url);
    }
  }

  return categories
    .filter((c) => (countByCategory.get(c.id) ?? 0) > 0)
    .map((c) => {
      const newest = newestByCategory.get(c.id);
      return {
        ...c,
        imageUrl: (newest ? imageByProduct.get(newest.id) : undefined) ?? c.heroImageUrl,
        productCount: countByCategory.get(c.id) ?? 0,
      };
    });
}

/**
 * Categories for the home page, built from what's actually in the database rather than a
 * hardcoded list — so adding a category (or the first product in one) shows up on the front page
 * with no code change. Each card's image is the newest published product's main image, keeping
 * the front page reflecting current stock instead of a fixed hero shot.
 */
export async function getFeatureCategories(limit = 6): Promise<FeatureCategory[]> {
  return (await getCategoriesWithProducts()).slice(0, limit);
}

export interface NavCategory {
  id: string;
  handle: string;
  name: string;
  children: { id: string; handle: string; name: string }[];
}

/**
 * Two-tier category tree for the site navigation — a top-level entry (Adult Toys) with its
 * subcategories (Vibrators) nested under it, e.g. for a dropdown menu.
 *
 * An empty category is left out entirely: a menu item leading to "no products match" is worse
 * than one fewer menu item, and it's how a store ends up advertising a section it doesn't stock.
 * A parent is kept, though, as soon as any one of its children has something to show — Adult Toys
 * belongs in the menu the moment Vibrators has its first published product, even if nothing is
 * filed directly under Adult Toys itself (visiting it rolls up every child's products; see
 * getProductsByCategory). The flip side is the point of this — a category becomes visible the
 * moment it has its first published product, without anyone editing the header.
 */
export async function getNavCategories(limit = 6): Promise<NavCategory[]> {
  // Never throws: the root layout renders this, so an error here would take down every page on
  // the site rather than one. A store with an unreachable database should still serve a header
  // with Shop and Guides in it.
  try {
    const withProducts = await getCategoriesWithProducts();
    const top = withProducts.filter((c) => !c.parentHandle);
    return top
      .map((c) => ({
        id: c.id,
        handle: c.handle,
        name: c.name,
        children: withProducts
          .filter((child) => child.parentHandle === c.handle)
          .map((child) => ({ id: child.id, handle: child.handle, name: child.name })),
      }))
      .filter((c) => c.children.length > 0 || (withProducts.find((w) => w.handle === c.handle)?.productCount ?? 0) > 0)
      .slice(0, limit);
  } catch (error) {
    console.error(`[nav] could not load categories: ${error instanceof Error ? error.message : error}`);
    return [];
  }
}
