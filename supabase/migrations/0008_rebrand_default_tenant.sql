-- ============================================================
-- Rebrand: default tenant slug + demo brand name cleanup.
--
-- The single-tenant demo installation used to be keyed by the literal slug
-- "beach-footprints-demo" with brand_name "Beach Footprints". The product is
-- now generic/white-label (Vendorae) and ships blank for a new owner, so:
--   - the default tenant slug becomes "default-store" (matches the new
--     DEFAULT_TENANT_SLUG fallback in apps/web/lib/import/tenant.ts and the
--     new supabase/seed.sql)
--   - any tenant still carrying the old demo brand name has it cleared back
--     to a generic placeholder so it doesn't keep showing "Beach Footprints"
--     in the header/footer of a store that hasn't been through the setup
--     wizard yet
--
-- Safe to run against an already-seeded database from before this rename;
-- a no-op if neither the old slug nor the old brand name are present.
-- ============================================================

update tenants
set slug = 'default-store'
where slug = 'beach-footprints-demo';

update tenant_settings
set brand_name = 'Your Store',
    seo_title_default = 'Your Store'
where brand_name = 'Beach Footprints';
