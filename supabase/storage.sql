-- ============================================================
-- Vendorae — Storage buckets
-- Run after supabase/schema.sql, e.g.:
--   supabase db execute -f supabase/storage.sql
-- ============================================================

insert into storage.buckets (id, name, public)
values
  ('imports', 'imports', false),
  ('product-images', 'product-images', true),
  ('branding', 'branding', true)
on conflict (id) do nothing;

-- Objects are stored at "<tenant_id>/<import_job_id>/<filename>.csv" — the
-- leading path segment is the tenant id, so RLS can scope access to that
-- tenant's own staff without a separate mapping table.
create policy "tenant members manage their import files" on storage.objects for all
  using (bucket_id = 'imports' and is_tenant_member((storage.foldername(name))[1]::uuid))
  with check (bucket_id = 'imports' and is_tenant_member((storage.foldername(name))[1]::uuid));

-- Product imagery is public (needed for the storefront to render it) but
-- only tenant staff may upload/replace/delete it. Objects are stored at
-- "<tenant_id>/<product_handle>/<filename>", same leading-segment convention.
create policy "anyone can view product images" on storage.objects for select
  using (bucket_id = 'product-images');
create policy "tenant members manage their product images" on storage.objects for all
  using (bucket_id = 'product-images' and is_tenant_member((storage.foldername(name))[1]::uuid))
  with check (bucket_id = 'product-images' and is_tenant_member((storage.foldername(name))[1]::uuid));

-- Business logos uploaded via the /onboarding setup wizard (or later from admin). Public read so
-- the storefront header/footer can render the logo without auth; the wizard itself writes through
-- the service-role client (see app/api/onboarding/logo/route.ts), since it can run before the new
-- owner has a membership row at all — the tenant-member policy below covers later edits from
-- admin. Same "<tenant_id>/<filename>" leading-segment convention as the other buckets.
create policy "anyone can view branding assets" on storage.objects for select
  using (bucket_id = 'branding');
create policy "tenant members manage their branding assets" on storage.objects for all
  using (bucket_id = 'branding' and is_tenant_member((storage.foldername(name))[1]::uuid))
  with check (bucket_id = 'branding' and is_tenant_member((storage.foldername(name))[1]::uuid));
