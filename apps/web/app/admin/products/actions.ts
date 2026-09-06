"use server";

import { revalidatePath } from "next/cache";
import { db, getTenantId } from "@/lib/data/client";
import { DEMO_PRODUCT_HANDLES } from "@/lib/data/demoProducts";
import { NEW_ARRIVALS_HANDLE, newArrivalsCutoffIso } from "@/lib/newArrivals";

export async function publishProduct(productId: string): Promise<void> {
  const tenantId = await getTenantId();
  const { error } = await db().from("products").update({ status: "PUBLISHED" }).eq("id", productId).eq("tenant_id", tenantId);
  if (error) throw new Error(`Could not publish product: ${error.message}`);
  revalidatePath("/admin/products");
  revalidatePath("/admin");
  revalidatePath("/shop");
  revalidatePath("/");
}

/**
 * Housekeeping for New Arrivals: drops the category link from every product older than
 * NEW_ARRIVALS_DAYS, so the stored categories match what the storefront shows.
 *
 * Nothing depends on this having run — the New Arrivals listing applies the same cutoff when it
 * reads (see lib/newArrivals.ts), so a product ages out on time whether or not this is ever
 * called. This just stops the link table accumulating memberships that no longer mean anything.
 */
export async function sweepNewArrivals(): Promise<void> {
  const tenantId = await getTenantId();
  const supabase = db();

  const { data: category } = await supabase
    .from("categories")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("handle", NEW_ARRIVALS_HANDLE)
    .maybeSingle();
  const categoryId = category?.id as string | undefined;
  if (!categoryId) return;

  const { data: expired, error: expiredError } = await supabase
    .from("products")
    .select("id")
    .eq("tenant_id", tenantId)
    .lt("created_at", newArrivalsCutoffIso());
  if (expiredError) throw new Error(`Could not find expired new arrivals: ${expiredError.message}`);

  const ids = ((expired ?? []) as { id: string }[]).map((p) => p.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase
      .from("product_categories")
      .delete()
      .eq("category_id", categoryId)
      .in("product_id", ids.slice(i, i + 200));
    if (error) throw new Error(`Could not clear expired new arrivals: ${error.message}`);
  }

  revalidatePath("/admin/products");
  revalidatePath("/shop");
  revalidatePath("/");
}

/**
 * Deletes the eight placeholder products supabase/seed.sql creates, for admins who never ran
 * migrations/0004_remove_demo_seed_products.sql by hand (which is most of them — it's a SQL file
 * you have to know exists). Matched by exact seeded handle, so a real product can't be caught by
 * it; variants, media, category links and inventory go with them via `on delete cascade`.
 */
export async function removeDemoProducts(): Promise<void> {
  const tenantId = await getTenantId();
  const { error } = await db()
    .from("products")
    .delete()
    .eq("tenant_id", tenantId)
    .in("handle", DEMO_PRODUCT_HANDLES as unknown as string[]);
  if (error) throw new Error(`Could not remove the demo products: ${error.message}`);

  revalidatePath("/admin/products");
  revalidatePath("/admin");
  revalidatePath("/shop");
  revalidatePath("/");
}

/**
 * Relabels every variant in the catalogue to one currency code.
 *
 * This RELABELS, it does not convert: there is no FX rate here, so a variant priced 2000 (i.e.
 * A$20.00) becomes US$20.00, not its dollar equivalent. That is deliberate — silently applying an
 * invented rate to real prices would be worse than making the admin re-price. Use it to make a
 * catalogue single-currency (checkout refuses a cart mixing currencies), then adjust the amounts.
 */
export async function setCatalogueCurrency(formData: FormData): Promise<void> {
  const currency = String(formData.get("currency") ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`"${currency}" is not a 3-letter currency code`);

  const tenantId = await getTenantId();
  const supabase = db();

  const { data: products, error: productsError } = await supabase.from("products").select("id").eq("tenant_id", tenantId);
  if (productsError) throw new Error(`Could not load products: ${productsError.message}`);
  const productIds = ((products ?? []) as { id: string }[]).map((p) => p.id);
  if (productIds.length === 0) return;

  // Chunked because `.in()` becomes a query-string filter — a few thousand ids in one call would
  // blow past the URL length PostgREST accepts.
  for (let i = 0; i < productIds.length; i += 200) {
    const { error } = await supabase
      .from("product_variants")
      .update({ currency })
      .in("product_id", productIds.slice(i, i + 200));
    if (error) throw new Error(`Could not set catalogue currency: ${error.message}`);
  }

  revalidatePath("/admin/products");
  revalidatePath("/admin");
  revalidatePath("/shop");
  revalidatePath("/");
}

/** Publishes every DRAFT product for the tenant in one go — e.g. right after a WooCommerce import, which lands everything as DRAFT for review. */
export async function publishAllDrafts(): Promise<void> {
  const tenantId = await getTenantId();
  const { error } = await db().from("products").update({ status: "PUBLISHED" }).eq("tenant_id", tenantId).eq("status", "DRAFT");
  if (error) throw new Error(`Could not publish draft products: ${error.message}`);
  revalidatePath("/admin/products");
  revalidatePath("/admin");
  revalidatePath("/shop");
  revalidatePath("/");
}

export interface BulkResult {
  ok: boolean;
  message: string;
}

/**
 * Deletes selected products.
 *
 * Two tables reference product_variants with `on delete restrict`, and they mean very different
 * things:
 *
 *  - order_items — a real blocker. The constraint exists so a past order can't lose what it was
 *    for, and that's the right answer rather than something to work around: the product is named,
 *    left alone, and the admin is pointed at archiving.
 *  - cart_items — not a blocker, but it behaves like one. Any shopper (or the admin's own test
 *    session) leaving a product in a cart pins it forever, and abandoned carts are never cleaned
 *    up, so a product nobody ever bought becomes undeletable for no reason the admin can see.
 *    Those lines are cleared first: a cart is a transient draft, and a line for a product that no
 *    longer exists can't be honoured anyway.
 *
 * That distinction is also why this reports the actual reason — the old message blamed past orders
 * for every failure, including the cart case, which sent admins looking through orders that didn't
 * exist.
 */
export async function deleteProducts(ids: string[]): Promise<BulkResult> {
  if (ids.length === 0) return { ok: false, message: "Nothing selected." };
  const tenantId = await getTenantId();
  const supabase = db();

  // Tenant-scoped up front so a stale page can't reach another store's catalogue, and so the
  // variant lookup below only ever covers products this store owns.
  const { data: owned, error: ownedError } = await supabase
    .from("products")
    .select("id, title")
    .eq("tenant_id", tenantId)
    .in("id", ids);
  if (ownedError) return { ok: false, message: `Could not load products: ${ownedError.message}` };
  const products = (owned ?? []) as { id: string; title: string }[];
  if (products.length === 0) return { ok: false, message: "None of those products are in this store." };
  const titleById = new Map(products.map((p) => [p.id, p.title]));
  const productIds = products.map((p) => p.id);

  const { data: variants } = await supabase.from("product_variants").select("id, product_id").in("product_id", productIds);
  const variantRows = (variants ?? []) as { id: string; product_id: string }[];
  const variantIds = variantRows.map((v) => v.id);

  // Which products a real order depends on — the only genuine blocker, and what makes the message
  // accurate instead of a guess.
  const productByVariant = new Map(variantRows.map((v) => [v.id, v.product_id]));
  const orderedProductIds = new Set<string>();
  for (let i = 0; i < variantIds.length; i += 200) {
    const { data: ordered } = await supabase.from("order_items").select("variant_id").in("variant_id", variantIds.slice(i, i + 200));
    for (const row of (ordered ?? []) as { variant_id: string }[]) {
      const productId = productByVariant.get(row.variant_id);
      if (productId) orderedProductIds.add(productId);
    }
  }

  // Cleared only for variants that are actually going to be deleted, and only once every order is
  // accounted for — a blocked product's shoppers keep their basket intact.
  const clearableVariantIds = variantIds.filter((id) => !orderedProductIds.has(productByVariant.get(id) ?? ""));
  for (let i = 0; i < clearableVariantIds.length; i += 200) {
    const { error: cartError } = await supabase.from("cart_items").delete().in("variant_id", clearableVariantIds.slice(i, i + 200));
    if (cartError) return { ok: false, message: `Could not clear these products from open carts: ${cartError.message}` };
  }

  const deletable = productIds.filter((id) => !orderedProductIds.has(id));
  const blocked: string[] = [...orderedProductIds];
  let deleted = 0;

  for (let i = 0; i < deletable.length; i += 200) {
    const chunk = deletable.slice(i, i + 200);
    const { error } = await supabase.from("products").delete().eq("tenant_id", tenantId).in("id", chunk);
    if (!error) {
      deleted += chunk.length;
      continue;
    }
    // Something still holds a reference. Retry one at a time so the rest of the batch still goes
    // and the message can name exactly which ones didn't.
    for (const id of chunk) {
      const { error: rowError } = await supabase.from("products").delete().eq("tenant_id", tenantId).eq("id", id);
      if (rowError) blocked.push(id);
      else deleted += 1;
    }
  }

  revalidateProductViews();

  const skipped = ids.length - productIds.length;
  if (blocked.length === 0) {
    return {
      ok: true,
      message: `Deleted ${deleted} product${deleted === 1 ? "" : "s"}.` + (skipped > 0 ? ` ${skipped} skipped — not in this store.` : ""),
    };
  }

  const titles = blocked.map((id) => titleById.get(id) ?? id).join(", ");
  return {
    ok: deleted > 0,
    message:
      `${deleted} deleted. ${blocked.length} could not be: ${titles} ` +
      "appear in past orders, which keeps them from being deleted so the order history doesn't lose what it was for. " +
      "Set those to Archived instead — that hides them from the storefront and keeps the orders intact.",
  };
}

/** Bulk status change — the useful bulk "edit": publishing a batch, or pulling one back to Draft/Archived. */
export async function setProductsStatus(ids: string[], status: "PUBLISHED" | "DRAFT" | "ARCHIVED"): Promise<BulkResult> {
  if (ids.length === 0) return { ok: false, message: "Nothing selected." };
  const tenantId = await getTenantId();
  const { error } = await db().from("products").update({ status }).eq("tenant_id", tenantId).in("id", ids);
  if (error) return { ok: false, message: `Could not update: ${error.message}` };

  revalidateProductViews();
  const label = status === "PUBLISHED" ? "published" : status === "DRAFT" ? "moved to Draft" : "archived";
  return { ok: true, message: `${ids.length} product${ids.length === 1 ? "" : "s"} ${label}.` };
}

/**
 * Moves selected products into one category, replacing whatever main category they were in.
 *
 * "Main category" is every category link except New Arrivals — that one is a timed membership
 * every product gets on creation and loses after NEW_ARRIVALS_DAYS, so it isn't where a product
 * lives and must survive this untouched. A product in two real categories ends up in just the
 * chosen one, which is the point: this is "move", not "also add to".
 */
export async function setProductsMainCategory(ids: string[], categoryId: string): Promise<BulkResult> {
  if (ids.length === 0) return { ok: false, message: "Nothing selected." };
  const tenantId = await getTenantId();
  const supabase = db();

  const { data: category, error: categoryError } = await supabase
    .from("categories")
    .select("id, name, handle")
    .eq("tenant_id", tenantId)
    .eq("id", categoryId)
    .maybeSingle();
  if (categoryError) return { ok: false, message: `Could not load the category: ${categoryError.message}` };
  const target = category as { id: string; name: string; handle: string } | null;
  if (!target) return { ok: false, message: "That category no longer exists." };
  if (target.handle === NEW_ARRIVALS_HANDLE) {
    return { ok: false, message: "New Arrivals is applied automatically for the first few days — pick the category the products belong in." };
  }

  // Scoped to this tenant's own products, so an id from a stale page can't reach another store's
  // catalogue. Anything filtered out here simply isn't touched.
  const { data: owned, error: ownedError } = await supabase
    .from("products")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("id", ids);
  if (ownedError) return { ok: false, message: `Could not load products: ${ownedError.message}` };
  const productIds = ((owned ?? []) as { id: string }[]).map((p) => p.id);
  if (productIds.length === 0) return { ok: false, message: "None of those products are in this store." };

  const { data: newArrivals } = await supabase
    .from("categories")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("handle", NEW_ARRIVALS_HANDLE)
    .maybeSingle();
  const newArrivalsId = (newArrivals?.id as string | undefined) ?? null;

  // Add first, then remove. There is no transaction across these two calls, so the order decides
  // what a half-finished move leaves behind: this way a failure leaves products in both the old
  // and the new category (visible, fixable), where delete-then-insert would leave them in none —
  // published but unreachable by browsing, which is exactly the state that's hard to notice.
  //
  // Chunked because `.in()` becomes a query-string filter, which has a length limit.
  const attached: string[] = [];
  for (let i = 0; i < productIds.length; i += 200) {
    const chunk = productIds.slice(i, i + 200);
    const { error: insertError } = await supabase
      .from("product_categories")
      .upsert(
        chunk.map((productId) => ({ product_id: productId, category_id: target.id })),
        { onConflict: "product_id,category_id" },
      );
    if (insertError) {
      return {
        ok: attached.length > 0,
        message:
          `Added ${attached.length} product${attached.length === 1 ? "" : "s"} to ${target.name}, then stopped: ` +
          `${insertError.message}. Nothing was removed from its old category.`,
      };
    }
    attached.push(...chunk);
  }

  for (let i = 0; i < attached.length; i += 200) {
    const chunk = attached.slice(i, i + 200);
    let clear = supabase.from("product_categories").delete().in("product_id", chunk).neq("category_id", target.id);
    if (newArrivalsId) clear = clear.neq("category_id", newArrivalsId);
    const { error: clearError } = await clear;
    if (clearError) {
      revalidateProductViews();
      return {
        ok: true,
        message:
          `${attached.length} product${attached.length === 1 ? "" : "s"} added to ${target.name}, but the old ` +
          `categories could not be cleared: ${clearError.message}. They are now in more than one category.`,
      };
    }
  }

  revalidateProductViews();
  const skipped = ids.length - productIds.length;
  return {
    ok: true,
    message:
      `${productIds.length} product${productIds.length === 1 ? "" : "s"} moved to ${target.name}.` +
      (skipped > 0 ? ` ${skipped} skipped — not in this store.` : ""),
  };
}

function revalidateProductViews(): void {
  revalidatePath("/admin/products");
  revalidatePath("/admin");
  revalidatePath("/shop");
  revalidatePath("/");
}
