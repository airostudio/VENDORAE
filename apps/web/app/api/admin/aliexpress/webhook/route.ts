import { NextResponse } from "next/server";
import { registerWebhook } from "@/lib/dropshipEngine";

export const runtime = "nodejs";
// Never prerender or cache an admin endpoint: Next will happily statically optimise a
// route whose GET succeeds at build time, after which every other method on it returns a
// bodiless 405 and the GET serves a stale build-time snapshot.
export const dynamic = "force-dynamic";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** Registers this deployment's webhook receiver with the dropship-engine, using this app's own DROPSHIP_ENGINE_WEBHOOK_SECRET (never generated or shown here — it must already be set as an env var, since POST /api/webhooks/dropship-engine needs the exact same value to verify signatures). */
export async function POST(request: Request) {
  try {
    const webhookUrl = new URL("/api/webhooks/dropship-engine", request.url).toString();
    const result = await registerWebhook({ url: webhookUrl, secret: requiredEnv("DROPSHIP_ENGINE_WEBHOOK_SECRET") });
    return NextResponse.json({ ...result, webhookUrl });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not register webhook" }, { status: 502 });
  }
}
