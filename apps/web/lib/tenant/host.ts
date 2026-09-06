/**
 * Pure hostname → tenant-slug resolution, shared by the edge middleware (which cannot import
 * `server-only`/`next/headers` code paths the way route handlers do) and
 * `apps/web/lib/import/tenant.ts` (node runtime). No imports, no I/O — keep it that way so both
 * runtimes can use the exact same rule and never disagree.
 *
 * Stores are addressed by subdomain: `<slug>.<PLATFORM_ROOT_DOMAIN>` (e.g.
 * `client1.vendorae.com`). Custom domains are a reserved Phase 3 upgrade (see
 * `tenants.custom_domain` in supabase/schema.sql) — not resolved here yet.
 */

export function getPlatformRootDomain(): string {
  return (process.env.PLATFORM_ROOT_DOMAIN || "vendorae.com").trim().toLowerCase();
}

export function getDefaultTenantSlug(): string {
  return process.env.DEFAULT_TENANT_SLUG || "default-store";
}

export interface HostResolution {
  /**
   * True when the Host is exactly the platform's own root domain (or `www.<root>`) with no
   * tenant subdomain — the future platform marketing/pricing site, not any tenant's store.
   */
  isPlatformRoot: boolean;
  /**
   * The tenant slug this host resolves to. Meaningless when `isPlatformRoot` is true (there is no
   * tenant); callers that need a slug regardless (e.g. admin/API routes hit at the apex, which
   * have no Phase-1 meaning of their own) can still use it — it is the same default-tenant
   * fallback used for local dev and preview URLs.
   */
  slug: string;
}

/**
 * Resolve which tenant a request's `Host` header belongs to.
 *
 * - `<subdomain>.<root>` (case-insensitive) → tenant slug `<subdomain>`.
 * - the bare root domain, or `www.<root>` → no tenant at all (`isPlatformRoot: true`).
 * - anything else — `localhost:3000`, a raw `*.vercel.app` preview URL, no Host header — doesn't
 *   look like the platform's own domain at all, so for local dev/preview convenience this falls
 *   back to the single default tenant, exactly like the pre-multi-tenant behavior. This keeps
 *   every environment that isn't a real `<slug>.<root>` production host working unmodified.
 */
export function resolveHostTenant(
  rawHost: string | null | undefined,
  rootDomain: string = getPlatformRootDomain(),
  defaultSlug: string = getDefaultTenantSlug(),
): HostResolution {
  const host = (rawHost || "").split(":")[0].trim().toLowerCase();
  const root = rootDomain.trim().toLowerCase();

  if (!host || !root) return { isPlatformRoot: false, slug: defaultSlug };
  if (host === root || host === `www.${root}`) return { isPlatformRoot: true, slug: defaultSlug };

  const suffix = `.${root}`;
  if (host.endsWith(suffix)) {
    const subdomain = host.slice(0, -suffix.length);
    if (subdomain && subdomain !== "www") return { isPlatformRoot: false, slug: subdomain };
  }

  return { isPlatformRoot: false, slug: defaultSlug };
}
