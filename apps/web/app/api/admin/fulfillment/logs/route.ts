import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Reads the fulfillment/sync audit trail (catalog syncs, order placements, tracking updates) for admin visibility. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantParam = url.searchParams.get("tenant") ?? undefined;
  const orderId = url.searchParams.get("orderId") ?? undefined;
  const event = url.searchParams.get("event") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, MAX_LIMIT);

  const supabase = createServiceRoleSupabaseClient();
  const tenantId = await resolveTenantId(supabase, tenantParam);

  let query = supabase
    .from("fulfillment_logs")
    .select("id, order_id, variant_id, event, supplier_order_id, detail, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (orderId) query = query.eq("order_id", orderId);
  if (event) query = query.eq("event", event);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logs: data ?? [] });
}
