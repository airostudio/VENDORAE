import "server-only";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { Database } from "@trend/db";

/**
 * Cookie-based Supabase Auth client for Server Components and Route Handlers, subject to RLS as
 * whichever user's session the request's cookies carry (or anonymous, if none). This is how a
 * route handler checks "is the signed-in user actually a member of the tenant this request
 * resolved to" — never use it to bypass RLS; that's what `createServiceRoleSupabaseClient` is for.
 *
 * Session cookies are written by the browser client at /admin/login (see
 * apps/web/lib/supabase/client.ts) and refreshed by the middleware client (see
 * apps/web/lib/supabase/middleware.ts) — this helper only ever reads/refreshes them.
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Thrown when called from a Server Component render (which can't set cookies) rather
          // than a Route Handler or Server Action — the middleware client is what actually
          // refreshes the session cookie on every request, so this is safe to ignore here.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          // See set() above.
        }
      },
    },
  });
}
