"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@trend/db";

/**
 * Browser Supabase Auth client for the admin login page — `signInWithPassword`/`signOut` here
 * write the session into cookies (not localStorage) so the server (middleware, Route Handlers,
 * Server Components) can read the same session via apps/web/lib/supabase/server.ts.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
