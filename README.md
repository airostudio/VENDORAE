# Beach Footprints

A boho surf-culture lifestyle e-commerce platform — apparel and accessories, editorial lookbook feel (warm sand, terracotta, sage ocean, surf foam, driftwood tones), sourced via an AliExpress dropshipping pipeline. Beach Footprints is the **pilot store** for the [WebeseDrop dropshipping engine](https://github.com/airostudio/webesedrop), a store-agnostic dropshipping backend that any storefront platform can connect to; this app talks to it over REST + webhooks like any other connected store would, never through a shared database or shared code.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Supabase (Postgres + Auth) — `supabase/schema.sql` is the source of truth for the data model, applied directly via the SQL editor or `supabase db execute`, no ORM/migration tool in between
- `packages/db` — a thin `@supabase/supabase-js` client wrapper (browser + service-role factories)
- `packages/core` — provider abstractions (payment, shipping, email, AI), decoupled from any single vendor
- Zod + React Hook Form for validated forms (checkout)
- `apps/worker` — background job scaffold (BullMQ) — no longer where AliExpress sync lives (see the [webesedrop](https://github.com/airostudio/webesedrop) engine)
- **[webesedrop](https://github.com/airostudio/webesedrop)** — the AliExpress dropshipping backend this store is a client of. A fully separate repo/deployment (own Supabase project, own Vercel project) — nothing in this repo, no shared code or database.

## Structure

```
apps/web          Storefront + admin (Next.js App Router)
                  lib/dropshipEngine.ts — the whole integration surface with the webesedrop engine
                  app/api/webhooks/dropship-engine/ — receives its product/order events
apps/worker       Background job scaffold (BullMQ) — currently unused
supabase/         schema.sql (tables, enums, RLS) + storage.sql (buckets) + seed.sql (demo catalogue)
                  migrations/ — additive, already-applied changes (see 0002 for the dropship columns)
packages/db       @supabase/supabase-js client wrapper (browser + service-role)
packages/core     Provider interfaces (PaymentProvider, ShippingProvider, EmailProvider, AIProvider),
                  shared by storefront + admin
tools/            Standalone tools that need real internet access or Python
  wc-import-convert   Python original of the WooCommerce .xlsx converter now built into /admin/products/import — kept for local one-off conversions
```

The AliExpress dropshipping engine itself lives entirely outside this repo, at
[airostudio/webesedrop](https://github.com/airostudio/webesedrop) — own package.json, own Vercel
project, own Supabase project, zero imports from this app. It started life as a `/dropship-engine`
subdirectory here (see git history before it was extracted) but that copy has been removed now that
the standalone repo is the live, deployed one — keeping both around risked exactly the kind of
drift a store-agnostic engine is supposed to prevent.

## What's implemented

- **Data model** (`supabase/schema.sql`): tables covering products with a `product_type` enum (`STANDARD` / `ACCESSORY` / `CARE_PRODUCT` / `BUNDLE` / `GIFT_CARD`), structured `product_specs` key/value rows (not a text blob), admin-defined `attribute_definitions`/`product_attribute_values` for flexible filtering, `shipping_class` (standard/heavy/oversized/freight/special) with packaged dimensions, hierarchical categories, `compatibility_links` for cross-product relationships, bundles, wishlists (PIN hash, never plaintext), recently viewed, owned products ("My Products"), returns, warranty claims, support tickets, and CMS pages/banners. **Row Level Security is enabled on every table** — see the policy block at the bottom of the file: tenant staff (via `memberships` + `is_tenant_member()`) can manage their tenant's data, customers can only read/write their own rows, storefront reads are limited to published/active rows, and money-moving tables (`carts`, `orders`, `payments`) have no anon write policy on purpose — those mutations must go through a server route using the service-role client, which bypasses RLS.
- **Verified**: both `supabase/schema.sql` and `supabase/seed.sql` were run end-to-end against a real local Postgres 16 instance (with a stubbed `auth.users`/`auth.uid()` to stand in for Supabase Auth) — every `CREATE TABLE`/`CREATE POLICY` and the full seed insert succeeded.
- **Provider abstractions** (`packages/core`): `PaymentProvider`, `ShippingProvider`, `EmailProvider`, `AIProvider` interfaces with a Stripe adapter skeleton, a flat-rate/threshold shipping adapter, a mock payment provider and console email provider for local dev, and a fully deterministic (no external calls) recommendation engine for the product finder.
- **Storefront**: homepage, `/shop` + nested category routes with database-shaped filtering, product detail pages (gallery, spec tabs, compatible accessories, related products, Product/Article JSON-LD), `/cart`, `/checkout` (React Hook Form + Zod, guest checkout, tokenized-payment messaging), `/compare`, `/product-finder`, `/care`, `/guides`, `sitemap.xml` / `robots.txt`.
- **Account**: orders + timeline, owned products, wishlists (with PIN option), addresses, profile, privacy preferences (recently-viewed opt-out), support (order-reference-first, no unnecessary detail required).
- **Admin**: dashboard, product list, categories, orders, CMS/banner editor — skeleton screens demonstrating the information architecture. The entire `/admin` area and its `/api/admin/*` routes sit behind HTTP Basic Auth (`apps/web/middleware.ts`), gated on a single `ADMIN_PASSWORD` env var — a stopgap until real admin authentication/sessions exist, but enough to keep the import endpoints from being open to the internet.
- **Chunked CSV product import** (`/admin/products/import`): imports a products CSV of any size without hitting a serverless function's request-body ceiling (~4.5MB on Vercel) or execution-duration ceiling. The browser uploads the raw file straight to Supabase Storage via a signed upload URL — the big binary transfer never passes through a Next.js function at all — then an `import_jobs` row tracks a resumable byte-offset cursor while `/api/admin/imports/[id]/process` is called repeatedly, each call fetching and parsing only one small `Range` slice of the file (256KB by default) and upserting that chunk's rows before returning. A hand-rolled, dependency-free CSV chunk parser (`packages/core/src/csv.ts`) carries an incomplete trailing row (`leftover`) across chunk boundaries — verified correct against chunk sizes from 3 bytes to 1000 bytes, including quoted fields with embedded commas and newlines. Row-level errors (bad price, unknown category handle, etc.) are collected without failing the rest of the chunk. The SQL (`storage.sql`'s bucket/policy and the `import_jobs` usage in `schema.sql`) was verified against local Postgres; the live Storage Range-request flow itself could not be exercised end-to-end without a provisioned Supabase project. The importer also accepts an `image_urls` column, writing `product_media` rows for each — a public `product-images` Storage bucket backs this. **Import order is categories, then products, then the rest**: before a chunk's new products are inserted, `apps/web/lib/import/categories.ts` ensures every category handle those rows reference already exists for the tenant — creating any that don't (including "/"-nested ancestors, e.g. `dresses-kimonos/sale` auto-creates `dresses-kimonos` first) — so a product can never land pointing at a category that isn't there yet; only then are products, variants, inventory, specs, images and category links written. **Existing products are always left alone**: a row whose handle already exists for the tenant is skipped entirely (not overwritten) — only new handles get inserted. A separate opt-in checkbox, "mark products not in this file as Out Of Stock", runs once after the whole file finishes: it sets stock to 0 (never deletes or unpublishes) on any tenant product sharing a brand seen in the import whose handle didn't appear anywhere in the file, so re-importing a supplier's latest catalogue can reflect discontinued items without touching unrelated products from other brands.
- **WooCommerce export import** — a much better source than scraping when the source store can supply one: an admin can upload a WooCommerce product-export `.xlsx` (real prices, hosted image URLs, a per-product HTML spec table) directly in `/admin/products/import` (a mode toggle alongside plain CSV), with no local script to run. `apps/web/lib/import/woocommerce.ts` converts it to the standard importer CSV server-side — classifies product type/category from title + category keywords (word-boundary matched, not naive substring), parses the embedded spec table for accurate material, strips HTML and an export artifact (a literal `\n` that triggers HTML5 foster-parenting inside the spec table, concatenating adjacent cells' text with no separator until fixed) — then hands off to the *exact same* tested byte-range chunked processor the CSV path uses, so it inherits the same any-file-size guarantee. Images are referenced from the source's own hosted URLs, not re-downloaded or re-hosted, on purpose. `tools/wc-import-convert/convert.py` is the original Python version this was ported from (kept for local one-off conversions without deploying).
- **Hero slideshow** (`components/HeroSlideshow.tsx`): the homepage hero crossfades between images, in a randomized order picked client-side on each page load (so the server-rendered first paint stays deterministic), on a slow fade (2s crossfade, 6s hold per slide). Falls back to placeholder imagery until real lookbook photography is dropped into `public/hero/` (see the README there).
- **Live Supabase data everywhere** (`apps/web/lib/data/*.ts`): every storefront and admin page reads real Supabase queries — `apps/web/lib/sample-data.ts` is gone. `lib/data/products.ts` builds `ProductSummary`/`ProductDetail` from `products` + `product_variants` (cheapest active variant sets price/compare-at) + `inventory_items` (stock, drives "ready to ship") + `product_media` + `product_specs` + `reviews` (aggregated rating/count) + `compatibility_links` (compatible accessories) + shared-category membership (related products, since the schema has no dedicated "related" relation type); `isNew`/`isBestSeller`/`onSale` come from category membership (assign products to the `new-arrivals`/`best-sellers`/`sale` category handles via the importer's `category_handles` column, same as any other category) plus `onSale` also triggers off a variant's `compare_at`. `lib/data/cms.ts`/`guides.ts` read `banners`/`blog_posts` (two small additive columns — `blog_posts.category`/`excerpt` and `banners.secondary_cta_label`/`secondary_cta_href` — were added for these; see `supabase/migrations/0001_guides_and_hero_secondary_cta.sql` for an already-applied database). Everything queries through the service-role client scoped to `tenant_id` and (for storefront reads) `status = 'PUBLISHED'`, since there's no live Supabase Auth session yet to carry RLS. A few product-detail fields have no schema home (FAQs, "what's included") and stay as generic static copy rather than fabricated per-product claims — `care`/`delivery`/`warranty` summaries prefer real `products` columns when set and fall back to the same generic copy otherwise. Pages that now query the database are marked `export const dynamic = "force-dynamic"` so Next doesn't try to prerender them at build time without live credentials.
- **Demo data cleanup**: `supabase/scripts/delete_demo_tenant.sql` empties out the seeded demo catalogue (products, categories, banners, guides — cascades handle the rest) while keeping the tenant row/slug intact, so `DEFAULT_TENANT_SLUG` doesn't need to change. Run it once your real catalogue is imported.
- **AliExpress dropshipping, via the webesedrop engine** ([airostudio/webesedrop](https://github.com/airostudio/webesedrop), `apps/web/lib/dropshipEngine.ts`, `supabase/migrations/0002_aliexpress_dropshipping_engine.sql`): Beach Footprints holds no AliExpress logic of its own — everything (signing, pricing, copy rewriting, order placement, sync) lives in the engine, a separate repo/deployment this app is just a client of. See that repo's own README for the engine's architecture, API contract, and its own test suite; this section covers only the Beach Footprints side of the integration.
  - **`apps/web/lib/dropshipEngine.ts`** — the entire integration surface: typed wrappers over the engine's REST API (`importProduct`, `createMapping`, `fulfillOrder`, `getOrderStatus`, `triggerCatalogSync`/`triggerTrackingSync`, the AliExpress OAuth proxy calls, `registerWebhook`), authenticated with `DROPSHIP_ENGINE_API_KEY`. Nothing else in this app talks to the engine directly.
  - **`POST /api/admin/products/aliexpress/import`** — calls the engine's product import (which applies this store's pricing rule + brand voice server-side), then writes the result into Beach Footprints' own `products`/`product_variants`/`inventory_items`/`product_media` (new products land `DRAFT`; a re-import of a known supplier product id updates in place), and registers each variant's mapping back with the engine (`external_variant_id` = this store's own `product_variants.id` — the engine never sees or stores anything about this store's schema beyond that one opaque id).
  - **`POST /api/admin/orders/:id/place-aliexpress`** — reads the order's `shipping_address`/line items and calls the engine's `POST /v1/orders/fulfill`; idempotency is the engine's responsibility (an atomic claim on its own `orders` table, keyed by this store's order id), not reimplemented here. Mirrors the result into Beach Footprints' own `orders` row.
  - **`POST /api/webhooks/dropship-engine`** — receives the engine's signed webhooks (`product.price_changed`/`out_of_stock`/`restocked`, `order.shipped`/`delivered`/`fulfillment_failed`) and applies them to local `products`/`product_variants`/`inventory_items`/`orders`; verifies `X-Dropship-Signature` (`HMAC-SHA256(DROPSHIP_ENGINE_WEBHOOK_SECRET, rawBody)`) before trusting anything, and sends the shipping-confirmation email on `order.shipped`. This is how catalog/tracking sync results reach this store — the engine's own scheduled worker (daily catalog sync, tracking every 5h) calls it, and so does `POST /api/admin/sync/tracking` (an on-demand trigger, for an admin "sync now" button).
  - **`GET /api/admin/aliexpress/auth`** (`GET` for the authorize link, `PUT` to register the AliExpress app key/secret, `POST` to exchange the OAuth code) and the **`/admin/aliexpress`** page — proxy the one-time AliExpress OAuth setup through the engine. Nothing here ever displays an AliExpress access/refresh token; the engine stores and refreshes them itself.
  - Every one of the above writes an entry to `fulfillment_logs` (this store's own local audit trail, distinct from the engine's own `sync_logs`), readable via `GET /api/admin/fulfillment/logs`.
  - Orders have no live checkout → `orders` write path yet (see below), so the fulfillment route reads `orders.shipping_address`, a denormalized jsonb snapshot column — once checkout is wired, populate it from the order's chosen address at write time rather than joining `addresses` live, so a later address edit/delete can't retroactively change what was already shipped to.

## What's stubbed / not wired to a live backend

- No real payment processing (Stripe adapter is implemented against the SDK shape but untested against a live account; mock provider is the default).
- Supabase Auth (sign-up/sign-in) is not connected. Because of that, three pages are honest empty/placeholder states rather than showing fabricated per-customer data: `/account/wishlist` (wishlists are per-customer — `wishlists`/`wishlist_items` — and need a signed-in customer to scope the query), and `/cart` starts empty (no fake line items) since there's no cart persistence (`carts`/`cart_items`) wired to "Add to Cart" yet — once that's built, this page renders whatever's actually in the cart with no code change needed. Storage/R2 image uploads beyond the WooCommerce/CSV importer's own paths are also not connected.
- Transactional email: order-confirmation (on Stripe payment) and shipping-notification (on the dropship-engine's `order.shipped` webhook) emails are sent through `EmailProvider` (`packages/core`). Set `RESEND_API_KEY` and `EMAIL_FROM` to send real email via Resend (`ResendEmailProvider`, calling Resend's REST API directly — no SDK dependency); without both set, the deployment falls back to `ConsoleEmailProvider`, which logs the email instead of sending it, so checkout and fulfillment still work end-to-end in local dev.
- Cart/checkout state is client-local for demonstration; wiring to `carts`/`orders` and a server route using the service-role client (see `packages/db`) is the next step. The admin dashboard's revenue/order KPIs (`lib/data/admin.ts`) already query real `orders`/`payments` tables, so they'll show real numbers as soon as checkout writes to them — they're legitimately all zero right now.
- The store sells in **USD by default** (`tenant_settings.base_currency`, whose column default is USD — so an unconfigured store is definitively USD rather than inheriting the dropship engine's default). Change it at `/admin/payments`; saving also pushes the code to the engine's `import.targetCurrency` so newly imported products are quoted in it. Changing the setting never re-prices the existing catalogue: `/admin/products` reports which currencies the catalogue is actually priced in, and offers a one-click relabel of every variant to the store currency — which **relabels only and does not convert amounts**, since there is no FX rate here and applying an invented one to real prices would be worse than making the merchant re-price. Per-product price/currency edits live in the product editor.
- **Store policies** (`/legal/returns`, `/legal/shipping`, `/legal/terms`, `/legal/privacy`, from `apps/web/lib/legal/policies.ts`) are written for how this store actually operates — supplier-shipped goods, long international transit, orders arriving as separate parcels — rather than copied from AliExpress, whose terms are a marketplace intermediary's and written for a different legal position than a retailer selling in its own name. **Before relying on them commercially: have a lawyer review them, and fill in `TRADING_ENTITY` in that file** (registered entity name, ABN, postal address) — the pages read contact details from `tenant_settings` and fall back to the support page when unset. Note that Australian Consumer Law guarantees can't be excluded by policy text, so where a supplier's dispute window is shorter than what this store owes its customers, the store absorbs the difference.
- Shipping and tax are merchant-configured, not calculated: a flat shipping rate with a free-shipping threshold, and a single flat tax percentage (`tenant_settings.shipping_flat_rate_cents`/`free_shipping_threshold_cents`/`tax_rate_percent`, editable at `/admin/payments`; see `supabase/migrations/0007_checkout_settings.sql`). Defaults ($9.95 flat, free over $100, 0% tax) match the previous hardcoded behavior. There is no live carrier-rate or tax-jurisdiction engine — a merchant who needs real jurisdiction-based tax (US nexus/state, GST/VAT) should connect a Stripe Tax-style provider rather than trust an invented rate.
- Stock is checked when a Stripe session is created, not again when payment is confirmed — a slow checkout, or two customers racing for the last unit, can leave less stock than an order needs by the time it's paid. This is a deliberate, bounded gap (not a silent one): the ledger still clamps at zero, and `markOrderPaid` (`app/api/webhooks/stripe/route.ts`) logs a `stock_shortfall` `fulfillment_logs` entry when it happens, surfaced as a ⚠ on the affected order in `/admin/orders`.
- Generated TypeScript types (`packages/db/src/database.types.ts`) are a placeholder — run `pnpm db:types` against a live project to replace them.
- `next/font` (Google Fonts) was intentionally left out of `app/layout.tsx` in favor of a system-font stack, since this sandbox has no network access to fonts.googleapis.com — reinstate `next/font/google` (or self-host font files) once deploying somewhere with normal network access.
- The homepage hero slideshow (`components/HeroSlideshow.tsx`) currently renders placeholder imagery — drop real lookbook photos into `apps/web/public/hero/` (see the README there for expected filenames) and they'll render immediately, no code change needed.

## Local development

```bash
pnpm install
pnpm dev          # apps/web on :3000

# Against a Supabase project:
pnpm schema       # prints how to apply supabase/schema.sql
pnpm seed         # prints how to apply supabase/seed.sql
pnpm db:types     # regenerate packages/db/src/database.types.ts (needs SUPABASE_PROJECT_ID)

# The AliExpress dropshipping engine is a fully separate repo/deployment — see
# https://github.com/airostudio/webesedrop for setup (own Supabase project,
# `pnpm create-store`, its own `pnpm test`). Nothing to clone here for local dev
# of this app; it talks to the engine's deployed URL (DROPSHIP_ENGINE_URL below).
```

Required env vars once wiring pages to real data (`.env.local` in `apps/web`, plus server-only vars wherever `createServiceRoleSupabaseClient` runs):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=   # server-only — never expose to the browser
DEFAULT_TENANT_SLUG=          # optional, used by the CSV importer until admin auth resolves a tenant from a session
ADMIN_PASSWORD=                # protects /admin and /api/admin/* with HTTP Basic Auth — see middleware.ts

# webesedrop dropshipping engine connection (see apps/web/lib/dropshipEngine.ts and
# https://github.com/airostudio/webesedrop's README)
DROPSHIP_ENGINE_URL=            # e.g. https://webesedrop.vercel.app
DROPSHIP_ENGINE_API_KEY=        # from `pnpm create-store` (or POST /v1/admin/stores) on the engine — this store's API key
DROPSHIP_ENGINE_WEBHOOK_SECRET= # generated by this app, registered with the engine via POST /v1/webhooks
                                 # ({url: "<this deployment>/api/webhooks/dropship-engine", secret}) — see
                                 # POST /api/webhooks/dropship-engine's signature verification

# Optional — enables auto-assigning a newly imported AliExpress product to the best-fitting
# EXISTING category (lib/import/categorize.ts, called from the AliExpress import route). Never
# invents a new category; without this set, imported products are just left uncategorized.
ANTHROPIC_API_KEY=
```

Also apply `supabase/storage.sql` (creates the private `imports` bucket used by the CSV importer) alongside `schema.sql`.
