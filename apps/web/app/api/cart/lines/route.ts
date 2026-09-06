import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";
import { resolveCart } from "@/lib/checkout/pricing";

export const runtime = "nodejs";

const bodySchema = z.object({
  lines: z.array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(99) })).max(50),
});

/** Prices a cart for display. The browser sends variant ids and quantities; every price comes back from the database. */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid cart" }, { status: 400 });

  try {
    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase);
    return NextResponse.json(await resolveCart(supabase, tenantId, parsed.data.lines));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not price the cart" },
      { status: 500 },
    );
  }
}
