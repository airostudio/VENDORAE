-- ============================================================
-- Supplier specifications on staged AliExpress imports.
--
-- AliExpress returns a spec table (Material, Style, Season…) at
-- result.ae_item_properties. Holding it on the staged row lets it be reviewed
-- and edited before it becomes product_specs rows on the real product.
--
--   supabase db execute -f supabase/migrations/0006_staging_attributes.sql
-- ============================================================

alter table aliexpress_staged_products
  add column if not exists attributes jsonb not null default '[]'::jsonb;
