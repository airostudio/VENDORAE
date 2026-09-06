-- ============================================================================
-- Beach Footprints — combined migration 0003 → 0006
--
-- Everything outstanding for the AliExpress staging area, in one file. Run it
-- against the BEACH FOOTPRINTS Supabase project (the one holding products,
-- categories and tenants) — NOT the dropship engine's database.
--
-- Safe to run on a database where some of these have already been applied:
-- every statement is guarded (`if not exists` / a duplicate-object catch), and
-- the whole thing runs in one transaction, so either all of it lands or none
-- of it does.
--
-- Sanity check — if this errors saying `tenants`, `categories` or `products`
-- does not exist, you are pointed at the wrong project.
--
-- Sections:
--   1. Staging table                    (0003)
--   2. Shipping weight on staged rows   (0005)
--   3. Supplier specifications          (0006)
--   4. OPTIONAL: delete the 8 demo products (0004) — destructive, read first
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. AliExpress import staging area (0003)
--
-- Products pasted in bulk land here first — fetched, priced, AI-rewritten and
-- category-suggested — to be reviewed and edited before anything is written
-- into `products`. Nothing here is visible to the storefront; a row becomes a
-- real product only when confirmed, and `confirmed_product_id` records what it
-- became.
-- ----------------------------------------------------------------------------

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

  -- Editable copy. Seeded from the AI-rewritten output, then owned by whoever
  -- edits the staged listing.
  title             text,
  short_description text,
  description       text,
  seo_title         text,
  seo_desc          text,

  category_id           uuid references categories(id) on delete set null,
  suggested_category_id uuid references categories(id) on delete set null,

  publish       boolean not null default false,
  -- Deliberately text-with-a-check rather than the `product_type` enum: this is
  -- a staging value that only becomes a real enum value when the row is
  -- committed into `products`, and not depending on the enum keeps this
  -- migration runnable whatever schema the enum happens to live in.
  product_type  text not null default 'STANDARD'
    check (product_type in ('STANDARD','ACCESSORY','CARE_PRODUCT','BUNDLE','GIFT_CARD')),
  brand         text,

  currency_code text,
  image_urls    jsonb not null default '[]'::jsonb,
  -- [{ aliexpressSkuId, properties, retailPriceCents, compareAtCents,
  --    supplierCostCents, marginRate, stockOnHand, isActive, options }]
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

-- ----------------------------------------------------------------------------
-- 2. Shipping weight on staged imports (0005)
--
-- AliExpress returns a package gross weight; without somewhere to hold it, an
-- imported product lands with no weight and can't be rated for shipping.
-- ----------------------------------------------------------------------------

alter table aliexpress_staged_products
  add column if not exists package_weight_grams int;

-- ----------------------------------------------------------------------------
-- 3. Supplier specifications on staged imports (0006)
--
-- AliExpress returns a spec table (Material, Style, Season…) at
-- result.ae_item_properties. Holding it on the staged row lets it be reviewed
-- and edited before it becomes product_specs rows on the real product.
-- ----------------------------------------------------------------------------

alter table aliexpress_staged_products
  add column if not exists attributes jsonb not null default '[]'::jsonb;

commit;

-- ============================================================================
-- 4. OPTIONAL — remove the 8 demo products from seed.sql (0004)
--
-- DESTRUCTIVE. These are the placeholder catalogue entries created by
-- supabase/seed.sql. They have no product_media rows at all, which is why they
-- render without images and are easily mistaken for a broken import
-- ("Woven Driftwood Tote" is one of them, not an AliExpress import).
--
-- Deleting a product cascades to its variants, images, category links and
-- inventory rows. Matched by the exact seeded handles, so nothing you or the
-- importer created can be caught by it.
--
-- Skip this section if you want to keep them: everything above has already
-- been committed by the time you get here.
--
-- To check what would go first:
--   select handle, title, status from products
--   where handle in ('driftwood-kimono','sage-ocean-sarong','surf-foam-sandals',
--     'woven-driftwood-tote','salt-sand-fabric-care-kit','wide-brim-palm-hat',
--     'sun-foam-one-piece','coastal-getaway-set');
-- ============================================================================

begin;

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

commit;
