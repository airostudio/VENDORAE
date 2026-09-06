# Vendorae

A white-label dropshipping storefront. It ships **blank** — no demo products, no prior business
identity — and walks a new owner through a **setup wizard** (`/onboarding`) before the storefront
is shown to any customer: business name/description, a logo (upload or AI-generated), and Stripe +
PayPal payment credentials. Once the wizard is completed the storefront goes live under the owner's
own branding.

Vendorae connects to a separate, store-agnostic dropshipping backend — referred to throughout this
app and its code as the **Vendorae Engine** — over REST + signed webhooks, the same way any
connected storefront would. That engine is its own repo/deployment (own database, own hosting);
nothing here shares code or a database with it. Point `DROPSHIP_ENGINE_URL` at wherever you deploy
it (see [Environment variables](#environment-variables) below).

## Setup Wizard

A freshly-provisioned tenant has `tenant_settings.onboarding_completed = false` and no catalogue
(see [Blank by default](#blank-by-default)). `apps/web/middleware.ts` checks that flag on every
storefront request and redirects to `/onboarding` until it's set — `/admin` and `/api/*` stay
reachable throughout, so the owner can always sign in, and the wizard's own API routes are excluded
so they keep working while onboarding is incomplete.

The wizard (`apps/web/app/onboarding/page.tsx`) has six steps:

1. **Welcome** — what the wizard does and that payment steps can be skipped for now.
2. **Business & products** — business name, a short description, and the product niche/category
   the owner wants to sell. The business name becomes the tenant's `brand_name`, rendered by the
   header, footer, admin shell and page metadata (see `apps/web/lib/tenantSettings.ts`) in place of
   any fixed brand string.
3. **Logo** — upload an image (PNG/JPEG/WebP/SVG, stored in the public `branding` Storage bucket),
   or generate one with AI (see [AI logo generation](#ai-logo-generation) below).
4. **Stripe** — secret key, publishable key, webhook signing secret. Optional; can be added later
   from `/admin/payments`.
5. **PayPal** — client ID, client secret, sandbox/live mode. Optional, same as Stripe.
6. **Review & finish** — a summary, then `POST /api/onboarding/complete` saves everything and sets
   `onboarding_completed = true`.

API routes: `GET /api/onboarding` (current state, for resuming), `POST /api/onboarding/complete`
(saves + marks complete), `POST /api/onboarding/logo` (multipart upload), `POST
/api/onboarding/logo/generate` (AI logo). All four use the service-role Supabase client, since a
brand-new owner has no `memberships` row (and therefore no RLS access) until after the wizard.

### AI logo generation

There is no image-generation-capable provider in `packages/core`'s existing `AIProvider`
abstraction (that one is for the deterministic product-finder recommender, and is opt-in-to-external
calls by design — see its doc comment in `packages/core/src/providers/ai.ts`), so
`/api/onboarding/logo/generate` calls OpenAI's Images API directly, gated entirely behind an
optional env var:

```
OPENAI_API_KEY=   # optional — enables the wizard's "AI Generate" logo button
```

Without it set, the endpoint returns a clear JSON error ("AI logo generation isn't configured —
upload a logo instead, or set OPENAI_API_KEY...") rather than crashing or faking a result, and the
wizard's upload option always works regardless.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Supabase (Postgres + Auth) — `supabase/schema.sql` is the source of truth for the data model, applied directly via the SQL editor or `supabase db execute`, no ORM/migration tool in between
- `packages/db` — a thin `@supabase/supabase-js` client wrapper (browser + service-role factories)
- `packages/core` — provider abstractions (payment, shipping, email, AI), decoupled from any single vendor — includes Stripe and PayPal payment adapters
- Zod + React Hook Form for validated forms (checkout)
- `apps/worker` — background job scaffold (BullMQ) — no longer where AliExpress sync lives (see the Vendorae Engine)
- **Vendorae Engine** — the dropshipping backend this store is a client of. A fully separate repo/deployment (own database, own hosting) — nothing in this repo, no shared code or database.

## Structure

```
apps/web          Storefront + admin (Next.js App Router)
                  app/onboarding/          — the setup wizard
                  app/api/onboarding/      — wizard API routes
                  lib/tenantSettings.ts    — reads the tenant's brand name/logo for header/footer/admin/metadata
                  lib/config/paymentCredentials.ts — resolves Stripe/PayPal creds (env vars first, then tenant_settings)
                  middleware.ts            — admin Basic Auth + onboarding redirect
                  lib/dropshipEngine.ts    — the whole integration surface with the Vendorae Engine
                  app/api/webhooks/dropship-engine/ — receives its product/order events
apps/worker       Background job scaffold (BullMQ) — currently unused
supabase/         schema.sql (tables, enums, RLS) + storage.sql (buckets) + seed.sql (blank default tenant)
                  migrations/ — additive, already-applied changes (0008/0009 are the rebrand + wizard columns)
packages/db       @supabase/supabase-js client wrapper (browser + service-role)
packages/core     Provider interfaces (PaymentProvider, ShippingProvider, EmailProvider, AIProvider),
                  shared by storefront + admin — Stripe + PayPal adapters implement PaymentProvider
tools/            Standalone tools that need real internet access or Python
  wc-import-convert   Python original of the WooCommerce .xlsx converter now built into /admin/products/import — kept for local one-off conversions
```

The Vendorae Engine lives entirely outside this repo — own package.json, own hosting, own database,
zero imports from this app. Set `DROPSHIP_ENGINE_URL` to wherever you deploy it; this README
deliberately doesn't hardcode a URL for it, since it's a separate deployment you control.

## Blank by default

`supabase/seed.sql` creates only a single default tenant (slug `default-store`) with
`onboarding_completed = false`, no brand name beyond the generic placeholder "Your Store", and the
minimal reference rows checkout/admin need to not crash on an empty store (a shipping zone/method, a
tax settings row) — no demo products, categories, banners or reviews. A fresh deployment therefore
has nothing to show until the owner completes `/onboarding` and imports their own catalogue via
`/admin/products/import`.

If you're upgrading an installation that was seeded before this change (back when the default
tenant was named "Beach Footprints" with a demo catalogue), run
`supabase/migrations/0008_rebrand_default_tenant.sql` and
`supabase/migrations/0009_onboarding_settings.sql` — the first renames the tenant slug and clears
the old demo brand name, the second adds the wizard's columns to `tenant_settings`.
`supabase/scripts/delete_demo_tenant.sql` still exists for clearing out an old demo catalogue while
keeping the tenant row/slug intact.

## What's implemented

- **Data model** (`supabase/schema.sql`): tables covering products with a `product_type` enum (`STANDARD` / `ACCESSORY` / `CARE_PRODUCT` / `BUNDLE` / `GIFT_CARD`), structured `product_specs` key/value rows (not a text blob), admin-defined `attribute_definitions`/`product_attribute_values` for flexible filtering, `shipping_class` (standard/heavy/oversized/freight/special) with packaged dimensions, hierarchical categories, `compatibility_links` for cross-product relationships, bundles, wishlists (PIN hash, never plaintext), recently viewed, owned products ("My Products"), returns, warranty claims, support tickets, and CMS pages/banners. `tenant_settings` also carries the setup wizard's fields (`business_description`, `product_niche`, `onboarding_completed`, `stripe_*`/`paypal_*` credential fallbacks). **Row Level Security is enabled on every table** — see the policy block at the bottom of the file: tenant staff (via `memberships` + `is_tenant_member()`) can manage their tenant's data, customers can only read/write their own rows, storefront reads are limited to published/active rows, and money-moving tables (`carts`, `orders`, `payments`) — plus the payment-credential columns on `tenant_settings` — have no anon/public read or write policy on purpose: those reads/mutations go through a server route using the service-role client, which bypasses RLS.
- **Provider abstractions** (`packages/core`): `PaymentProvider`, `ShippingProvider`, `EmailProvider`, `AIProvider` interfaces with Stripe and PayPal adapters, a flat-rate/threshold shipping adapter, a mock payment provider and console email provider for local dev, and a fully deterministic (no external calls) recommendation engine for the product finder.
- **Payment credentials** (`apps/web/lib/config/paymentCredentials.ts`): resolves Stripe/PayPal credentials by preferring this deployment's own environment variables (the intentional design for an operator-controlled deployment — a secret key belongs in a deploy setting, not a database row) and falling back to whatever the `/onboarding` wizard saved in `tenant_settings`, for a self-serve owner with no access to the deployment's env vars. `apps/web/lib/checkout/stripe.ts` and `/api/admin/payments` both read through this helper, so wizard-entered keys work end to end.
- **Storefront**: homepage, `/shop` + nested category routes with database-shaped filtering, product detail pages (gallery, spec tabs, compatible accessories, related products, Product/Article JSON-LD), `/cart`, `/checkout` (React Hook Form + Zod, guest checkout, tokenized-payment messaging), `/compare`, `/product-finder`, `/care`, `/guides`, `sitemap.xml` / `robots.txt`.
- **Account**: orders + timeline, owned products, wishlists (with PIN option), addresses, profile, privacy preferences (recently-viewed opt-out), support (order-reference-first, no unnecessary detail required).
- **Admin**: dashboard, product list, categories, orders, CMS/banner editor, payments status (Stripe + PayPal, with source: env vs wizard) — skeleton screens demonstrating the information architecture. The entire `/admin` area and its `/api/admin/*` routes require a Supabase Auth session plus a `memberships` row for the tenant the request's Host resolved to (`apps/web/middleware.ts`, `/admin/login`) — an admin of one store can never act on another's, even with a valid session. A tenant with no `memberships` row yet falls back to the legacy shared `ADMIN_PASSWORD` HTTP Basic Auth so nobody is locked out; `/admin/create-account` bridges it to a real account, after which the shared password stops working for that tenant.
- **Chunked CSV product import** (`/admin/products/import`): imports a products CSV of any size without hitting a serverless function's request-body ceiling (~4.5MB on Vercel) or execution-duration ceiling. The browser uploads the raw file straight to Supabase Storage via a signed upload URL — the big binary transfer never passes through a Next.js function at all — then an `import_jobs` row tracks a resumable byte-offset cursor while `/api/admin/imports/[id]/process` is called repeatedly, each call fetching and parsing only one small `Range` slice of the file (256KB by default) and upserting that chunk's rows before returning. A hand-rolled, dependency-free CSV chunk parser (`packages/core/src/csv.ts`) carries an incomplete trailing row (`leftover`) across chunk boundaries — verified correct against chunk sizes from 3 bytes to 1000 bytes, including quoted fields with embedded commas and newlines. Row-level errors (bad price, unknown category handle, etc.) are collected without failing the rest of the chunk. The importer also accepts an `image_urls` column, writing `product_media` rows for each — a public `product-images` Storage bucket backs this. **Import order is categories, then products, then the rest**: before a chunk's new products are inserted, `apps/web/lib/import/categories.ts` ensures every category handle those rows reference already exists for the tenant — creating any that don't (including "/"-nested ancestors, e.g. `dresses-kimonos/sale` auto-creates `dresses-kimonos` first) — so a product can never land pointing at a category that isn't there yet; only then are products, variants, inventory, specs, images and category links written. **Existing products are always left alone**: a row whose handle already exists for the tenant is skipped entirely (not overwritten) — only new handles get inserted. A separate opt-in checkbox, "mark products not in this file as Out Of Stock", runs once after the whole file finishes: it sets stock to 0 (never deletes or unpublishes) on any tenant product sharing a brand seen in the import whose handle didn't appear anywhere in the file, so re-importing a supplier's latest catalogue can reflect discontinued items without touching unrelated products from other brands.
- **WooCommerce export import** — a much better source than scraping when the source store can supply one: an admin can upload a WooCommerce product-export `.xlsx` (real prices, hosted image URLs, a per-product HTML spec table) directly in `/admin/products/import` (a mode toggle alongside plain CSV), with no local script to run. `apps/web/lib/import/woocommerce.ts` converts it to the standard importer CSV server-side — classifies product type/category from title + category keywords (word-boundary matched, not naive substring), parses the embedded spec table for accurate material, strips HTML and an export artifact (a literal `\n` that triggers HTML5 foster-parenting inside the spec table, concatenating adjacent cells' text with no separator until fixed) — then hands off to the *exact same* tested byte-range chunked processor the CSV path uses, so it inherits the same any-file-size guarantee. Images are referenced from the source's own hosted URLs, not re-downloaded or re-hosted, on purpose. `tools/wc-import-convert/convert.py` is the original Python version this was ported from (kept for local one-off conversions without deploying).
- **Hero slideshow** (`components/HeroSlideshow.tsx`): the homepage hero crossfades between images, in a randomized order picked client-side on each page load (so the server-rendered first paint stays deterministic), on a slow fade (2s crossfade, 6s hold per slide). Falls back to placeholder imagery until real lookbook photography is dropped into `public/hero/` (see the README there).
- **Live Supabase data everywhere** (`apps/web/lib/data/*.ts`): every storefront and admin page reads real Supabase queries. `lib/data/products.ts` builds `ProductSummary`/`ProductDetail` from `products` + `product_variants` (cheapest active variant sets price/compare-at) + `inventory_items` (stock, drives "ready to ship") + `product_media` + `product_specs` + `reviews` (aggregated rating/count) + `compatibility_links` (compatible accessories) + shared-category membership (related products, since the schema has no dedicated "related" relation type); `isNew`/`isBestSeller`/`onSale` come from category membership (assign products to the `new-arrivals`/`best-sellers`/`sale` category handles via the importer's `category_handles` column, same as any other category) plus `onSale` also triggers off a variant's `compare_at`. `lib/data/cms.ts`/`guides.ts` read `banners`/`blog_posts`, both with sensible fallbacks so a blank store still renders a hero and an empty guides list rather than erroring. Everything queries through the service-role client scoped to `tenant_id` and (for storefront reads) `status = 'PUBLISHED'`, since there's no live Supabase Auth session yet to carry RLS. A few product-detail fields have no schema home (FAQs, "what's included") and stay as generic static copy rather than fabricated per-product claims. Pages that query the database are marked `export const dynamic = "force-dynamic"` so Next doesn't try to prerender them at build time without live credentials.
- **AliExpress dropshipping, via the Vendorae Engine** (`apps/web/lib/dropshipEngine.ts`, `supabase/migrations/0002_aliexpress_dropshipping_engine.sql`): this store holds no AliExpress logic of its own — everything (signing, pricing, copy rewriting, order placement, sync) lives in the engine, a separate repo/deployment this app is just a client of. See that engine's own README for its architecture, API contract, and test suite; this section covers only this app's side of the integration.
  - **`apps/web/lib/dropshipEngine.ts`** — the entire integration surface: typed wrappers over the engine's REST API (`importProduct`, `createMapping`, `fulfillOrder`, `getOrderStatus`, `triggerCatalogSync`/`triggerTrackingSync`, the AliExpress OAuth proxy calls, `registerWebhook`), authenticated with `DROPSHIP_ENGINE_API_KEY`. Nothing else in this app talks to the engine directly.
  - **`POST /api/admin/products/aliexpress/import`** — calls the engine's product import (which applies this store's pricing rule + brand voice server-side), then writes the result into this store's own `products`/`product_variants`/`inventory_items`/`product_media` (new products land `DRAFT`; a re-import of a known supplier product id updates in place), and registers each variant's mapping back with the engine (`external_variant_id` = this store's own `product_variants.id` — the engine never sees or stores anything about this store's schema beyond that one opaque id).
  - **`POST /api/admin/orders/:id/place-aliexpress`** — reads the order's `shipping_address`/line items and calls the engine's `POST /v1/orders/fulfill`; idempotency is the engine's responsibility (an atomic claim on its own `orders` table, keyed by this store's order id), not reimplemented here. Mirrors the result into this store's own `orders` row.
  - **`POST /api/webhooks/dropship-engine`** — receives the engine's signed webhooks (`product.price_changed`/`out_of_stock`/`restocked`, `order.shipped`/`delivered`/`fulfillment_failed`) and applies them to local `products`/`product_variants`/`inventory_items`/`orders`; verifies `X-Dropship-Signature` (`HMAC-SHA256(DROPSHIP_ENGINE_WEBHOOK_SECRET, rawBody)`) before trusting anything, and sends the shipping-confirmation email on `order.shipped`. This is how catalog/tracking sync results reach this store — the engine's own scheduled worker calls it, and so does `POST /api/admin/sync/tracking` (an on-demand trigger, for an admin "sync now" button).
  - **`GET /api/admin/aliexpress/auth`** (`GET` for the authorize link, `PUT` to register the AliExpress app key/secret, `POST` to exchange the OAuth code) and the **`/admin/aliexpress`** page — proxy the one-time AliExpress OAuth setup through the engine. Nothing here ever displays an AliExpress access/refresh token; the engine stores and refreshes them itself.
  - Every one of the above writes an entry to `fulfillment_logs` (this store's own local audit trail, distinct from the engine's own sync logs), readable via `GET /api/admin/fulfillment/logs`.

## What's stubbed / not wired to a live backend

- **PayPal checkout UI**: `packages/core/src/providers/adapters/paypal-payment.ts` implements the full `PaymentProvider` interface against PayPal's real REST Orders API (OAuth2 client-credentials, create/capture/refund/status, sandbox vs live base URL from `paypal_mode`) and credentials can be saved via the wizard or `/admin/payments`, but it is **not yet wired into the `/checkout` page** — only Stripe is live there today. See the `TODO` note in `apps/web/app/api/admin/payments/route.ts`.
- Supabase Auth (sign-up/sign-in) is not connected. Because of that, some pages are honest empty/placeholder states rather than showing fabricated per-customer data: `/account/wishlist` (wishlists are per-customer and need a signed-in customer to scope the query), and `/cart` starts empty since there's no cart persistence wired to "Add to Cart" yet.
- Transactional email: order-confirmation (on Stripe payment) and shipping-notification (on the Vendorae Engine's `order.shipped` webhook) emails are sent through `EmailProvider` (`packages/core`). Set `RESEND_API_KEY` and `EMAIL_FROM` to send real email via Resend; without both set, the deployment falls back to `ConsoleEmailProvider`, which logs the email instead of sending it.
- The store sells in **USD by default** (`tenant_settings.base_currency`). Change it at `/admin/payments`; saving also pushes the code to the engine's `import.targetCurrency` so newly imported products are quoted in it. Changing the setting never re-prices the existing catalogue.
- **Store policies** (`/legal/returns`, `/legal/shipping`, `/legal/terms`, `/legal/privacy`, from `apps/web/lib/legal/policies.ts`) are written generically for a supplier-shipped, international-dropship business model. **Before relying on them commercially: have a lawyer review them, and fill in `TRADING_ENTITY` in that file** (registered entity name, ABN/equivalent, postal address, website) — the pages read contact details from `tenant_settings` and fall back to the support page when unset.
- Shipping and tax are merchant-configured, not calculated: a flat shipping rate with a free-shipping threshold, and a single flat tax percentage (`tenant_settings.shipping_flat_rate_cents`/`free_shipping_threshold_cents`/`tax_rate_percent`, editable at `/admin/payments`). There is no live carrier-rate or tax-jurisdiction engine.
- Stock is checked when a Stripe session is created, not again when payment is confirmed. This is a deliberate, bounded gap: the ledger still clamps at zero, and `markOrderPaid` (`app/api/webhooks/stripe/route.ts`) logs a `stock_shortfall` `fulfillment_logs` entry when it happens, surfaced as a ⚠ on the affected order in `/admin/orders`.
- Generated TypeScript types (`packages/db/src/database.types.ts`) are a placeholder — run `pnpm db:types` against a live project to replace them.
- `next/font` (Google Fonts) was intentionally left out of `app/layout.tsx` in favor of a system-font stack.
- The homepage hero slideshow (`components/HeroSlideshow.tsx`) currently renders placeholder imagery until real photography is dropped into `apps/web/public/hero/`.

## Local development

```bash
pnpm install
pnpm dev          # apps/web on :3000

# Against a Supabase project:
pnpm schema       # prints how to apply supabase/schema.sql
pnpm seed         # prints how to apply supabase/seed.sql (creates the blank default tenant)
pnpm db:types     # regenerate packages/db/src/database.types.ts (needs SUPABASE_PROJECT_ID)

# The dropshipping engine is a fully separate repo/deployment — deploy your own
# and point DROPSHIP_ENGINE_URL at it (see below). Nothing to clone here for
# local dev of this app.
```

Also apply `supabase/storage.sql` (creates the `imports`, `product-images` and `branding` buckets)
alongside `schema.sql`, and any files under `supabase/migrations/` in numeric order if you seeded
before this rename (see [Blank by default](#blank-by-default)).

## Environment variables

`.env.local` in `apps/web`, plus server-only vars wherever `createServiceRoleSupabaseClient` runs:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=   # server-only — never expose to the browser
DEFAULT_TENANT_SLUG=          # optional, defaults to "default-store" — used when the request Host isn't a <slug>.<PLATFORM_ROOT_DOMAIN> (local dev, previews)
PLATFORM_ROOT_DOMAIN=          # optional, defaults to "vendorae.store" — stores are addressed as <slug>.<this>; the bare domain (or www.) serves the platform placeholder at /platform
ADMIN_PASSWORD=                # break-glass HTTP Basic Auth for /admin and /api/admin/* — only works for a tenant with zero `memberships` rows; see middleware.ts and /admin/create-account

# Stripe — optional here if you'd rather let each owner enter their own keys via the
# /onboarding wizard (saved to tenant_settings and read as a fallback — see
# apps/web/lib/config/paymentCredentials.ts). Setting these env vars always takes priority.
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

# PayPal — same env-first, wizard-fallback pattern as Stripe.
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_MODE=                   # "sandbox" or "live"; defaults to sandbox

# Optional — enables the /onboarding wizard's "AI Generate" logo button
# (apps/web/app/api/onboarding/logo/generate/route.ts). Without it, that
# endpoint returns a clear error and the wizard's upload option still works.
OPENAI_API_KEY=

# Dropshipping engine connection (see apps/web/lib/dropshipEngine.ts). This is a
# separate deployment you run yourself — set DROPSHIP_ENGINE_URL to wherever
# you host it, e.g. <your-dropship-engine-url>.
DROPSHIP_ENGINE_URL=            # e.g. <your-dropship-engine-url>
DROPSHIP_ENGINE_API_KEY=        # this store's API key, issued by the engine
DROPSHIP_ENGINE_WEBHOOK_SECRET= # generated by this app, registered with the engine
                                 # ({url: "<this deployment>/api/webhooks/dropship-engine", secret}) — see
                                 # POST /api/webhooks/dropship-engine's signature verification

# Optional — enables auto-assigning a newly imported AliExpress product to the best-fitting
# EXISTING category (lib/import/categorize.ts, called from the AliExpress import route). Never
# invents a new category; without this set, imported products are just left uncategorized.
ANTHROPIC_API_KEY=
```
