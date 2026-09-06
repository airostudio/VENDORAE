-- ============================================================
-- Adds columns the storefront's real (non-sample-data) queries need,
-- for databases where supabase/schema.sql was already applied before
-- these columns existed. Safe to re-run (IF NOT EXISTS everywhere).
--
-- Run after schema.sql, e.g.:
--   supabase db execute -f supabase/migrations/0001_guides_and_hero_secondary_cta.sql
-- ============================================================

alter table blog_posts add column if not exists category text;
alter table blog_posts add column if not exists excerpt text;

alter table banners add column if not exists secondary_cta_label text;
alter table banners add column if not exists secondary_cta_href text;
