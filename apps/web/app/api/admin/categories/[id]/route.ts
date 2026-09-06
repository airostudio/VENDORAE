import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  handle: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  position: z.number().int().optional(),
  isHidden: z.boolean().optional(),
  seoTitle: z.string().nullable().optional(),
  seoDesc: z.string().nullable().optional(),
});

const COLUMN: Record<string, string> = {
  name: "name",
  handle: "handle",
  description: "description",
  parentId: "parent_id",
  position: "position",
  isHidden: "is_hidden",
  seoTitle: "seo_title",
  seoDesc: "seo_desc",
};

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid category update" }, { status: 400 });

  // A category can't be its own parent — that would orphan it from the tree and recurse forever.
  if (parsed.data.parentId === params.id) {
    return NextResponse.json({ error: "A category can't be its own parent" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(parsed.data)) {
    if (COLUMN[field]) updates[COLUMN[field]] = value;
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  try {
    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase);
    const { data, error } = await supabase
      .from("categories")
      .update(updates)
      .eq("id", params.id)
      .eq("tenant_id", tenantId)
      .select("id, parent_id, name, handle, description, position, is_hidden, seo_title, seo_desc")
      .maybeSingle();
    if (error) {
      const message = error.code === "23505" ? "Another category already uses that handle" : error.message;
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (!data) return NextResponse.json({ error: "Category not found" }, { status: 404 });
    return NextResponse.json({ category: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update category" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase);

    // Deleting a category that still has products would silently uncategorise them, so refuse and
    // say how many — the admin can reassign or empty it first.
    const { count } = await supabase
      .from("product_categories")
      .select("product_id", { count: "exact", head: true })
      .eq("category_id", params.id);
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: `This category still has ${count} product${count === 1 ? "" : "s"}. Move them out first.` },
        { status: 409 },
      );
    }

    const { error } = await supabase.from("categories").delete().eq("id", params.id).eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete category" }, { status: 500 });
  }
}
