import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * Next.js patches the global `fetch` in every server request context (Route Handlers included,
 * regardless of `export const dynamic = "force-dynamic"` on the route — that config only governs
 * the route's own response caching, not fetches nested inside it) so that a plain GET is cached
 * indefinitely in the Next.js Data Cache unless the call itself opts out. supabase-js issues its
 * `.select()` reads as GET under the hood and never sets that opt-out, so — silently, and only on
 * the server — the FIRST read of any given query after a deploy or cache reset gets cached, and
 * every read after it, including ones made after a write, keeps serving that same frozen snapshot.
 * Writes (POST/PATCH/DELETE) aren't affected, which is exactly what makes this confusing to
 * diagnose: a delete or an insert reports success because it really did happen, while the very
 * next read of the same query still shows the pre-write state.
 *
 * Passed as this client's fetch, so no query built on top of it can be silently cached.
 */
function noStoreFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, cache: "no-store" });
}

/**
 * Browser/anon client — safe to use in client components. Subject to the
 * RLS policies in supabase/schema.sql (a signed-in customer can only see
 * their own rows; storefront reads are limited to published/active rows).
 */
export function createBrowserSupabaseClient(): SupabaseClient<Database> {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { global: { fetch: noStoreFetch } },
  );
}

/**
 * Service-role client — server-only, NEVER import this from a client
 * component or expose the key to the browser. Bypasses RLS entirely, so use
 * it only for trusted server-side writes: guest checkout, webhook handlers,
 * admin actions gated by your own auth checks.
 */
export function createServiceRoleSupabaseClient(): SupabaseClient<Database> {
  if (typeof window !== "undefined") {
    throw new Error("createServiceRoleSupabaseClient must only be called on the server");
  }
  return createClient<Database>(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
    global: { fetch: noStoreFetch },
  });
}
