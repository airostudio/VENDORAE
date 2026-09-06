import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";
import { stageProduct } from "@/lib/import/staging";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  productId: z.string().min(1),
  sourceUrl: z.string().optional(),
  tenant: z.string().optional(),
});

/**
 * Stages ONE product into the review queue. Bulk pasting is driven from the client, one request
 * per line, so a batch of twenty never has to finish inside a single function invocation and the
 * admin sees per-line progress (and per-line failures) as it goes.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const supabase = createServiceRoleSupabaseClient();
    // Was previously outside the try/catch: a bad/missing tenant slug threw here uncaught,
    // producing a generic unhandled-exception 500 with no logged context instead of a legible
    // error the admin (and the runtime logs) could actually act on.
    const tenantId = await resolveTenantId(supabase, parsed.data.tenant);

    const staged = await stageProduct(supabase, tenantId, {
      aliexpressProductId: parsed.data.productId,
      sourceUrl: parsed.data.sourceUrl ?? null,
    });

    // Logged so "it said staged but I can't find it in the queue" is traceable from the runtime
    // logs alone — which tenant a row landed under is exactly what that report needs to confirm
    // or rule out (e.g. the admin viewing a different tenant/deployment than the one staged to).
    console.log(
      `[aliexpress/stage] ${staged.status} id=${staged.id} product=${parsed.data.productId} tenant=${tenantId} title=${staged.title || "(none)"}`,
    );

    return NextResponse.json(staged);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not stage this product";
    console.error(`[aliexpress/stage] FAILED product=${parsed.data.productId}: ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
