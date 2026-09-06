import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { placeAliExpressOrder } from "@/lib/fulfillment/placeAliExpressOrder";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

/**
 * Manual trigger for the same placement logic the Stripe webhook runs automatically on payment
 * (see lib/fulfillment/placeAliExpressOrder.ts) — useful when auto-placement failed and needs a
 * retry, or for an order that predates auto-placement.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createServiceRoleSupabaseClient();
  const result = await placeAliExpressOrder(supabase, params.id);

  if (!result.ok) {
    const status = result.error === "Order not found" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json(result, { status: result.skipped ? 200 : 201 });
}
