import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

/** The products assigned to one category, for the manage screen's expandable list. */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase);

    const { data: links, error } = await supabase
      .from("product_categories")
      .select("product_id")
      .eq("category_id", params.id);
    if (error) throw new Error(error.message);

    const productIds = ((links ?? []) as { product_id: string }[]).map((l) => l.product_id);
    if (productIds.length === 0) return NextResponse.json({ products: [] });

    const { data: products } = await supabase
      .from("products")
      .select("id, title, handle, status")
      .eq("tenant_id", tenantId)
      .in("id", productIds)
      .order("title");

    return NextResponse.json({ products: products ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load products" }, { status: 500 });
  }
}

/** Assign or remove a product from this category. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = (await request.json()) as { productId?: string; action?: "add" | "remove" };
    if (!body.productId) return NextResponse.json({ error: "productId is required" }, { status: 400 });

    const supabase = createServiceRoleSupabaseClient();
    // Checked rather than discarded: reporting a write as done when it failed is how a product
    // ends up looking filed under a category it was never actually linked to.
    const { error } =
      body.action === "remove"
        ? await supabase.from("product_categories").delete().eq("category_id", params.id).eq("product_id", body.productId)
        : await supabase
            .from("product_categories")
            .upsert({ category_id: params.id, product_id: body.productId }, { onConflict: "product_id,category_id" });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update" }, { status: 500 });
  }
}
