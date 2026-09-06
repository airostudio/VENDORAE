import { NextResponse, type NextRequest } from "next/server";
import { peekRateLimit, recordAttempt, clientIp } from "@/lib/rateLimit";
import { timingSafeStringEqual } from "@/lib/timingSafeEqual";
import { resolveHostTenant } from "@/lib/tenant/host";
import { createSupabaseMiddlewareClient } from "@/lib/supabase/middleware";

/**
 * Break-glass HTTP Basic Auth in front of the entire admin area (pages + API routes), used only
 * while the resolved tenant has no real admin account yet (see `adminAuth` below) — one shared
 * password from an env var, not a real user/session system. Username is ignored; only the
 * password is checked.
 */
async function basicAuthFallback(request: NextRequest): Promise<NextResponse> {
  const password = process.env.ADMIN_PASSWORD;
  // If unset, fail open with a loud console warning rather than locking admins out entirely — but
  // this should always be set in production.
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

function restHeaders(serviceKey: string): HeadersInit {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
}

/**
 * Tenant id for a slug, read directly via a plain REST call (service-role key) rather than
 * supabase-js — this is edge middleware, and every request on the admin path needs this, so keep
 * it to the one thing it needs rather than pulling in the full SDK. Returns null on any
 * unresolvable slug or infra hiccup; callers must decide how to fail (see `adminAuth`).
 */
async function fetchTenantIdBySlug(slug: string): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  try {
    const endpoint = `${url.replace(/\/$/, "")}/rest/v1/tenants?select=id&slug=eq.${encodeURIComponent(slug)}`;
    const response = await fetch(endpoint, { headers: restHeaders(serviceKey), cache: "no-store" });
    if (!response.ok) return null;
    const rows = (await response.json()) as Array<{ id: string }>;
    return rows[0]?.id ?? null;
  } catch (error) {
    console.error(`[middleware] could not resolve tenant "${slug}": ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/** Whether a tenant has ever had a real admin account created (any `memberships` row at all). */
async function tenantHasMembership(tenantId: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return false;

  try {
    const endpoint = `${url.replace(/\/$/, "")}/rest/v1/memberships?select=id&tenant_id=eq.${encodeURIComponent(tenantId)}&limit=1`;
    const response = await fetch(endpoint, { headers: restHeaders(serviceKey), cache: "no-store" });
    if (!response.ok) return false;
    const rows = (await response.json()) as Array<{ id: string }>;
    return rows.length > 0;
  } catch (error) {
    console.error(`[middleware] could not check memberships for tenant ${tenantId}: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

function unauthorized(request: NextRequest, reason?: string): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const loginUrl = new URL("/admin/login", request.url);
  if (reason) loginUrl.searchParams.set("error", reason);
  return NextResponse.redirect(loginUrl);
}

/**
 * Gates /admin and /api/admin for the tenant this request's Host resolved to.
 *
 * Real auth: a valid Supabase Auth session AND a `memberships` row for *this specific* tenant —
 * checked on every request, not just "is logged in somewhere", so an admin of one store can never
 * act on another store's even with a valid session, even by guessing an API path.
 *
 * Break-glass bootstrap: a tenant that has never had a `memberships` row (true today for the one
 * pre-existing tenant, which has only ever been protected by the shared ADMIN_PASSWORD, and
 * briefly true for any tenant mid-setup) falls back to the original shared-password Basic Auth so
 * its operator is never locked out — see /admin/create-account for how they leave this state.
 * The instant a tenant has any membership row, this fallback stops being reachable for it, even
 * with the correct password: it is a one-time bridge, never a standing backdoor.
 */
async function adminAuth(request: NextRequest, slug: string): Promise<NextResponse> {
  // The login page (and the account-bootstrap page/API it can lead to) must stay reachable
  // without already being authed, or nobody could ever get in.
  if (request.nextUrl.pathname.startsWith("/admin/login")) return NextResponse.next();

  const tenantId = await fetchTenantIdBySlug(slug);
  // No tenant row resolvable at all (bad slug, infra not provisioned yet, DB unreachable) — there
  // is no membership concept to check against, so fall back to the original shared-password gate
  // rather than lock every admin area in the deployment out.
  if (!tenantId) return basicAuthFallback(request);

  const hasMembership = await tenantHasMembership(tenantId);
  if (!hasMembership) return basicAuthFallback(request);

  const { supabase, getResponse } = createSupabaseMiddlewareClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized(request);

  const { data: membership } = await supabase
    .from("memberships")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    // Authenticated, but not staff for *this* store. Sign them out of this session so a redirect
    // can't leave them stuck bouncing between /admin and /admin/login "logged in" to an account
    // that has no access here.
    await supabase.auth.signOut();
    return unauthorized(request, "not_member");
  }

  return getResponse();
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
async function isOnboardingCompleted(slug: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return true;

  try {
    const endpoint = `${url.replace(/\/$/, "")}/rest/v1/tenants?select=tenant_settings(onboarding_completed)&slug=eq.${encodeURIComponent(slug)}`;
    const response = await fetch(endpoint, { headers: restHeaders(serviceKey), cache: "no-store" });
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

/**
 * Whether the current tenant's platform subscription license has been canceled — read directly
 * via a plain REST call (service-role key), same shape and same fail-open philosophy as
 * `isOnboardingCompleted` above. Only `canceled` blocks the storefront; `past_due` is a grace
 * period, not a hard stop, and any missing row (a tenant provisioned before licensing existed, or
 * one with no license row for any other reason) or lookup error is treated as fine — a DB hiccup
 * or an unmigrated tenant must never take a whole store down.
 */
async function isTenantLicenseCanceled(slug: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return false;

  try {
    const endpoint = `${url.replace(/\/$/, "")}/rest/v1/tenants?select=tenant_licenses(status)&slug=eq.${encodeURIComponent(slug)}`;
    const response = await fetch(endpoint, { headers: restHeaders(serviceKey), cache: "no-store" });
    if (!response.ok) return false;
    const rows = (await response.json()) as Array<{ tenant_licenses: { status: string } | { status: string }[] | null }>;
    const row = rows[0];
    if (!row) return false;
    const license = Array.isArray(row.tenant_licenses) ? row.tenant_licenses[0] : row.tenant_licenses;
    if (!license) return false;
    return license.status === "canceled";
  } catch (error) {
    console.error(`[middleware] could not check license status: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

const STATIC_FILE = /\.[a-zA-Z0-9]+$/;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Next internals and static files are left alone regardless of host or path.
  if (pathname.startsWith("/_next") || pathname === "/favicon.ico" || STATIC_FILE.test(pathname)) {
    return NextResponse.next();
  }

  const hostResolution = resolveHostTenant(request.headers.get("host"));

  // The bare platform domain (no tenant subdomain) isn't any tenant's store. Only the literal
  // root path gets rewritten to the platform marketing/pricing page — every other apex path
  // (/platform/welcome, /api/platform/checkout, /api/webhooks/platform-stripe, ...) has a real
  // route of its own and must be left alone, or its path and query string (e.g. a Stripe
  // ?session_id=... return URL) would be silently discarded by the rewrite.
  if (hostResolution.isPlatformRoot && pathname === "/") {
    return NextResponse.rewrite(new URL("/platform", request.url));
  }

  // Admin stays reachable (behind its own auth) regardless of onboarding status, so the owner can
  // always sign in to finish setting things up or manage an already-live store.
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    return adminAuth(request, hostResolution.slug);
  }

  // Every other API route, the wizard itself, Next internals and static files are left alone —
  // the wizard's own API calls (GET/POST /api/onboarding/*) must work while onboarding is
  // incomplete, which is precisely the state this middleware would otherwise redirect away from.
  if (pathname.startsWith("/api") || pathname.startsWith("/onboarding")) {
    return NextResponse.next();
  }

  // At the apex domain there is no real tenant — hostResolution.slug is just the meaningless
  // DEFAULT_TENANT_SLUG fallback — so the onboarding-completed check below is nonsensical here
  // and could wrongly redirect a platform page (e.g. /platform/welcome) to /onboarding if the
  // default tenant itself hasn't finished setup. Every remaining apex-domain request just proceeds.
  if (hostResolution.isPlatformRoot) {
    return NextResponse.next();
  }

  if (!(await isOnboardingCompleted(hostResolution.slug))) {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  // A canceled platform license blocks the storefront (not /admin, handled above, so the owner
  // can still see why and potentially resubscribe) with a simple "no longer available" page
  // rather than the normal homepage/shop.
  if (await isTenantLicenseCanceled(hostResolution.slug)) {
    return NextResponse.rewrite(new URL("/store-unavailable", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
