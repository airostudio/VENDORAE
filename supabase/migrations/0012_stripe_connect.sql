-- ============================================================
-- Phase 3 — Stripe Connect + commission plumbing.
--
-- tenant_stripe_accounts tracks each tenant's connected Stripe Express account (the account that
-- receives THEIR customers' checkout money directly — a Connect "direct charge" — as opposed to
-- tenant_licenses, which is about the platform's OWN Stripe account charging the tenant a SaaS
-- license fee). See apps/web/lib/platform/connect.ts for the onboarding-link + status-sync flow
-- that populates this table, and apps/web/app/api/checkout/session/route.ts for how checkout
-- picks the connected account over a tenant's own pasted keys once charges_enabled is true.
-- ============================================================

create table tenant_stripe_accounts (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null unique references tenants(id) on delete cascade,
  stripe_account_id text not null unique,
  charges_enabled   boolean not null default false,
  payouts_enabled   boolean not null default false,
  details_submitted boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_tenant_stripe_accounts_updated_at before update on tenant_stripe_accounts
  for each row execute function set_updated_at();

-- Unlike tenant_licenses, nothing here is a secret — a Stripe Connect account id isn't usable to
-- move money without the platform's own API key, and the booleans are just onboarding status — so
-- it's fine (and useful) for a tenant's own admin to read their own row directly. Writes still go
-- through service-role code only (the onboarding-link flow and the account.updated webhook), so
-- there's no insert/update/delete policy at all.
alter table tenant_stripe_accounts enable row level security;

create policy "tenant members view own connect account" on tenant_stripe_accounts for select
  using (is_tenant_member(tenant_id));

-- The commission Vendorae takes on a Connect-charged order, in basis points (200 = 2%). Lives on
-- tenant_licenses (one row per tenant already) rather than a new table since it is, for now, a
-- single flat value — once tiered plans (Starter/Business/Pro/Elite) exist this becomes
-- plan-driven instead of a per-tenant column, but that's a later migration.
--
-- IMPORTANT: this column's default only applies to rows inserted from now on. A tenant with NO
-- tenant_licenses row at all (every tenant provisioned before this migration, including the
-- original pre-Phase-2 default tenant) must be treated as 0 commission by application code — see
-- apps/web/lib/platform/connect.ts's getConnectContextForCheckout — never as this column's
-- default, or a legacy tenant would silently start losing 2% of every sale it never agreed to.
alter table tenant_licenses add column commission_bps integer not null default 200;
