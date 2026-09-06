-- ============================================================
-- Shipping weight on staged AliExpress imports.
--
-- AliExpress returns a package gross weight; without somewhere to hold it, an
-- imported product lands with no weight and can't be rated for shipping.
--
--   supabase db execute -f supabase/migrations/0005_staging_shipping_weight.sql
-- ============================================================

alter table aliexpress_staged_products
  add column if not exists package_weight_grams int;
