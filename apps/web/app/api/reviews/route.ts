import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  productId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().max(2000).optional(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
});

/**
 * Submits a review for moderation. There's no customer sign-in yet (see README "What's
 * stubbed"), so a reviewer is identified the same way a checkout guest is — upserted into
 * `customers` by email — rather than either requiring an account that doesn't exist or leaving
 * the review anonymous. Every review is inserted with is_approved: false; nothing here ever
 * flips it — that's the admin moderation queue's job (GET/PATCH /api/admin/reviews).
 */
export async function POST(request: Request) {
  // Unauthenticated and cheap to spam (no payment, no email confirmation) — limit by IP.
  const rateLimit = checkRateLimit(`review-submit:${clientIp(request)}`, 5, 300);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many reviews submitted. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Please check the details entered.", detail: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;
  const supabase = createServiceRoleSupabaseClient();

  try {
    const tenantId = await resolveTenantId(supabase);

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id")
      .eq("id", input.productId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (productError) throw new Error(productError.message);
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .upsert({ tenant_id: tenantId, email: input.email, name: input.name }, { onConflict: "tenant_id,email" })
      .select("id")
      .single();
    if (customerError || !customer) throw new Error(`Could not record the reviewer: ${customerError?.message}`);

    const { error: reviewError } = await supabase.from("reviews").insert({
      product_id: input.productId,
      customer_id: customer.id as string,
      rating: input.rating,
      title: input.title || null,
      body: input.body || null,
      is_approved: false,
    });
    if (reviewError) throw new Error(reviewError.message);

    return NextResponse.json({ ok: true, pendingApproval: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not submit the review";
    console.error(`[api/reviews] ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
