-- ============================================================
-- Beach Footprints — Storage buckets
-- Run after supabase/schema.sql, e.g.:
--   supabase db execute -f supabase/storage.sql
-- ============================================================

insert into storage.buckets (id, name, public)
values
  ('imports', 'imports', false),
  ('product-images', 'product-images', true)
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
