-- ============================================================
-- Vendorae — Default tenant seed
-- Run after supabase/schema.sql, e.g.:
--   supabase db execute -f supabase/seed.sql
--
-- Intentionally blank: this creates only the single default tenant and the
-- minimal reference rows the storefront/admin need to not crash on an empty
-- store (a shipping zone/method, a tax settings row). No demo products,
-- categories, banners or reviews are inserted — a freshly-provisioned store
-- has no catalogue and no prior brand identity, and is sent to the
-- /onboarding setup wizard (tenant_settings.onboarding_completed = false)
-- to collect the real owner's business info, logo and payment credentials
-- before anything is shown to a customer.
-- ============================================================

do $$
declare
  v_tenant_id uuid;
  v_zone_id uuid;
begin
  -- ── Tenant ──────────────────────────────────────────────────
  insert into tenants (name, slug, is_active)
  values ('Your Store', 'default-store', true)
  returning id into v_tenant_id;

  -- brand_name is a placeholder until the setup wizard saves the owner's real business name;
  -- onboarding_completed stays false until the wizard has run, which is what routes every
  -- storefront request to /onboarding (see apps/web/middleware.ts).
  insert into tenant_settings (
    tenant_id, brand_name, base_currency, enabled_currencies, cookie_consent_enabled,
    seo_title_default, seo_desc_default, onboarding_completed
  ) values (
    v_tenant_id, 'Your Store', 'USD', array['USD'], true,
    'Your Store', null, false
  );

  insert into tax_settings (tenant_id, mode, is_tax_inclusive, default_rate_bps)
  values (v_tenant_id, 'MANUAL', false, 0);

  -- A shipping zone/method is required for checkout to compute a rate at all — without at least
  -- one, every cart would fail to check out even after the wizard is completed and products are
  -- added, so this is reference data rather than demo content.
  insert into shipping_zones (tenant_id, name, countries, is_active)
  values (v_tenant_id, 'United States', array['US'], true)
  returning id into v_zone_id;

  insert into shipping_methods (tenant_id, zone_id, name, price, currency, allowed_shipping_classes, eta_days_min, eta_days_max, is_active)
  values
    (v_tenant_id, v_zone_id, 'Standard Shipping', 599, 'USD', array['STANDARD','HEAVY']::shipping_class[], 5, 12, true),
    (v_tenant_id, v_zone_id, 'Express Shipping', 1499, 'USD', array['STANDARD','HEAVY','OVERSIZED']::shipping_class[], 2, 5, true);

  raise notice 'Seeded default tenant % (blank — no demo catalogue)', v_tenant_id;
end $$;
