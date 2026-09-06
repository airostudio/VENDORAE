-- ============================================================
-- AliExpress import staging area.
--
-- Products pasted in bulk land here first — fetched from the engine, priced,
-- AI-rewritten and category-suggested — where they can be reviewed and edited
-- before anything is written into `products`. Nothing here is visible to the
-- storefront; a row only becomes a real product when it is confirmed, at which
-- point `confirmed_product_id` records what it became.
--
-- Run after 0002_aliexpress_dropshipping_engine.sql, e.g.:
--   supabase db execute -f supabase/migrations/0003_aliexpress_staging.sql
-- ============================================================

create table if not exists aliexpress_staged_products (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,

  aliexpress_product_id text not null,
  source_url            text,

  -- 'ready'     — fetched and rewritten, awaiting review/confirmation
  -- 'failed'    — the engine or AliExpress rejected it; `error` says why
  -- 'confirmed' — already committed into products (kept as an audit trail)
  status text not null default 'ready',
  error  text,

  -- Editable copy. Seeded from the engine's AI-rewritten output, then owned by
  -- whoever edits the staged listing.
  title             text,
  short_description text,
  description       text,
  seo_title         text,
  seo_desc          text,

  category_id           uuid references categories(id) on delete set null,
  suggested_category_id uuid references categories(id) on delete set null,

  publish       boolean not null default false,
  -- Deliberately text-with-a-check rather than the `product_type` enum: this is a
  -- staging value that only becomes a real enum value when the row is committed into
  -- `products`, and not depending on the enum keeps this migration runnable whatever
  -- schema the enum happens to live in.
  product_type  text not null default 'STANDARD'
    check (product_type in ('STANDARD','ACCESSORY','CARE_PRODUCT','BUNDLE','GIFT_CARD')),
  brand         text,

  currency_code text,
  image_urls    jsonb not null default '[]'::jsonb,
  -- [{ aliexpressSkuId, properties, retailPriceCents, compareAtCents, supplierCostCents, marginRate, stockOnHand, isActive }]
  skus          jsonb not null default '[]'::jsonb,
  -- Untouched engine payload, so a staged row can always be re-derived/diffed.
  raw           jsonb,

  confirmed_product_id uuid references products(id) on delete set null,
  confirmed_at         timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- schema.sql already defines set_updated_at(); create it only if this database
-- somehow doesn't have it, so the migration can't fail on a missing helper.
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'set_updated_at') then
    create function set_updated_at() returns trigger language plpgsql as $fn$
      begin new.updated_at = now(); return new; end
    $fn$;
  end if;
end $$;

do $$ begin
  create trigger trg_aliexpress_staged_products_updated_at
    before update on aliexpress_staged_products
    for each row execute function set_updated_at();
exception when duplicate_object then null;
end $$;

-- The same AliExpress product may only sit in the staging queue once, but may
-- be re-staged later after it has been confirmed (e.g. to re-import changes).
create unique index if not exists idx_aliexpress_staged_pending_unique
  on aliexpress_staged_products (tenant_id, aliexpress_product_id)
  where status <> 'confirmed';

create index if not exists idx_aliexpress_staged_tenant_status
  on aliexpress_staged_products (tenant_id, status, created_at desc);
