import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "@/lib/import/tenant";
import { listStagedProducts } from "@/lib/import/staging";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

/** The review queue: everything staged and not yet committed to the store. */
export async function GET(request: Request) {
  const tenantParam = new URL(request.url).searchParams.get("tenant") ?? undefined;
  try {
    const supabase = createServiceRoleSupabaseClient();
    const tenantId = await resolveTenantId(supabase, tenantParam);
    const staged = await listStagedProducts(supabase, tenantId);
    // Logged for the same reason as the stage route's success log: pairing the two makes a
    // "it said staged but the queue is empty" report traceable to a tenant mismatch, if that's
    // what it turns out to be, straight from the runtime logs.
    console.log(`[aliexpress/staged] tenant=${tenantId} count=${staged.length}`);
    return NextResponse.json({ staged });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the staging queue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
