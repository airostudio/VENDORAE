-- ============================================================
-- Setup wizard fields on tenant_settings.
--
-- Adds the columns the /onboarding wizard reads and writes: business info,
-- an onboarding_completed flag that gates the storefront (see
-- apps/web/middleware.ts), and Stripe/PayPal credential fallbacks for a
-- self-serve owner who has no access to this deployment's environment
-- variables (an operator deployment that sets STRIPE_SECRET_KEY etc. as env
-- vars keeps taking priority over these — see
-- apps/web/lib/config/paymentCredentials.ts).
--
-- logo_url already exists on tenant_settings (added in the original schema)
-- and is reused as-is by the wizard's logo step rather than duplicated here.
--
-- These are sensitive columns (raw Stripe/PayPal secrets) — tenant_settings
-- already has row level security enabled with a single tenant-member-only
-- policy ("tenant members manage tenant_settings" on tenant_settings for
-- all, using is_tenant_member(tenant_id)) and no public/anon SELECT policy,
-- so no RLS change is needed for these columns to stay hidden from
-- customers; only tenant staff (or the service-role key used by the
-- onboarding API routes) can read or write them.
-- ============================================================

alter table tenant_settings
  add column if not exists business_description text,
  add column if not exists product_niche text,
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists stripe_secret_key text,
  add column if not exists stripe_publishable_key text,
  add column if not exists stripe_webhook_secret text,
  add column if not exists paypal_client_id text,
  add column if not exists paypal_client_secret text,
  add column if not exists paypal_mode text not null default 'sandbox';

alter table tenant_settings
  drop constraint if exists tenant_settings_paypal_mode_check;
alter table tenant_settings
  add constraint tenant_settings_paypal_mode_check check (paypal_mode in ('sandbox', 'live'));
