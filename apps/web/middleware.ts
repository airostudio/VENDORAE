import { NextResponse, type NextRequest } from "next/server";
import { peekRateLimit, recordAttempt, clientIp } from "@/lib/rateLimit";
import { timingSafeStringEqual } from "@/lib/timingSafeEqual";

/**
 * HTTP Basic Auth in front of the entire admin area (pages + API routes).
 * Deliberately simple: one shared password from an env var, not a real
 * user/session system — good enough to keep the admin UI and its import
 * endpoints from being open to the internet until real admin auth exists.
 * Username is ignored/anything; only the password is checked.
 */
async function adminAuth(request: NextRequest): Promise<NextResponse> {
  const password = process.env.ADMIN_PASSWORD;
  // If unset, fail open with a loud console warning rather than locking
  // admins out entirely — but this should always be set in production.
  if (!password) {
    console.warn("ADMIN_PASSWORD is not set — /admin is NOT password protected.");
    return NextResponse.next();
  }

  // Lock out an IP after repeated bad passwords rather than letting Basic Auth be brute-forced
  // at whatever rate the client can send requests. Only wrong passwords count against the
  // lockout window (a legitimate admin's browser re-sends its cached Basic Auth header on
  // every request, so counting successes too would lock out normal browsing).
  const lockKey = `admin-login:${clientIp(request)}`;
  const lockout = peekRateLimit(lockKey, 10);
  if (!lockout.allowed) {
    return new NextResponse("Too many failed admin login attempts. Please wait and try again.", {
      status: 429,
      headers: { "Retry-After": String(lockout.retryAfterSeconds) },
    });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const decoded = atob(authHeader.slice(6));
    const suppliedPassword = decoded.slice(decoded.indexOf(":") + 1);
    if (await timingSafeStringEqual(suppliedPassword, password)) return NextResponse.next();
    recordAttempt(lockKey, 300);
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Admin", charset="UTF-8"' },
  });
}

/**
 * Whether the current tenant has completed the /onboarding setup wizard, read directly via a
 * plain REST call to Supabase (with the service-role key) rather than the supabase-js SDK or
 * apps/web/lib/tenantSettings.ts, both of which pull in more than this edge middleware needs.
 * tenant_settings has no public/anon read policy (see supabase/schema.sql), so the anon key
 * cannot see onboarding_completed — the service-role key is required to read it here.
 *
 * Fails open (treats onboarding as complete) on any error: a misconfigured or unreachable
 * database should not lock every visitor out of a store that was already live, and the actual
 * storefront pages already handle a missing/incomplete tenant gracefully.
 */
async function isOnboardingCompleted(): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const slug = process.env.DEFAULT_TENANT_SLUG || "default-store";
  if (!url || !serviceKey) return true;

  try {
    const endpoint = `${url.replace(/\/$/, "")}/rest/v1/tenants?select=tenant_settings(onboarding_completed)&slug=eq.${encodeURIComponent(slug)}`;
    const response = await fetch(endpoint, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      cache: "no-store",
    });
    if (!response.ok) return true;
    const rows = (await response.json()) as Array<{ tenant_settings: { onboarding_completed: boolean } | { onboarding_completed: boolean }[] | null }>;
    const row = rows[0];
    if (!row) return true; // no tenant row yet (e.g. seed hasn't run) — don't trap the operator in a redirect loop
    const settings = Array.isArray(row.tenant_settings) ? row.tenant_settings[0] : row.tenant_settings;
    if (!settings) return true;
    return Boolean(settings.onboarding_completed);
  } catch (error) {
    console.error(`[middleware] could not check onboarding status: ${error instanceof Error ? error.message : error}`);
    return true;
  }
}

const STATIC_FILE = /\.[a-zA-Z0-9]+$/;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Admin stays reachable (behind its own Basic Auth) regardless of onboarding status, so the
  // owner can always sign in to finish setting things up or manage an already-live store.
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    return adminAuth(request);
  }

  // Every other API route, the wizard itself, Next internals and static files are left alone —
  // the wizard's own API calls (GET/POST /api/onboarding/*) must work while onboarding is
  // incomplete, which is precisely the state this middleware would otherwise redirect away from.
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    STATIC_FILE.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (!(await isOnboardingCompleted())) {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
