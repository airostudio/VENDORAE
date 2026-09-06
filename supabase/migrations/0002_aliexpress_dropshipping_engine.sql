-- ============================================================
-- Beach Footprints AliExpress dropshipping engine: supplier linkage on
-- products/variants, fulfillment tracking on orders, price-change audit
-- log, and a fulfillment/sync event log. Safe to re-run (IF NOT EXISTS
-- everywhere).
--
-- Run after schema.sql and 0001_guides_and_hero_secondary_cta.sql, e.g.:
--   supabase db execute -f supabase/migrations/0002_aliexpress_dropshipping_engine.sql
-- ============================================================

-- Daily reconciliation needs a real "out of stock" product status distinct
-- from ARCHIVED (a merchant-initiated delisting) — see runDailyCatalogSync.
alter type product_status add value if not exists 'OUT_OF_STOCK';

do $$ begin
  create type fulfillment_status as enum (
    'unfulfilled',
    'fulfillment_in_progress',
    'shipped',
    'delivered',
    'fulfillment_failed',
    'canceled'
  );
exception when duplicate_object then null;
end $$;

-- Orders: supplier order id, tracking, and a denormalized shipping-address
-- snapshot (schema has no order->address FK today; AliExpress order
-- placement needs the delivery details as they were at checkout time, which
-- must survive the customer later editing/deleting their saved address).
alter table orders add column if not exists shipping_address jsonb;
alter table orders add column if not exists aliexpress_order_id text;
alter table orders add column if not exists tracking_number text;
alter table orders add column if not exists carrier text;
alter table orders add column if not exists fulfillment_status fulfillment_status not null default 'unfulfilled';
alter table orders add column if not exists fulfilled_at timestamptz;
alter table orders add column if not exists shipped_at timestamptz;

create unique index if not exists idx_orders_aliexpress_order_id
  on orders (aliexpress_order_id) where aliexpress_order_id is not null;
create index if not exists idx_orders_fulfillment_status
  on orders (tenant_id, fulfillment_status);

-- Product variants: supplier linkage + explicit margin bookkeeping.
-- `cost` (already on product_variants) continues to hold the current
-- landed supplier cost in cents; `margin_rate` records what multiplier
-- produced `price` so price recalculation logs a meaningful diff.
alter table product_variants add column if not exists supplier text;
alter table product_variants add column if not exists supplier_product_id text;
alter table product_variants add column if not exists supplier_sku_id text;
alter table product_variants add column if not exists margin_rate numeric(6,4);
alter table product_variants add column if not exists supplier_synced_at timestamptz;

create index if not exists idx_product_variants_supplier
  on product_variants (supplier, supplier_product_id, supplier_sku_id);

-- Price-change audit trail (deliverable: ProductPriceLog).
create table if not exists product_price_log (
  id             uuid primary key default gen_random_uuid(),
  variant_id     uuid not null references product_variants(id) on delete cascade,
  previous_cost  int,
  new_cost       int,
  previous_price int,
  new_price      int,
  margin_rate    numeric(6,4),
  reason         text not null default 'supplier_price_change',
  created_at     timestamptz not null default now()
);
create index if not exists idx_product_price_log_variant on product_price_log (variant_id, created_at desc);

-- Fulfillment/sync audit trail: every catalog sync run, order placement
-- attempt, and tracking poll writes one row here (deliverable: GET
-- /api/admin/fulfillment/logs, and the audit-log requirement in general).
create table if not exists fulfillment_logs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  order_id          uuid references orders(id) on delete cascade,
  variant_id        uuid references product_variants(id) on delete set null,
  event             text not null, -- catalog_sync_run | order_place_attempt | order_placed | order_place_failed | tracking_poll | tracking_updated | shipped
  supplier_order_id text,
  detail            jsonb,
  created_at        timestamptz not null default now()
);
create index if not exists idx_fulfillment_logs_tenant on fulfillment_logs (tenant_id, created_at desc);
create index if not exists idx_fulfillment_logs_order on fulfillment_logs (order_id);

alter table product_price_log enable row level security;
alter table fulfillment_logs enable row level security;

do $$ begin
  create policy "tenant members manage product_price_log" on product_price_log for all
    using (exists (
      select 1 from product_variants v join products p on p.id = v.product_id
      where v.id = product_price_log.variant_id and is_tenant_member(p.tenant_id)
    ))
    with check (exists (
      select 1 from product_variants v join products p on p.id = v.product_id
      where v.id = product_price_log.variant_id and is_tenant_member(p.tenant_id)
    ));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "tenant members manage fulfillment_logs" on fulfillment_logs for all
    using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
exception when duplicate_object then null;
end $$;
