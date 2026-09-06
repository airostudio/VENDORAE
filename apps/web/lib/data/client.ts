import "server-only";
import { cache } from "react";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { resolveTenantId } from "../import/tenant";

/**
 * Every storefront/admin page reads through this service-role client rather
 * than the browser/anon one — there's no live Supabase Auth session to carry
 * RLS policies yet (see README "What's stubbed"), so each query function
 * below is responsible for its own equivalent of what RLS would otherwise
 * enforce (e.g. `.eq("status", "PUBLISHED")` for anything customer-facing).
 */
export function db() {
  return createServiceRoleSupabaseClient();
}

/** Memoized per request — every query function needs the tenant id, but a page only resolves it once. */
export const getTenantId = cache(async (): Promise<string> => resolveTenantId(db()));
