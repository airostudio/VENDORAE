import { NextResponse } from "next/server";
import { z } from "zod";
import { connectAliExpressApp, exchangeAuthorizationCode, getAliExpressStatus, getAuthorizeUrl } from "@/lib/dropshipEngine";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

/**
 * Proxies the one-time AliExpress OAuth bootstrap to the dropship-engine
 * (see the engine's README) — Beach Footprints' own admin password gates
 * this route, and DROPSHIP_ENGINE_API_KEY (never any AliExpress credentials)
 * is the only secret this app holds for it. The engine has its own platform
 * AliExpress app, so normally nothing needs registering here — GET without
 * a redirectUri returns current connection status; with one, it builds the
 * authorize link to send the store owner to log into their own account.
 *
 * PUT  /api/admin/aliexpress/auth { appKey, appSecret }
 *   -> advanced/optional: use this store's own AliExpress app instead of the platform's.
 * GET  /api/admin/aliexpress/auth
 *   -> { connected, connectedAt }
 * GET  /api/admin/aliexpress/auth?redirectUri=<callback>
 *   -> { authorizeUrl } — visit it, log in, approve.
 * POST /api/admin/aliexpress/auth { code, redirectUri }
 *   -> { connected: true } once the engine has exchanged the code.
 */
const connectSchema = z.object({ appKey: z.string().min(1), appSecret: z.string().min(1) });

export async function PUT(request: Request) {
  const parsed = connectSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    return NextResponse.json(await connectAliExpressApp(parsed.data));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save AliExpress app credentials" }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const redirectUri = new URL(request.url).searchParams.get("redirectUri");

  try {
    if (!redirectUri) return NextResponse.json(await getAliExpressStatus());
    return NextResponse.json(await getAuthorizeUrl(redirectUri));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AliExpress request failed" }, { status: 502 });
  }
}

const callbackSchema = z.object({ code: z.string().min(1), redirectUri: z.string().min(1) });

export async function POST(request: Request) {
  const parsed = callbackSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    return NextResponse.json(await exchangeAuthorizationCode(parsed.data));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AliExpress token exchange failed" }, { status: 502 });
  }
}
