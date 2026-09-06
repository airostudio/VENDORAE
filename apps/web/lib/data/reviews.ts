import "server-only";
import { db, getTenantId } from "./client";

export interface ProductReview {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  createdAt: string;
  reviewerName: string | null;
}

/** Approved reviews for one product, newest first — the only reviews a customer ever sees. */
export async function getApprovedReviews(productId: string): Promise<ProductReview[]> {
  const supabase = db();
  const { data, error } = await supabase
    .from("reviews")
    .select("id, rating, title, body, created_at, customers(name)")
    .eq("product_id", productId)
    .eq("is_approved", true)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load reviews: ${error.message}`);

  return ((data ?? []) as Array<{ id: string; rating: number; title: string | null; body: string | null; created_at: string; customers: { name: string | null } | { name: string | null }[] | null }>).map((row) => {
    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
    return { id: row.id, rating: row.rating, title: row.title, body: row.body, createdAt: row.created_at, reviewerName: customer?.name ?? null };
  });
}

export interface PendingReview {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  createdAt: string;
  reviewerName: string | null;
  reviewerEmail: string | null;
  productTitle: string;
  productHandle: string;
}

/** Everything awaiting moderation, across the tenant's whole catalogue — the admin queue. */
export async function getPendingReviews(): Promise<PendingReview[]> {
  const tenantId = await getTenantId();
  const supabase = db();

  const { data, error } = await supabase
    .from("reviews")
    .select("id, rating, title, body, created_at, customers(name, email), products!inner(tenant_id, title, handle)")
    .eq("is_approved", false)
    .eq("products.tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load pending reviews: ${error.message}`);

  return (
    (data ?? []) as Array<{
      id: string;
      rating: number;
      title: string | null;
      body: string | null;
      created_at: string;
      customers: { name: string | null; email: string } | { name: string | null; email: string }[] | null;
      products: { title: string; handle: string } | { title: string; handle: string }[];
    }>
  ).map((row) => {
    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    return {
      id: row.id,
      rating: row.rating,
      title: row.title,
      body: row.body,
      createdAt: row.created_at,
      reviewerName: customer?.name ?? null,
      reviewerEmail: customer?.email ?? null,
      productTitle: product.title,
      productHandle: product.handle,
    };
  });
}
