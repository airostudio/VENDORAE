-- ============================================================
-- Reserve tenants.custom_domain for Phase 3 (custom domains as a paid
-- upgrade over the default <slug>.<platform root domain> subdomain).
--
-- Not read or written by any Phase 1 code — hostname resolution
-- (apps/web/lib/tenant/host.ts) is subdomain/slug-based only. No domain
-- verification, SSL, or Vercel Domains API integration exists yet; that is
-- explicitly out of scope until Phase 3.
-- ============================================================

alter table tenants
  add column if not exists custom_domain text unique;
