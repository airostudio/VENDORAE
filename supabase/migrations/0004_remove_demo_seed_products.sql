-- ============================================================
-- Removes the eight demo products created by supabase/seed.sql.
--
-- These are placeholder catalogue entries with no product_media rows at all,
-- which is why they render without images and can be mistaken for a broken
-- import. Run this once the store has real products; it is safe to re-run and
-- touches nothing else (variants, media, category links and inventory rows go
-- with them via on delete cascade).
--
-- Deliberately matched by the exact seeded handles, so nothing an admin or an
-- import created can be caught by it.
--   supabase db execute -f supabase/migrations/0004_remove_demo_seed_products.sql
-- ============================================================

delete from products
where handle in (
  'driftwood-kimono',
  'sage-ocean-sarong',
  'surf-foam-sandals',
  'woven-driftwood-tote',
  'salt-sand-fabric-care-kit',
  'wide-brim-palm-hat',
  'sun-foam-one-piece',
  'coastal-getaway-set'
);
