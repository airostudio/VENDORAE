-- ============================================================
-- Beach Footprints — Demo seed data
-- Run after supabase/schema.sql, e.g.:
--   supabase db execute -f supabase/seed.sql
--
-- A small demo catalogue for local development / preview environments.
-- ============================================================

do $$
declare
  v_tenant_id uuid;
  v_zone_id uuid;

  v_cat_dresses uuid; v_cat_swim uuid; v_cat_accessories uuid; v_cat_care uuid;
  v_cat_new uuid; v_cat_best uuid; v_cat_sale uuid; v_cat_bundles uuid;

  v_prod_kimono uuid; v_prod_sarong uuid; v_prod_sandals uuid; v_prod_bag uuid;
  v_prod_care_kit uuid; v_prod_hat uuid; v_prod_swimsuit uuid; v_prod_bundle uuid;

  v_variant_id uuid;
begin
  -- ── Tenant ──────────────────────────────────────────────────
  insert into tenants (name, slug, is_active)
  values ('Beach Footprints Demo', 'beach-footprints-demo', true)
  returning id into v_tenant_id;

  insert into tenant_settings (
    tenant_id, brand_name, base_currency, enabled_currencies, cookie_consent_enabled,
    seo_title_default, seo_desc_default
  ) values (
    v_tenant_id, 'Beach Footprints', 'USD', array['USD'], true,
    'Beach Footprints', 'Boho surf lifestyle — apparel and accessories for warm sand and salt air.'
  );

  insert into tax_settings (tenant_id, mode, is_tax_inclusive, default_rate_bps)
  values (v_tenant_id, 'MANUAL', false, 0);

  -- ── Shipping ────────────────────────────────────────────────
  insert into shipping_zones (tenant_id, name, countries, is_active)
  values (v_tenant_id, 'United States', array['US'], true)
  returning id into v_zone_id;

  insert into shipping_methods (tenant_id, zone_id, name, price, currency, allowed_shipping_classes, eta_days_min, eta_days_max, is_active)
  values
    (v_tenant_id, v_zone_id, 'Standard Shipping', 599, 'USD', array['STANDARD','HEAVY']::shipping_class[], 5, 12, true),
    (v_tenant_id, v_zone_id, 'Express Shipping', 1499, 'USD', array['STANDARD','HEAVY','OVERSIZED']::shipping_class[], 2, 5, true);

  -- ── Categories ──────────────────────────────────────────────
  insert into categories (tenant_id, name, handle, description) values
    (v_tenant_id, 'Dresses & Kimonos', 'dresses-kimonos', 'Flowy silhouettes for golden-hour beach walks.') returning id into v_cat_dresses;
  insert into categories (tenant_id, name, handle, description) values
    (v_tenant_id, 'Swim', 'swim', 'Sun-ready swimwear and cover-ups.') returning id into v_cat_swim;
  insert into categories (tenant_id, name, handle, description) values
    (v_tenant_id, 'Accessories', 'accessories', 'Bags, hats and the finishing touches.') returning id into v_cat_accessories;
  insert into categories (tenant_id, name, handle, description) values
    (v_tenant_id, 'Care', 'care', 'Gentle care essentials to keep your pieces looking new.') returning id into v_cat_care;
  insert into categories (tenant_id, name, handle) values (v_tenant_id, 'New Arrivals', 'new-arrivals') returning id into v_cat_new;
  insert into categories (tenant_id, name, handle) values (v_tenant_id, 'Best Sellers', 'best-sellers') returning id into v_cat_best;
  insert into categories (tenant_id, name, handle) values (v_tenant_id, 'Sale', 'sale') returning id into v_cat_sale;
  insert into categories (tenant_id, name, handle) values (v_tenant_id, 'Bundles', 'bundles') returning id into v_cat_bundles;

  -- ── Products ────────────────────────────────────────────────
  insert into products (tenant_id, product_type, title, handle, short_description, status, shipping_class, stock_policy, dispatch_days)
  values (v_tenant_id, 'STANDARD', 'Driftwood Kimono', 'driftwood-kimono',
          'Lightweight woven kimono in warm sand and terracotta stripes.', 'PUBLISHED', 'STANDARD', 'IN_STOCK', 3)
  returning id into v_prod_kimono;

  insert into products (tenant_id, product_type, title, handle, short_description, status, shipping_class, stock_policy, dispatch_days)
  values (v_tenant_id, 'STANDARD', 'Sage Ocean Sarong', 'sage-ocean-sarong',
          'Hand-dyed sarong in muted sage, doubles as a beach wrap or throw.', 'PUBLISHED', 'STANDARD', 'IN_STOCK', 3)
  returning id into v_prod_sarong;

  insert into products (tenant_id, product_type, title, handle, short_description, status, shipping_class, stock_policy, dispatch_days)
  values (v_tenant_id, 'STANDARD', 'Surf Foam Sandals', 'surf-foam-sandals',
          'Barely-there woven sandals built for sand, boardwalks and everything between.', 'PUBLISHED', 'STANDARD', 'IN_STOCK', 4)
  returning id into v_prod_sandals;

  insert into products (tenant_id, product_type, title, handle, short_description, status, shipping_class, stock_policy, dispatch_days)
  values (v_tenant_id, 'ACCESSORY', 'Woven Driftwood Tote', 'woven-driftwood-tote',
          'Hand-woven straw tote roomy enough for a towel, a book and the day''s essentials.', 'PUBLISHED', 'STANDARD', 'IN_STOCK', 5)
  returning id into v_prod_bag;

  insert into products (tenant_id, product_type, title, handle, short_description, status, shipping_class, stock_policy)
  values (v_tenant_id, 'CARE_PRODUCT', 'Salt & Sand Fabric Care Kit', 'salt-sand-fabric-care-kit',
          'Gentle wash and UV-protectant spray formulated for sun-worn fabrics.', 'PUBLISHED', 'STANDARD', 'IN_STOCK')
  returning id into v_prod_care_kit;

  insert into products (tenant_id, product_type, title, handle, short_description, status, shipping_class, stock_policy)
  values (v_tenant_id, 'ACCESSORY', 'Wide Brim Palm Hat', 'wide-brim-palm-hat',
          'Hand-plaited palm-leaf hat with an adjustable terracotta band.', 'PUBLISHED', 'STANDARD', 'IN_STOCK')
  returning id into v_prod_hat;

  insert into products (tenant_id, product_type, title, handle, short_description, status, shipping_class, stock_policy, dispatch_days)
  values (v_tenant_id, 'STANDARD', 'Sun Foam One-Piece', 'sun-foam-one-piece',
          'Ribbed one-piece swimsuit in warm sand with a low scoop back.', 'PUBLISHED', 'STANDARD', 'IN_STOCK', 3)
  returning id into v_prod_swimsuit;

  insert into products (tenant_id, product_type, title, handle, short_description, status, shipping_class, stock_policy)
  values (v_tenant_id, 'BUNDLE', 'Coastal Getaway Set', 'coastal-getaway-set',
          'Sarong, tote and hat together at a bundle saving.', 'PUBLISHED', 'STANDARD', 'IN_STOCK')
  returning id into v_prod_bundle;

  -- ── Category assignments ───────────────────────────────────
  insert into product_categories (product_id, category_id) values
    (v_prod_kimono, v_cat_dresses), (v_prod_kimono, v_cat_new),
    (v_prod_sarong, v_cat_dresses), (v_prod_sarong, v_cat_best),
    (v_prod_sandals, v_cat_accessories), (v_prod_sandals, v_cat_new),
    (v_prod_bag, v_cat_accessories), (v_prod_bag, v_cat_best),
    (v_prod_care_kit, v_cat_care),
    (v_prod_hat, v_cat_accessories),
    (v_prod_swimsuit, v_cat_swim), (v_prod_swimsuit, v_cat_new),
    (v_prod_bundle, v_cat_bundles), (v_prod_bundle, v_cat_sale);

  -- ── Variants + inventory (one default variant per product) ─
  insert into product_variants (product_id, sku, price, currency, is_active)
  values (v_prod_kimono, 'DRIFT-KIMONO-DEFAULT', 6800, 'USD', true) returning id into v_variant_id;
  insert into inventory_items (variant_id, stock_on_hand, low_stock_threshold) values (v_variant_id, 40, 5);

  insert into product_variants (product_id, sku, price, currency, is_active)
  values (v_prod_sarong, 'SAGE-SARONG-DEFAULT', 4200, 'USD', true) returning id into v_variant_id;
  insert into inventory_items (variant_id, stock_on_hand, low_stock_threshold) values (v_variant_id, 60, 8);

  insert into product_variants (product_id, sku, price, currency, is_active)
  values (v_prod_sandals, 'SURF-SANDALS-DEFAULT', 5400, 'USD', true) returning id into v_variant_id;
  insert into inventory_items (variant_id, stock_on_hand, low_stock_threshold) values (v_variant_id, 50, 8);

  insert into product_variants (product_id, sku, price, currency, is_active)
  values (v_prod_bag, 'DRIFT-TOTE-DEFAULT', 5900, 'USD', true) returning id into v_variant_id;
  insert into inventory_items (variant_id, stock_on_hand, low_stock_threshold) values (v_variant_id, 35, 5);

  insert into product_variants (product_id, sku, price, currency, is_active)
  values (v_prod_care_kit, 'SALT-CARE-KIT-DEFAULT', 2900, 'USD', true) returning id into v_variant_id;
  insert into inventory_items (variant_id, stock_on_hand, low_stock_threshold) values (v_variant_id, 80, 10);

  insert into product_variants (product_id, sku, price, currency, is_active)
  values (v_prod_hat, 'PALM-HAT-DEFAULT', 3800, 'USD', true) returning id into v_variant_id;
  insert into inventory_items (variant_id, stock_on_hand, low_stock_threshold) values (v_variant_id, 45, 6);

  insert into product_variants (product_id, sku, price, currency, is_active)
  values (v_prod_swimsuit, 'SUN-ONEPIECE-DEFAULT', 7200, 'USD', true) returning id into v_variant_id;
  insert into inventory_items (variant_id, stock_on_hand, low_stock_threshold) values (v_variant_id, 30, 5);

  insert into product_variants (product_id, sku, price, compare_at, currency, is_active)
  values (v_prod_bundle, 'COASTAL-SET', 12900, 15900, 'USD', true) returning id into v_variant_id;
  insert into inventory_items (variant_id, stock_on_hand, low_stock_threshold) values (v_variant_id, 20, 5);

  -- ── Compatibility links (accessories, care) ────────────────
  insert into compatibility_links (from_product_id, to_product_id, relation_type) values
    (v_prod_kimono, v_prod_care_kit, 'care_product'),
    (v_prod_sarong, v_prod_care_kit, 'care_product'),
    (v_prod_swimsuit, v_prod_care_kit, 'care_product'),
    (v_prod_sarong, v_prod_bag, 'compatible_accessory'),
    (v_prod_sandals, v_prod_hat, 'compatible_accessory');

  -- ── Bundle items ─────────────────────────────────────────────
  insert into bundle_items (bundle_product_id, child_product_id, quantity) values
    (v_prod_bundle, v_prod_sarong, 1),
    (v_prod_bundle, v_prod_bag, 1),
    (v_prod_bundle, v_prod_hat, 1);

  -- ── Homepage hero banner ────────────────────────────────────
  insert into banners (tenant_id, placement, headline, body, cta_label, cta_href, secondary_cta_label, secondary_cta_href, position, is_active) values
    (v_tenant_id, 'homepage_hero', 'Warm Sand, Salt Air, Slow Days',
     'Boho surf-culture apparel and accessories — woven, hand-dyed and built for barefoot mornings.',
     'Shop New Arrivals', '/shop/new-arrivals', 'Shop All', '/shop', 0, true);

  -- ── Guides (as blog_posts) ──────────────────────────────────
  insert into blog_posts (tenant_id, title, slug, content, category, status) values
    (v_tenant_id, 'A Boho Beach Capsule Wardrobe', 'boho-beach-capsule-wardrobe',
     'A calm, practical guide to building a small, versatile beach-and-boardwalk wardrobe.', 'Style Guide', 'PUBLISHED'),
    (v_tenant_id, 'Woven Fibres vs. Synthetic Blends', 'woven-fibres-vs-synthetic-blends',
     'Breathability, durability and care differences compared side by side.', 'Materials', 'PUBLISHED'),
    (v_tenant_id, 'Fabric Care 101', 'fabric-care-101',
     'Washing, drying and storage habits that keep sun-and-salt-worn pieces looking new.', 'Care', 'PUBLISHED'),
    (v_tenant_id, 'Packing for a Coastal Getaway', 'packing-for-a-coastal-getaway',
     'What to bring, what to leave behind, and how to layer for warm days and cool evenings.', 'Travel', 'PUBLISHED');

  raise notice 'Seeded tenant %', v_tenant_id;
end $$;
