import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

/** Category list with the number of products in each — the admin picker and the manage screen both use it. */
export async function GET() {
  try {
    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase);

    const { data, error } = await supabase
      .from("categories")
      .select("id, parent_id, name, handle, description, position, is_hidden, seo_title, seo_desc")
      .eq("tenant_id", tenantId)
      .order("position")
      .order("name");
    if (error) throw new Error(error.message);

    const categories = (data ?? []) as Array<{ id: string; parent_id: string | null; name: string; handle: string }>;
    const { data: links, error: linksError } = await supabase
      .from("product_categories")
      .select("category_id, product_id")
      .in("category_id", categories.map((c) => c.id));
    if (linksError) throw new Error(linksError.message);
    const linkRows = (links ?? []) as { category_id: string; product_id: string }[];

    // Published count as well as total, because the two answer different questions when a
    // category looks empty on the storefront. A category with 12 links but 1 published product is
    // a publishing problem; 1 link and 1 published product means the assignment never landed.
    const publishedIds = new Set<string>();
    const productIds = [...new Set(linkRows.map((l) => l.product_id))];
    for (let i = 0; i < productIds.length; i += 200) {
      const { data: published } = await supabase
        .from("products")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("status", "PUBLISHED")
        .in("id", productIds.slice(i, i + 200));
      for (const row of (published ?? []) as { id: string }[]) publishedIds.add(row.id);
    }

    const countByCategory = new Map<string, number>();
    const publishedByCategory = new Map<string, number>();
    for (const link of linkRows) {
      countByCategory.set(link.category_id, (countByCategory.get(link.category_id) ?? 0) + 1);
      if (publishedIds.has(link.product_id)) {
        publishedByCategory.set(link.category_id, (publishedByCategory.get(link.category_id) ?? 0) + 1);
      }
    }

    return NextResponse.json({
      categories: categories.map((c) => ({
        ...c,
        productCount: countByCategory.get(c.id) ?? 0,
        publishedCount: publishedByCategory.get(c.id) ?? 0,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load categories" }, { status: 500 });
  }
}

const createSchema = z.object({
  name: z.string().min(1),
  handle: z.string().optional(),
  description: z.string().optional(),
  parentId: z.string().uuid().nullable().optional(),
});

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a category name" }, { status: 400 });

  try {
    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase);
    const handle = slugify(parsed.data.handle || parsed.data.name);
    if (!handle) return NextResponse.json({ error: "That name doesn't produce a usable URL handle" }, { status: 400 });

    const { data, error } = await supabase
      .from("categories")
      .insert({
        tenant_id: tenantId,
        name: parsed.data.name,
        handle,
        description: parsed.data.description ?? null,
        parent_id: parsed.data.parentId ?? null,
      })
      .select("id, parent_id, name, handle, description, position, is_hidden")
      .single();
    // The unique (tenant_id, handle) index is the guard against duplicates.
    if (error) {
      const message = error.code === "23505" ? `A category with the handle "${handle}" already exists` : error.message;
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ category: { ...data, productCount: 0 } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create category" }, { status: 500 });
  }
}
