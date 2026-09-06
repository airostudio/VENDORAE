-- Shipping and tax were hardcoded in checkout (a flat $9.95 with free shipping over $100, and tax
-- always $0 with no tax engine configured) with no way for a merchant to change either without a
-- code change. These columns make both merchant-configurable per tenant; the defaults match the
-- previous hardcoded behavior exactly, so an existing deployment's checkout is unaffected until an
-- admin changes them. tax_rate_percent stays a single flat rate — real jurisdiction-based tax
-- (US nexus/state, GST/VAT) needs a tax engine this store doesn't have, and a merchant who wants
-- exact tax should still configure a Stripe Tax-style provider rather than trust an invented rate.

alter table tenant_settings
  add column if not exists shipping_flat_rate_cents int not null default 995,
  add column if not exists free_shipping_threshold_cents int not null default 10000,
  add column if not exists tax_rate_percent numeric(5,2) not null default 0
    check (tax_rate_percent >= 0 and tax_rate_percent <= 100);
