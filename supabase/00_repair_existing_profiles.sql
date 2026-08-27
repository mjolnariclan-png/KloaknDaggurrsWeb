-- ============================================================
-- K&D V5.1 — REPAIR AN EXISTING public.profiles TABLE
-- Run this if the V5 installer failed because profiles.email,
-- profiles.display_name, profiles.role, etc. did not exist.
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade
);

alter table public.profiles
  add column if not exists created_at timestamptz default now(),
  add column if not exists email text,
  add column if not exists display_name text default '',
  add column if not exists role text default 'player',
  add column if not exists active boolean default true;

update public.profiles
set
  created_at = coalesce(created_at, now()),
  display_name = coalesce(display_name, ''),
  role = coalesce(nullif(role,''), 'player'),
  active = coalesce(active, true);

update public.profiles p
set
  email = coalesce(nullif(p.email,''), u.email),
  display_name = case
    when coalesce(p.display_name,'') = '' then
      coalesce(
        nullif(u.raw_user_meta_data->>'display_name',''),
        nullif(u.raw_user_meta_data->>'full_name',''),
        split_part(coalesce(u.email,''),'@',1)
      )
    else p.display_name
  end,
  created_at = coalesce(p.created_at,u.created_at,now())
from auth.users u
where p.id=u.id;

select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema='public'
  and table_name='profiles'
order by ordinal_position;
