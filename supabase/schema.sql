-- ============================================================
-- Beach Footprints — Supabase Schema
-- Run in the Supabase SQL Editor (Dashboard → SQL Editor), or:
--   supabase db execute -f supabase/schema.sql
--
-- Replaces the earlier Prisma schema (packages/db/prisma) — this file is
-- the single source of truth for the data model. Identity is Supabase Auth
-- (auth.users): staff accounts via `memberships`, shopper accounts via
-- `customers.auth_user_id` (nullable — guest checkout does not require one).
-- ============================================================

create extension if not exists "pgcrypto";

-- ── updated_at helper ───────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── Enums ────────────────────────────────────────────────────
create type tenancy_mode        as enum ('SAAS','SELF_HOSTED');
create type user_role           as enum ('OWNER','ADMIN','MANAGER','SUPPORT','MARKETING','READONLY');
create type product_status      as enum ('DRAFT','PUBLISHED','ARCHIVED');
create type product_type        as enum ('STANDARD','ACCESSORY','CARE_PRODUCT','BUNDLE','GIFT_CARD');
create type shipping_class      as enum ('STANDARD','HEAVY','OVERSIZED','FREIGHT','SPECIAL');
create type stock_policy        as enum ('IN_STOCK','MADE_TO_ORDER','PREORDER','BACKORDER','DISCONTINUED');
create type order_status        as enum ('DRAFT','PENDING_PAYMENT','PAID','FULFILLING','FULFILLED','DELIVERED','CANCELED','RETURN_REQUESTED','RETURNED','REFUNDED');
create type payment_status      as enum ('REQUIRES_ACTION','PROCESSING','SUCCEEDED','FAILED','REFUNDED','PARTIALLY_REFUNDED');
create type return_status       as enum ('REQUESTED','APPROVED','REJECTED','RECEIVED','REFUNDED','CLOSED');
create type discount_type       as enum ('PERCENT','FIXED','FREE_SHIPPING');
create type discount_applies_to as enum ('ORDER','SHIPPING','PRODUCT');
create type import_status       as enum ('QUEUED','RUNNING','COMPLETED','FAILED');
create type support_category    as enum ('ORDER','PRODUCT','WARRANTY','RETURN','DELIVERY','OTHER');
create type support_status      as enum ('OPEN','IN_PROGRESS','AWAITING_CUSTOMER','RESOLVED','CLOSED');
create type warranty_status     as enum ('SUBMITTED','IN_REVIEW','APPROVED','DENIED','RESOLVED');

-- ================================================================
-- Tenancy
-- ================================================================

create table tenants (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text not null unique,
  primary_domain text unique,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_tenants_updated_at before update on tenants
  for each row execute function set_updated_at();

create table tenant_settings (
  tenant_id      uuid primary key references tenants(id) on delete cascade,
  tenancy_mode   tenancy_mode not null default 'SAAS',

  brand_name       text not null,
  logo_url         text,
  favicon_url      text,
  hero_image_url   text,
  theme_json       jsonb,
  contact_email    text,
  contact_phone    text,
  contact_address  text,

  seo_title_default text,
  seo_desc_default   text,
  og_image_default   text,

  use_gender_neutral_language boolean not null default true,
  collect_pronouns             boolean not null default false,

  base_currency      text not null default 'USD',
  enabled_currencies text[] not null default array['USD'],
  cookie_consent_enabled boolean not null default true,

  -- SEO / indexing controls
  seo_allow_indexing       boolean not null default true,
  seo_allow_image_indexing boolean not null default true,
  seo_robots_directives    text,

  -- Checkout: merchant-configurable in lieu of a real shipping-rate/tax engine (see
  -- supabase/migrations/0007_checkout_settings.sql). tax_rate_percent is a single flat rate, not
  -- real jurisdiction-based tax (US nexus/state, GST/VAT) — a merchant who needs exact tax should
  -- configure a Stripe Tax-style provider rather than trust an invented rate.
  shipping_flat_rate_cents      int not null default 995,
  free_shipping_threshold_cents int not null default 10000,
  tax_rate_percent              numeric(5,2) not null default 0
    check (tax_rate_percent >= 0 and tax_rate_percent <= 100)
);

create table tax_settings (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null unique references tenants(id) on delete cascade,
  mode              text not null default 'AUTO',
  provider          text,
  is_tax_inclusive  boolean not null default false,
  default_rate_bps  int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_tax_settings_updated_at before update on tax_settings
  for each row execute function set_updated_at();

-- Staff accounts. auth.users holds credentials; this maps a Supabase Auth
-- user to a tenant with a role.
create table memberships (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       user_role not null default 'ADMIN',
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create table audit_logs (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  actor_id   uuid,
  action     text not null,
  entity     text not null,
  entity_id  text,
  meta       jsonb,
  created_at timestamptz not null default now()
);

-- ── RLS helpers (defined after tenants/memberships exist) ─────
create or replace function public.is_tenant_member(check_tenant_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from memberships m
    where m.tenant_id = check_tenant_id and m.user_id = auth.uid()
  );
$$;

-- ================================================================
-- Customers
-- ================================================================

create table customers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  auth_user_id  uuid references auth.users(id) on delete set null, -- null = guest
  email         text not null,
  name          text,
  phone         text,
  pronouns      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, email)
);
create trigger trg_customers_updated_at before update on customers
  for each row execute function set_updated_at();

create table customer_privacy_settings (
  customer_id                uuid primary key references customers(id) on delete cascade,
  save_recently_viewed       boolean not null default true,
  marketing_opt_in           boolean not null default false
);

create table addresses (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  label       text,
  full_name   text not null,
  line1       text not null,
  line2       text,
  city        text not null,
  region      text,
  postal_code text,
  country     text not null,
  phone       text,
  is_default  boolean not null default false
);

-- ================================================================
-- Catalogue
-- ================================================================

create table categories (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  parent_id      uuid references categories(id) on delete set null,
  name           text not null,
  handle         text not null,
  description    text,
  hero_image_url text,
  position       int not null default 0,
  is_hidden      boolean not null default false,
  seo_title      text,
  seo_desc       text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, handle)
);
create trigger trg_categories_updated_at before update on categories
  for each row execute function set_updated_at();

create table tags (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table attribute_definitions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  code          text not null,
  label         text not null,
  input_type    text not null default 'select', -- select | multiselect | range | boolean | text
  unit          text,
  is_filterable boolean not null default true,
  position      int not null default 0,
  unique (tenant_id, code)
);

create table products (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  product_type product_type not null default 'STANDARD',
  title        text not null,
  handle       text not null,
  short_description text,
  description  text,
  status       product_status not null default 'DRAFT',

  brand         text,
  manufacturer  text,
  model_code    text,
  product_series text,

  shipping_class        shipping_class not null default 'STANDARD',
  packaged_weight_grams int,
  packaged_length_mm    int,
  packaged_width_mm     int,
  packaged_height_mm    int,

  stock_policy          stock_policy not null default 'IN_STOCK',
  production_days       int,
  dispatch_days         int,
  warranty_months       int,
  warranty_details      text,
  care_instructions     text,
  shipping_restrictions text[] not null default array[]::text[],

  seo_title    text,
  seo_desc     text,
  og_image_url text,
  is_indexable boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, handle)
);
create trigger trg_products_updated_at before update on products
  for each row execute function set_updated_at();
create index idx_products_tenant_status on products (tenant_id, status);

-- Structured, queryable key/value specs instead of one text blob
create table product_specs (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  "group"    text not null, -- e.g. "Physical", "Materials", "Compatibility"
  label      text not null, -- e.g. "Height"
  value      text not null, -- e.g. "165 cm"
  position   int not null default 0
);

create table product_attribute_values (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  attribute_id  uuid not null references attribute_definitions(id) on delete cascade,
  value         text not null,
  numeric_value double precision
);
create index idx_pav_attribute_value on product_attribute_values (attribute_id, value);

create table reviews (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  rating      int not null check (rating between 1 and 5),
  title       text,
  body        text,
  is_approved boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Cross-product relationships (compatible stand, replacement head, care kit...)
create table compatibility_links (
  id              uuid primary key default gen_random_uuid(),
  from_product_id uuid not null references products(id) on delete cascade,
  to_product_id   uuid not null references products(id) on delete cascade,
  relation_type   text not null, -- compatible_accessory | replacement_part | care_product | compatible_wig | ...
  note            text,
  unique (from_product_id, to_product_id, relation_type)
);

create table bundle_items (
  id                uuid primary key default gen_random_uuid(),
  bundle_product_id uuid not null references products(id) on delete cascade,
  child_product_id  uuid not null references products(id) on delete cascade,
  quantity          int not null default 1
);

create table product_variants (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id) on delete cascade,

  title        text,
  sku          text,
  barcode      text,
  price        int not null, -- cents
  currency     text not null default 'USD',
  compare_at   int,
  cost         int,

  weight_grams  int,
  option1_name  text,
  option1_value text,
  option2_name  text,
  option2_value text,
  option3_name  text,
  option3_value text,

  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (product_id, sku)
);
create trigger trg_product_variants_updated_at before update on product_variants
  for each row execute function set_updated_at();

create table inventory_items (
  id                  uuid primary key default gen_random_uuid(),
  variant_id          uuid not null unique references product_variants(id) on delete cascade,
  stock_on_hand       int not null default 0,
  stock_reserved      int not null default 0,
  low_stock_threshold int not null default 5,
  allow_backorder     boolean not null default false
);

create table product_media (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  url        text not null,
  alt        text,
  position   int not null default 0,
  created_at timestamptz not null default now()
);

create table product_categories (
  product_id  uuid not null references products(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  primary key (product_id, category_id)
);

create table product_tags (
  product_id uuid not null references products(id) on delete cascade,
  tag_id     uuid not null references tags(id) on delete cascade,
  primary key (product_id, tag_id)
);

-- ================================================================
-- Shipping & tax
-- ================================================================

create table shipping_zones (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null,
  countries  text[] not null default array[]::text[],
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table shipping_methods (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  zone_id     uuid references shipping_zones(id) on delete set null,
  name        text not null,
  price       int not null, -- cents
  currency    text not null default 'USD',
  min_subtotal int,
  max_subtotal int,
  allowed_shipping_classes shipping_class[] not null default array['STANDARD','HEAVY','OVERSIZED','FREIGHT','SPECIAL']::shipping_class[],
  free_shipping_threshold  int,
  is_active   boolean not null default true,
  eta_days_min int,
  eta_days_max int,
  created_at  timestamptz not null default now()
);

-- ================================================================
-- Cart & checkout
-- ================================================================

create table carts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  customer_id  uuid references customers(id) on delete set null,
  email        text,
  currency     text not null default 'USD',
  abandoned_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_carts_updated_at before update on carts
  for each row execute function set_updated_at();

create table cart_items (
  id         uuid primary key default gen_random_uuid(),
  cart_id    uuid not null references carts(id) on delete cascade,
  variant_id uuid not null references product_variants(id) on delete restrict,
  quantity   int not null default 1,
  unit_price int not null,
  unique (cart_id, variant_id)
);

create table orders (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  customer_id    uuid references customers(id) on delete set null,
  status         order_status not null default 'PENDING_PAYMENT',
  currency       text not null default 'USD',

  subtotal       int not null,
  tax_total      int not null default 0,
  shipping_total int not null default 0,
  discount_total int not null default 0,
  total          int not null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_orders_updated_at before update on orders
  for each row execute function set_updated_at();
create index idx_orders_tenant_customer on orders (tenant_id, customer_id);

create table order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  variant_id uuid not null references product_variants(id) on delete restrict,
  title      text not null,
  sku        text,
  quantity   int not null,
  unit_price int not null,
  line_total int not null
);

create table payments (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  provider     text not null,
  provider_ref text not null,
  status       payment_status not null,
  amount       int not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (provider, provider_ref)
);
create trigger trg_payments_updated_at before update on payments
  for each row execute function set_updated_at();

-- ================================================================
-- Wishlists, recently viewed, owned products
-- ================================================================

create table wishlists (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  name        text not null default 'My Wishlist',
  pin_hash    text, -- bcrypt hash; never store the PIN itself
  created_at  timestamptz not null default now()
);

create table wishlist_items (
  id          uuid primary key default gen_random_uuid(),
  wishlist_id uuid not null references wishlists(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (wishlist_id, product_id)
);

create table recently_viewed (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  viewed_at   timestamptz not null default now(),
  unique (customer_id, product_id)
);

-- Customer "garage" of owned products, populated on fulfilled orders
create table owned_products (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references customers(id) on delete cascade,
  product_id       uuid not null references products(id) on delete cascade,
  order_id         uuid references orders(id) on delete set null,
  configuration    jsonb,
  purchased_at     timestamptz not null default now(),
  warranty_ends_at timestamptz
);

create table return_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  customer_id   uuid not null references customers(id) on delete cascade,
  order_id      uuid not null references orders(id) on delete cascade,
  order_item_id uuid references order_items(id) on delete set null,
  reason        text not null,
  description   text,
  status        return_status not null default 'REQUESTED',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_return_requests_updated_at before update on return_requests
  for each row execute function set_updated_at();

create table warranty_claims (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references customers(id) on delete cascade,
  owned_product_id uuid references owned_products(id) on delete set null,
  description      text not null,
  status           warranty_status not null default 'SUBMITTED',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_warranty_claims_updated_at before update on warranty_claims
  for each row execute function set_updated_at();

create table support_tickets (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  customer_id     uuid references customers(id) on delete set null,
  order_reference text,
  category        support_category not null default 'OTHER',
  subject         text not null,
  message         text not null,
  status          support_status not null default 'OPEN',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_support_tickets_updated_at before update on support_tickets
  for each row execute function set_updated_at();

-- ================================================================
-- CMS
-- ================================================================

create table cms_pages (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  slug         text not null,
  title        text not null,
  body_json    jsonb,
  seo_title    text,
  seo_desc     text,
  is_published boolean not null default true,
  updated_at   timestamptz not null default now(),
  unique (tenant_id, slug)
);
create trigger trg_cms_pages_updated_at before update on cms_pages
  for each row execute function set_updated_at();

create table banners (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  placement  text not null default 'homepage_hero', -- homepage_hero | promo_strip | ...
  headline   text not null,
  body       text,
  cta_label  text,
  cta_href   text,
  secondary_cta_label text, -- homepage hero renders two CTAs; everything else uses cta_label/href only
  secondary_cta_href  text,
  media_url  text,
  media_type text not null default 'image', -- image | video
  position   int not null default 0,
  is_active  boolean not null default true,
  starts_at  timestamptz,
  ends_at    timestamptz
);

create table blog_posts (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  title      text not null,
  slug       text not null,
  content    text not null,
  category   text, -- e.g. "Buying Guide", "Materials" — free text, shown as a small label on guide cards
  excerpt    text, -- optional; falls back to a truncated `content` when unset
  status     text not null default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);
create trigger trg_blog_posts_updated_at before update on blog_posts
  for each row execute function set_updated_at();

-- ================================================================
-- Discounts, gift cards, loyalty, affiliates, marketing
-- ================================================================

create table discounts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  code         text not null,
  type         discount_type not null,
  applies_to   discount_applies_to not null default 'ORDER',
  value        int not null,
  currency     text,
  usage_limit  int,
  used_count   int not null default 0,
  starts_at    timestamptz,
  ends_at      timestamptz,
  is_active    boolean not null default true,
  min_subtotal int,
  created_at   timestamptz not null default now(),
  unique (tenant_id, code)
);

create table gift_cards (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  code            text not null,
  initial_balance int not null,
  balance         int not null,
  currency        text not null default 'USD',
  expires_at      timestamptz,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (tenant_id, code)
);

create table store_credit_ledger (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  amount      int not null,
  currency    text not null default 'USD',
  reason      text not null,
  meta        jsonb,
  created_at  timestamptz not null default now()
);

create table loyalty_rules (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  name               text not null,
  event              text not null,
  points_per_usd_bps int not null default 100,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);

create table loyalty_accounts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null unique references customers(id) on delete cascade,
  points      int not null default 0,
  updated_at  timestamptz not null default now()
);
create trigger trg_loyalty_accounts_updated_at before update on loyalty_accounts
  for each row execute function set_updated_at();

create table affiliates (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  code       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create table newsletter_subscribers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  email      text not null,
  status     text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);

-- ================================================================
-- Bulk import & integrations (admin tooling)
-- ================================================================

create table import_jobs (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  type       text not null,
  status     import_status not null default 'QUEUED',
  file_url   text not null,
  mapping    jsonb not null,
  options    jsonb,
  result     jsonb,
  progress   int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_import_jobs_updated_at before update on import_jobs
  for each row execute function set_updated_at();

create table app_integrations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  webhook_url text not null,
  secret      text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ================================================================
-- Row Level Security
--
-- Pattern:
--  - Tenant-admin tables: `is_tenant_member(tenant_id)` may do anything.
--  - Storefront-readable tables: anon/authenticated may SELECT published/
--    active rows only.
--  - Customer-owned tables: the owning customer (auth_user_id = auth.uid())
--    may read/write their own rows; tenant members may read/write for
--    support purposes.
--  - Cart/order/payment writes for GUEST checkout have no anon policy on
--    purpose — those mutations must go through a server route using the
--    Supabase service role key (which bypasses RLS), never directly from
--    the browser. Authenticated customers may still read their own.
-- ================================================================

alter table tenants enable row level security;
alter table tenant_settings enable row level security;
alter table tax_settings enable row level security;
alter table memberships enable row level security;
alter table audit_logs enable row level security;
alter table customers enable row level security;
alter table customer_privacy_settings enable row level security;
alter table addresses enable row level security;
alter table categories enable row level security;
alter table tags enable row level security;
alter table attribute_definitions enable row level security;
alter table products enable row level security;
alter table product_specs enable row level security;
alter table product_attribute_values enable row level security;
alter table reviews enable row level security;
alter table compatibility_links enable row level security;
alter table bundle_items enable row level security;
alter table product_variants enable row level security;
alter table inventory_items enable row level security;
alter table product_media enable row level security;
alter table product_categories enable row level security;
alter table product_tags enable row level security;
alter table shipping_zones enable row level security;
alter table shipping_methods enable row level security;
alter table carts enable row level security;
alter table cart_items enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table payments enable row level security;
alter table wishlists enable row level security;
alter table wishlist_items enable row level security;
alter table recently_viewed enable row level security;
alter table owned_products enable row level security;
alter table return_requests enable row level security;
alter table warranty_claims enable row level security;
alter table support_tickets enable row level security;
alter table cms_pages enable row level security;
alter table banners enable row level security;
alter table blog_posts enable row level security;
alter table discounts enable row level security;
alter table gift_cards enable row level security;
alter table store_credit_ledger enable row level security;
alter table loyalty_rules enable row level security;
alter table loyalty_accounts enable row level security;
alter table affiliates enable row level security;
alter table newsletter_subscribers enable row level security;
alter table import_jobs enable row level security;
alter table app_integrations enable row level security;

-- Tenant admin
create policy "tenant members manage tenants" on tenants for all
  using (is_tenant_member(id)) with check (is_tenant_member(id));
create policy "tenant members manage tenant_settings" on tenant_settings for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy "tenant members manage tax_settings" on tax_settings for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy "tenant members manage memberships" on memberships for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy "tenant members read audit_logs" on audit_logs for select
  using (is_tenant_member(tenant_id));

-- Storefront catalogue: public read of published rows, tenant members manage all
create policy "public reads published categories" on categories for select
  using (not is_hidden or is_tenant_member(tenant_id));
create policy "tenant members manage categories" on categories for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

create policy "public reads tags" on tags for select using (true);
create policy "tenant members manage tags" on tags for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

create policy "public reads attribute_definitions" on attribute_definitions for select using (true);
create policy "tenant members manage attribute_definitions" on attribute_definitions for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

create policy "public reads published products" on products for select
  using (status = 'PUBLISHED' or is_tenant_member(tenant_id));
create policy "tenant members manage products" on products for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

create policy "public reads product_specs" on product_specs for select
  using (exists (select 1 from products p where p.id = product_id and (p.status = 'PUBLISHED' or is_tenant_member(p.tenant_id))));
create policy "tenant members manage product_specs" on product_specs for all
  using (exists (select 1 from products p where p.id = product_id and is_tenant_member(p.tenant_id)))
  with check (exists (select 1 from products p where p.id = product_id and is_tenant_member(p.tenant_id)));

create policy "public reads product_attribute_values" on product_attribute_values for select
  using (exists (select 1 from products p where p.id = product_id and (p.status = 'PUBLISHED' or is_tenant_member(p.tenant_id))));
create policy "tenant members manage product_attribute_values" on product_attribute_values for all
  using (exists (select 1 from products p where p.id = product_id and is_tenant_member(p.tenant_id)))
  with check (exists (select 1 from products p where p.id = product_id and is_tenant_member(p.tenant_id)));

create policy "public reads approved reviews" on reviews for select using (is_approved);
create policy "customers write own reviews" on reviews for insert
  with check (customer_id in (select id from customers where auth_user_id = auth.uid()));
create policy "tenant members manage reviews" on reviews for all
  using (exists (select 1 from products p where p.id = product_id and is_tenant_member(p.tenant_id)))
  with check (exists (select 1 from products p where p.id = product_id and is_tenant_member(p.tenant_id)));

create policy "public reads compatibility_links" on compatibility_links for select using (true);
create policy "tenant members manage compatibility_links" on compatibility_links for all
  using (exists (select 1 from products p where p.id = from_product_id and is_tenant_member(p.tenant_id)))
  with check (exists (select 1 from products p where p.id = from_product_id and is_tenant_member(p.tenant_id)));

create policy "public reads bundle_items" on bundle_items for select using (true);
create policy "tenant members manage bundle_items" on bundle_items for all
  using (exists (select 1 from products p where p.id = bundle_product_id and is_tenant_member(p.tenant_id)))
  with check (exists (select 1 from products p where p.id = bundle_product_id and is_tenant_member(p.tenant_id)));

create policy "public reads active variants" on product_variants for select
  using (is_active or exists (select 1 from products p where p.id = product_id and is_tenant_member(p.tenant_id)));
create policy "tenant members manage variants" on product_variants for all
  using (exists (select 1 from products p where p.id = product_id and is_tenant_member(p.tenant_id)))
  with check (exists (select 1 from products p where p.id = product_id and is_tenant_member(p.tenant_id)));

create policy "public reads inventory availability" on inventory_items for select using (true);
create policy "tenant members manage inventory" on inventory_items for all
  using (exists (select 1 from product_variants v join products p on p.id = v.product_id where v.id = variant_id and is_tenant_member(p.tenant_id)))
  with check (exists (select 1 from product_variants v join products p on p.id = v.product_id where v.id = variant_id and is_tenant_member(p.tenant_id)));

create policy "public reads product_media" on product_media for select using (true);
create policy "tenant members manage product_media" on product_media for all
  using (exists (select 1 from products p where p.id = product_id and is_tenant_member(p.tenant_id)))
  with check (exists (select 1 from products p where p.id = product_id and is_tenant_member(p.tenant_id)));

create policy "public reads product_categories" on product_categories for select using (true);
create policy "tenant members manage product_categories" on product_categories for all
  using (exists (select 1 from products p where p.id = product_id and is_tenant_member(p.tenant_id)))
  with check (exists (select 1 from products p where p.id = product_id and is_tenant_member(p.tenant_id)));

create policy "public reads product_tags" on product_tags for select using (true);
create policy "tenant members manage product_tags" on product_tags for all
  using (exists (select 1 from products p where p.id = product_id and is_tenant_member(p.tenant_id)))
  with check (exists (select 1 from products p where p.id = product_id and is_tenant_member(p.tenant_id)));

-- Shipping / tax: public may read active rows to price a cart; tenant members manage
create policy "public reads active shipping_zones" on shipping_zones for select using (is_active);
create policy "tenant members manage shipping_zones" on shipping_zones for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy "public reads active shipping_methods" on shipping_methods for select using (is_active);
create policy "tenant members manage shipping_methods" on shipping_methods for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy "tenant members manage tax_settings_read" on tax_settings for select
  using (is_tenant_member(tenant_id));

-- Customers manage their own profile; tenant members (support) can read/write
create policy "customers manage own row" on customers for all
  using (auth_user_id = auth.uid() or is_tenant_member(tenant_id))
  with check (auth_user_id = auth.uid() or is_tenant_member(tenant_id));
create policy "customers manage own privacy_settings" on customer_privacy_settings for all
  using (customer_id in (select id from customers where auth_user_id = auth.uid()))
  with check (customer_id in (select id from customers where auth_user_id = auth.uid()));
create policy "customers manage own addresses" on addresses for all
  using (customer_id in (select id from customers where auth_user_id = auth.uid()))
  with check (customer_id in (select id from customers where auth_user_id = auth.uid()));
create policy "customers manage own wishlists" on wishlists for all
  using (customer_id in (select id from customers where auth_user_id = auth.uid()))
  with check (customer_id in (select id from customers where auth_user_id = auth.uid()));
create policy "customers manage own wishlist_items" on wishlist_items for all
  using (wishlist_id in (select w.id from wishlists w join customers c on c.id = w.customer_id where c.auth_user_id = auth.uid()))
  with check (wishlist_id in (select w.id from wishlists w join customers c on c.id = w.customer_id where c.auth_user_id = auth.uid()));
create policy "customers manage own recently_viewed" on recently_viewed for all
  using (customer_id in (select id from customers where auth_user_id = auth.uid()))
  with check (customer_id in (select id from customers where auth_user_id = auth.uid()));
create policy "customers read own owned_products" on owned_products for select
  using (customer_id in (select id from customers where auth_user_id = auth.uid()));
create policy "customers manage own return_requests" on return_requests for all
  using (customer_id in (select id from customers where auth_user_id = auth.uid()) or is_tenant_member(tenant_id))
  with check (customer_id in (select id from customers where auth_user_id = auth.uid()) or is_tenant_member(tenant_id));
create policy "customers manage own warranty_claims" on warranty_claims for all
  using (customer_id in (select id from customers where auth_user_id = auth.uid()))
  with check (customer_id in (select id from customers where auth_user_id = auth.uid()));
create policy "customers manage own support_tickets" on support_tickets for all
  using (customer_id in (select id from customers where auth_user_id = auth.uid()) or is_tenant_member(tenant_id))
  with check (customer_id in (select id from customers where auth_user_id = auth.uid()) or is_tenant_member(tenant_id));

-- Orders/carts/payments: authenticated customers read their own; all writes
-- (including every guest checkout write) go through the service role from a
-- trusted server route, which bypasses RLS entirely — so no anon policy here.
create policy "customers read own carts" on carts for select
  using (customer_id in (select id from customers where auth_user_id = auth.uid()));
create policy "customers read own cart_items" on cart_items for select
  using (cart_id in (select id from carts where customer_id in (select id from customers where auth_user_id = auth.uid())));
create policy "customers read own orders" on orders for select
  using (customer_id in (select id from customers where auth_user_id = auth.uid()) or is_tenant_member(tenant_id));
create policy "tenant members manage orders" on orders for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy "customers read own order_items" on order_items for select
  using (order_id in (select id from orders where customer_id in (select id from customers where auth_user_id = auth.uid())));
create policy "tenant members manage order_items" on order_items for all
  using (exists (select 1 from orders o where o.id = order_id and is_tenant_member(o.tenant_id)))
  with check (exists (select 1 from orders o where o.id = order_id and is_tenant_member(o.tenant_id)));
create policy "customers read own payments" on payments for select
  using (order_id in (select id from orders where customer_id in (select id from customers where auth_user_id = auth.uid())));
create policy "tenant members manage payments" on payments for all
  using (exists (select 1 from orders o where o.id = order_id and is_tenant_member(o.tenant_id)))
  with check (exists (select 1 from orders o where o.id = order_id and is_tenant_member(o.tenant_id)));

-- CMS / marketing: public reads published/active, tenant members manage
create policy "public reads published cms_pages" on cms_pages for select
  using (is_published or is_tenant_member(tenant_id));
create policy "tenant members manage cms_pages" on cms_pages for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy "public reads active banners" on banners for select
  using (is_active or is_tenant_member(tenant_id));
create policy "tenant members manage banners" on banners for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy "public reads published blog_posts" on blog_posts for select
  using (status = 'PUBLISHED' or is_tenant_member(tenant_id));
create policy "tenant members manage blog_posts" on blog_posts for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

-- Discounts/gift cards/loyalty/affiliates: tenant-managed only (never listable by anon)
create policy "tenant members manage discounts" on discounts for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy "tenant members manage gift_cards" on gift_cards for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy "customers read own store_credit_ledger" on store_credit_ledger for select
  using (customer_id in (select id from customers where auth_user_id = auth.uid()) or is_tenant_member(tenant_id));
create policy "tenant members manage store_credit_ledger" on store_credit_ledger for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy "tenant members manage loyalty_rules" on loyalty_rules for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy "customers read own loyalty_accounts" on loyalty_accounts for select
  using (customer_id in (select id from customers where auth_user_id = auth.uid()) or is_tenant_member(tenant_id));
create policy "tenant members manage loyalty_accounts" on loyalty_accounts for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy "tenant members manage affiliates" on affiliates for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy "anyone can subscribe to newsletter" on newsletter_subscribers for insert with check (true);
create policy "tenant members manage newsletter_subscribers" on newsletter_subscribers for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));

-- Admin-only tooling
create policy "tenant members manage import_jobs" on import_jobs for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
create policy "tenant members manage app_integrations" on app_integrations for all
  using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
