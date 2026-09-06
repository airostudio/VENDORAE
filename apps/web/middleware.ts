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
export async function middleware(request: NextRequest) {
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

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
