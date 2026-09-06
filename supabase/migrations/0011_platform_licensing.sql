-- ============================================================
-- Phase 2 — Platform license marketplace.
--
-- tenant_licenses tracks each tenant's platform subscription (the SaaS
-- license fee Vendorae charges store owners, via the platform's OWN Stripe
-- account — see apps/web/lib/platform/stripe.ts — completely separate from
-- a tenant's own Stripe/PayPal keys used for THEIR customers' checkout).
--
-- provision_tenant() creates a tenant + tenant_settings + tenant_licenses
-- row atomically in one transaction, and is safe to call more than once for
-- the same Stripe Checkout Session (see apps/web/lib/platform/provisionTenant.ts,
-- called from both the platform webhook and the buyer's browser landing on
-- /platform/welcome — whichever arrives first wins, the other is a no-op).
-- ============================================================

create table tenant_licenses (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null unique references tenants(id) on delete cascade,
  stripe_customer_id        text,
  stripe_subscription_id    text,
  -- Idempotency key for provisioning: the Stripe Checkout Session that created this tenant. A
  -- unique constraint here is what lets provision_tenant() be called twice (webhook + welcome
  -- page racing) without ever creating two tenants for one purchase.
  stripe_checkout_session_id text not null unique,
  -- Mirrors Stripe's own subscription status vocabulary (active, past_due, canceled, incomplete,
  -- incomplete_expired, trialing, unpaid) rather than inventing a separate one, so webhook
  -- handlers can just copy `subscription.status` straight across.
  status                    text not null,
  current_period_end        timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create trigger trg_tenant_licenses_updated_at before update on tenant_licenses
  for each row execute function set_updated_at();

-- Service-role only: no tenant-facing read/write policy. A tenant viewing their own billing
-- status from /admin is future scope (see the Phase 2 task notes) — for now these Stripe IDs
-- and subscription status are not exposed to anyone but server-side platform code.
alter table tenant_licenses enable row level security;

-- ── Atomic provisioning ─────────────────────────────────────
-- Creates tenants + tenant_settings + tenant_licenses for one paid Checkout Session in a single
-- transaction. Idempotent on stripe_checkout_session_id: a second call for a session that has
-- already been provisioned just returns the tenant already created for it, never a duplicate.
-- p_slug_base is re-deduped here (not just at checkout-initiation time) in case another purchase
-- raced for the same name since the session was created.
create or replace function public.provision_tenant(
  p_checkout_session_id     text,
  p_slug_base               text,
  p_store_name              text,
  p_stripe_customer_id      text,
  p_stripe_subscription_id  text,
  p_status                  text,
  p_current_period_end      timestamptz
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
    status, current_period_end
  ) values (
    v_tenant_id, p_stripe_customer_id, p_stripe_subscription_id, p_checkout_session_id,
    p_status, p_current_period_end
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
