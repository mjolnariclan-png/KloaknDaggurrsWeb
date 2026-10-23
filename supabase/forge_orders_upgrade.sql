-- Run once in the Supabase SQL Editor to enable the updated Forge order form.
alter table public.forge_orders
  add column if not exists printed_by date,
  add column if not exists delivery_date date,
  add column if not exists height_inches numeric(7,2),
  add column if not exists width_inches numeric(7,2),
  add column if not exists length_inches numeric(7,2),
  add column if not exists model_files text[] not null default '{}';

insert into storage.buckets (id, name, public, file_size_limit)
values ('forge-models', 'forge-models', false, 26214400)
on conflict (id) do update
set public = false, file_size_limit = 26214400;

drop policy if exists "Forge customers upload own model files" on storage.objects;
create policy "Forge customers upload own model files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'forge-models'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and lower(name) ~ '\.(obj|stl|3mf)$'
);

drop policy if exists "Forge customers and admins read model files" on storage.objects;
create policy "Forge customers and admins read model files"
on storage.objects for select to authenticated
using (
  bucket_id = 'forge-models'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.is_admin()
  )
);

drop policy if exists "Forge customers remove own model files" on storage.objects;
create policy "Forge customers remove own model files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'forge-models'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
