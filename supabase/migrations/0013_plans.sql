-- ============================================================
-- Tiered platform plans (replaces the "one flat license price" model from
-- migration 0011). Starter/Business/Pro/Elite are paid subscription tiers;
-- `free` ("Start Selling") takes no subscription fee at all and instead
-- charges a higher direct-sale commission — a deliberate $0-upfront
-- acquisition channel ("no sale = they pay nothing").
--
-- Each plan's `commission_bps` is copied onto the tenant's tenant_licenses
-- row at provisioning time (see provision_tenant() below) — the existing
-- Stripe Connect commission logic in apps/web/lib/platform/connect.ts
-- already reads tenant_licenses.commission_bps at checkout time and needs
-- no changes at all; this migration only changes how that column gets set.
-- ============================================================

create table plans (
  id                          uuid primary key default gen_random_uuid(),
  slug                        text not null unique,             -- 'free' | 'starter' | 'business' | 'pro' | 'elite'
  name                        text not null,                    -- display name, e.g. "Business"
  -- Display only. For a paid plan, the real charge is whatever Stripe Price `stripe_price_id`
  -- points at — this column exists so the free plan (stripe_price_id null) still has something to
  -- render, and so the pricing page doesn't need a live Stripe call per plan just to show a price.
  monthly_price_cents         int not null default 0,
  -- null = no Stripe subscription at all (the free/commission-only plan, or a paid tier the
  -- operator hasn't finished configuring a real Stripe Price for yet).
  stripe_price_id             text,
  -- This plan's DIRECT-sale commission rate, in basis points (200 = 2%).
  commission_bps              int not null default 0,
  -- RESERVED for a future marketplace-attributed-order rate (a different commission for an order
  -- that came through a not-yet-built marketplace/discovery feature, vs. a direct sale). Nothing
  -- reads or writes this column yet — it exists purely so this migration doesn't need revisiting
  -- when that feature ships.
  marketplace_commission_bps  int not null default 0,
  product_limit               int,                               -- null = unlimited
  staff_limit                 int not null default 1,
  custom_domain_allowed       boolean not null default false,
  feature_list                text[] not null default '{}',      -- marketing bullet points for the pricing page
  sort_order                  int not null default 0,
  is_active                   boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create trigger trg_plans_updated_at before update on plans
  for each row execute function set_updated_at();

-- Public-facing catalog data (the pricing page shows it to anyone), but read only through
-- server-rendered pages using the service-role client — the same convention this codebase already
-- uses for other public-but-not-tenant-scoped catalog data (see apps/web/lib/data/categories.ts).
-- No anon/authenticated SELECT policy is needed since nothing reads this table client-side.
alter table plans enable row level security;

insert into plans
  (slug, name, monthly_price_cents, stripe_price_id, commission_bps, product_limit, staff_limit, custom_domain_allowed, feature_list, sort_order)
values
  ('free', 'Start Selling', 0, null, 500, 15, 1, false,
    array[
      'No monthly fee — pay only a commission when you make a sale',
      'Up to 15 products',
      'AI store builder and AliExpress product importing',
      'Your own subdomain storefront'
    ], 0),
  -- $29/month placeholder for display until the operator creates a real Stripe Price for this
  -- tier and sets stripe_price_id — the live Stripe amount is what's actually charged once that's
  -- configured; until then this plan simply isn't purchasable (see the checkout route).
  ('starter', 'Starter', 2900, null, 200, 50, 1, false,
    array[
      'Up to 50 products',
      'Lower 2% commission on direct sales',
      'AI store builder and AliExpress product importing',
      'Abandoned cart emails'
    ], 1),
  ('business', 'Business', 7900, null, 100, 500, 3, true,
    array[
      'Up to 500 products',
      '1% commission on direct sales',
      '3 staff seats',
      'Custom domain support',
      'Abandoned cart emails'
    ], 2),
  ('pro', 'Pro', 14900, null, 50, null, 10, true,
    array[
      'Unlimited products',
      '0.5% commission on direct sales',
      '10 staff seats',
      'Custom domain support',
      'Priority support'
    ], 3),
  ('elite', 'Elite', 29900, null, 25, null, 10, true,
    array[
      'Unlimited products',
      '0.25% commission on direct sales',
      '10 staff seats',
      'Custom domain support',
      'Priority support'
    ], 4);

-- ── plan_id on tenant_licenses ──────────────────────────────
-- Nullable: rows created before plans existed (or a free signup provisioned before an operator
-- deleted its plan row) have none. Application code must treat a null plan_id honestly (e.g. "no
-- plan on file"), never assume it means the free plan.
alter table tenant_licenses add column plan_id uuid references plans(id);

-- ── provision_tenant(): now plan-aware ──────────────────────
-- Postgres treats a different parameter list as a distinct overload rather than replacing the
-- old function in place, so the old 7-arg signature is dropped explicitly before creating the new
-- 9-arg one — otherwise both would exist side by side (the old one still callable, still granted).
drop function if exists public.provision_tenant(text, text, text, text, text, text, timestamptz);

create or replace function public.provision_tenant(
  p_checkout_session_id     text,
  p_slug_base               text,
  p_store_name              text,
  p_stripe_customer_id      text,
  p_stripe_subscription_id  text,
  p_status                  text,
  p_current_period_end      timestamptz,
  p_plan_id                 uuid,
  p_commission_bps          int
) returns table(tenant_id uuid, slug text)
language plpgsql
security definer
as $$
declare
  v_tenant_id uuid;
  v_slug      text;
  v_suffix    int := 2;
begin
  -- Already provisioned (webhook and /platform/welcome can both call this for the same session;
  -- whichever wins the race below runs the inserts, the other lands here).
  return query
    select tl.tenant_id, t.slug
    from tenant_licenses tl join tenants t on t.id = tl.tenant_id
    where tl.stripe_checkout_session_id = p_checkout_session_id;
  if found then
    return;
  end if;

  v_slug := p_slug_base;
  while exists (select 1 from tenants where slug = v_slug) loop
    v_slug := p_slug_base || '-' || v_suffix;
    v_suffix := v_suffix + 1;
  end loop;

  insert into tenants (name, slug, is_active) values (p_store_name, v_slug, true)
  returning id into v_tenant_id;

  insert into tenant_settings (tenant_id, brand_name, onboarding_completed)
  values (v_tenant_id, p_store_name, false);

  insert into tenant_licenses (
    tenant_id, stripe_customer_id, stripe_subscription_id, stripe_checkout_session_id,
    status, current_period_end, plan_id, commission_bps
  ) values (
    v_tenant_id, p_stripe_customer_id, p_stripe_subscription_id, p_checkout_session_id,
    p_status, p_current_period_end, p_plan_id, p_commission_bps
  )
  on conflict (stripe_checkout_session_id) do nothing;

  if not found then
    -- Lost a race against a concurrent call for the SAME checkout session (both passed the
    -- idempotency check above before either committed) — the tenant just created here would be
    -- an orphan duplicate with no license row, so undo it and return the winner's tenant instead.
    delete from tenant_settings where tenant_id = v_tenant_id;
    delete from tenants where id = v_tenant_id;

    return query
      select tl.tenant_id, t.slug
      from tenant_licenses tl join tenants t on t.id = tl.tenant_id
      where tl.stripe_checkout_session_id = p_checkout_session_id;
    return;
  end if;

  return query select v_tenant_id, v_slug;
end;
$$;

-- provision_tenant() is SECURITY DEFINER and trusts its arguments completely — it does no Stripe
-- verification itself (that happens in apps/web/lib/platform/provisionTenant.ts before it ever
-- calls this). PostgREST exposes every public-schema function as an RPC endpoint by default, so
-- without this, anyone holding the public anon key could call /rest/v1/rpc/provision_tenant
-- directly with a fabricated session id and status="active" and mint themselves a free store,
-- bypassing payment entirely. Lock it down to the service role, which is the only caller
-- (createServiceRoleSupabaseClient()). Dropping/recreating the function above drops its grants
-- too, so this must be re-applied here.
revoke execute on function public.provision_tenant(text, text, text, text, text, text, timestamptz, uuid, int) from public, anon, authenticated;
grant execute on function public.provision_tenant(text, text, text, text, text, text, timestamptz, uuid, int) to service_role;
