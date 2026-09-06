import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";
import { getStagedProduct, rowToStagedProduct } from "@/lib/import/staging";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

const skuSchema = z.object({
  aliexpressSkuId: z.string(),
  properties: z.string().nullable(),
  retailPriceCents: z.number().int().min(0),
  compareAtCents: z.number().int().min(0).nullable(),
  supplierCostCents: z.number().int().min(0),
  marginRate: z.number(),
  stockOnHand: z.number().int().min(0),
  isActive: z.boolean(),
});

// Every field an admin can change on a staged listing before it becomes a real product.
const patchSchema = z.object({
  title: z.string().min(1).optional(),
  shortDescription: z.string().optional(),
  description: z.string().optional(),
  seoTitle: z.string().nullable().optional(),
  seoDesc: z.string().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  publish: z.boolean().optional(),
  productType: z.enum(["STANDARD", "ACCESSORY", "CARE_PRODUCT", "BUNDLE", "GIFT_CARD"]).optional(),
  brand: z.string().nullable().optional(),
  imageUrls: z.array(z.string()).optional(),
  skus: z.array(skuSchema).optional(),
});

const COLUMN_BY_FIELD: Record<string, string> = {
  title: "title",
  shortDescription: "short_description",
  description: "description",
  seoTitle: "seo_title",
  seoDesc: "seo_desc",
  categoryId: "category_id",
  publish: "publish",
  productType: "product_type",
  brand: "brand",
  imageUrls: "image_urls",
  skus: "skus",
};

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase);
    const staged = await getStagedProduct(supabase, tenantId, params.id);
    if (!staged) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(staged);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const updates: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(parsed.data)) {
    const column = COLUMN_BY_FIELD[field];
    if (column) updates[column] = value;
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  try {
    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase);
    const { data, error } = await supabase
      .from("aliexpress_staged_products")
      .update(updates)
      .eq("id", params.id)
      .eq("tenant_id", tenantId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(rowToStagedProduct(data as unknown as Record<string, unknown>));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase);
    const { error } = await supabase.from("aliexpress_staged_products").delete().eq("id", params.id).eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete" }, { status: 500 });
  }
}
