import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/dropshipEngine";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

/**
 * Proxies this store's dropshipping settings (pricing bounds/compare-at, import defaults,
 * stock/sync behavior, shipping preference, notification toggles) to the engine's
 * GET/PUT /v1/settings — see the engine's src/domain/settings.ts for the full shape and defaults.
 */
export async function GET() {
  try {
    return NextResponse.json(await getSettings());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load settings" }, { status: 502 });
  }
}

export async function PUT(request: Request) {
  try {
    const patch = await request.json();
    return NextResponse.json(await updateSettings(patch));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save settings" }, { status: 502 });
  }
}
