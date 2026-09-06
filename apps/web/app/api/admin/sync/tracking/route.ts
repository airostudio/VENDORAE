import { NextResponse } from "next/server";
import { triggerTrackingSync } from "@/lib/dropshipEngine";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

/**
 * Manually triggers a tracking poll for every in-flight AliExpress order —
 * the same work the dropship-engine's scheduled every-5-hours job does, for
 * on-demand/admin-triggered use. The engine applies the actual updates by
 * calling back into POST /api/webhooks/dropship-engine (order.shipped /
 * order.delivered) before this request returns, so Beach Footprints' own
 * `orders` rows are already current by the time this responds.
 */
export async function POST() {
  try {
    const summary = await triggerTrackingSync();
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tracking sync failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
