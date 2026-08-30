-- ============================================================
-- KLOAK & DAGGURRS — CONSOLIDATED SCHEMA (end-state, v2)
-- ============================================================
-- Merges 01_schema_and_seed.sql (the original V5 install — auth,
-- profiles, vault, collections, forge, reviews/contacts/site infra,
-- storage bucket, RPCs) with the later TCG-era card/faction schema
-- (cards_schema.sql + files 04-17, previously consolidated) and the
-- schema-only parts of fantasy_theme_migration.sql.
--
-- You confirmed the TCG schema (faction_slug FK, vigor_type, ap,
-- dp, attacks jsonb) is the current live one, so 01's original
-- `factions.rune`-based simple cards table (faction_id FK, slug,
-- ability, lore) is NOT recreated — it's fully replaced by the
-- cards table in section 3.
--
-- Excluded on purpose (data/content, not schema):
--   01_schema_and_seed.sql's seed INSERTs (factions/cards/whispers/
--     vault_entries/site_settings sample content)
--   00_repair_existing_profiles.sql   (subset of what 01 already does)
--   complete_database_setup.sql       (deletes + reseeds all game data)
--   complete_faction_update.sql       (one-off lore/tagline content)
--   fix_war_names.sql                 (one-off short_name updates)
--   02_make_me_owner.sql              (one-off, needs your real email
--                                      edited in — run separately after
--                                      this script)
--   03_verify_install.sql             (read-only verification queries)
--   cards_data_import.sql, 08/09/11.sql, diagnostics 14/15/16
--     (excluded already in the prior consolidation, still excluded)
--
-- Assumes public.wars already exists (its CREATE TABLE wasn't in any
-- file you've given me — only ALTER/INSERT/SELECT against it).
--
-- WARNING: section 3 still does "drop table if exists public.cards
-- cascade" — destructive to existing card data. Comment it out if
-- you're running this against a database with real cards already in it.
-- ============================================================


-- ============================================================
-- 0. EXTENSIONS
-- ============================================================
create extension if not exists pgcrypto;


-- ============================================================
-- 1. PROFILES + AUTH
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

-- Normalize any null/blank legacy values before adding constraints.
update public.profiles
set
  created_at = coalesce(created_at, now()),
  display_name = coalesce(display_name, ''),
  role = coalesce(nullif(role,''), 'player'),
  active = coalesce(active, true);

-- Backfill email and display name from Supabase Auth for existing accounts.
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
  created_at = coalesce(p.created_at, u.created_at, now())
from auth.users u
where p.id = u.id;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('player','admin','owner'));
  end if;
end $$;

alter table public.profiles
  alter column created_at set default now(),
  alter column display_name set default '',
  alter column role set default 'player',
  alter column active set default true;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id,email,display_name,created_at,role,active)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data->>'display_name',''),
      nullif(new.raw_user_meta_data->>'full_name',''),
      split_part(coalesce(new.email,''),'@',1)
    ),
    coalesce(new.created_at, now()),
    'player',
    true
  )
  on conflict (id) do update
  set
    email = coalesce(excluded.email, public.profiles.email),
    display_name = case
      when coalesce(public.profiles.display_name,'') = ''
        then excluded.display_name
      else public.profiles.display_name
    end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill profiles for Auth users that do not yet have a public profile.
insert into public.profiles(id,email,display_name,created_at,role,active)
select
  id,
  email,
  coalesce(
    nullif(raw_user_meta_data->>'display_name',''),
    nullif(raw_user_meta_data->>'full_name',''),
    split_part(coalesce(email,''),'@',1)
  ),
  coalesce(created_at,now()),
  'player',
  true
from auth.users
on conflict(id) do nothing;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and active = true
      and role in ('owner','admin')
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;


-- ============================================================
-- 2. FACTIONS TABLE
-- ============================================================
create table if not exists public.factions (
  id bigint generated by default as identity primary key,
  slug text unique not null,
  name text not null,
  rune text not null default '◇',
  tagline text not null default '',
  lore text not null default '',
  doctrine text not null default '',
  accent text not null default '#7d43ff',
  image_url text,
  revealed boolean not null default false,
  reveal_at timestamptz,
  sort_order integer not null default 100
);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'factions' and column_name = 'number'
  ) then
    alter table public.factions add column number text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'factions' and column_name = 'rune_image_url'
  ) then
    alter table public.factions add column rune_image_url text;
  end if;
end $$;

-- Functional backfill: give any existing rows a default `number` so
-- the not-yet-set-manually rows aren't left null after the column add.
update public.factions
set number = 'Book ' || row_num::text
from (
  select id, row_number() over (order by sort_order) as row_num
  from public.factions
) numbered
where public.factions.id = numbered.id and public.factions.number is null;


-- ============================================================
-- 3. CARDS TABLE (TCG schema — current live version)
-- ============================================================
drop table if exists public.cards cascade;

create table public.cards (
  id bigint generated by default as identity primary key,
  created_at timestamptz not null default now(),

  -- Basic Info
  name text not null,
  card_number text not null,
  set_name text not null,
  faction_slug text not null references public.factions(slug) on delete cascade,

  -- Type & Rarity
  type text not null check (type in ('Vigor', 'Creature', 'Accoutrements', 'Runes', 'Primordial Being')),
  rarity text check (rarity in ('Thrall', 'Skilled', 'Karls', 'Jarl', 'Konugr')),

  -- Vigor Info
  vigor_type text,
  vigor_cost integer,

  -- Creature/Primordial Stats
  class_name text,
  ap integer,
  dp integer,
  mana_card_cost integer,

  -- Strength/Weakness
  strength_vigor text,
  weakness_vigor text,

  -- Attacks (JSON array)
  attacks jsonb,

  -- Equipment/Runes specific
  equipment_type text,
  attack_name text,
  attack_description text,

  -- Reveal Status
  revealed boolean not null default false,
  reveal_at timestamptz,

  -- Image Path
  image_url text,

  -- Sorting
  sort_order integer default 0
);

alter table public.cards enable row level security;

grant select on public.cards to anon, authenticated;
grant select, insert, update, delete on public.cards to authenticated;

drop policy if exists "public read cards" on public.cards;
create policy "public read cards"
on public.cards for select to anon, authenticated
using (true);

drop policy if exists "admins manage cards" on public.cards;
create policy "admins manage cards"
on public.cards for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create index idx_cards_faction on public.cards(faction_slug);
create index idx_cards_type on public.cards(type);
create index idx_cards_rarity on public.cards(rarity);
create index idx_cards_vigor on public.cards(vigor_type);
create index idx_cards_name on public.cards(name);

-- Upsert key so sync-cards.js can upsert by (faction_slug, card_number)
-- instead of creating duplicate rows every time it runs.
delete from public.cards c
using public.cards newer
where c.faction_slug = newer.faction_slug
  and c.card_number = newer.card_number
  and c.id < newer.id;

alter table public.cards
  add constraint cards_faction_card_number_uq unique (faction_slug, card_number);


-- ============================================================
-- 4. WHISPERS TABLE
-- ============================================================
create table if not exists public.whispers (
  id bigint generated by default as identity primary key,
  created_at timestamptz not null default now(),
  published_at date not null default current_date,
  title text not null,
  body text not null,
  classified boolean not null default false,
  image_url text,
  reveal_at timestamptz
);
create unique index if not exists whispers_title_date_uq on public.whispers(title,published_at);


-- ============================================================
-- 5. VAULT ENTRIES + VAULT UNLOCKS
-- ============================================================
create table if not exists public.vault_entries (
  id bigint generated by default as identity primary key,
  code text unique not null,
  title text not null,
  teaser text not null default '',
  body text not null default '',
  status text not null default 'locked' check (status in ('locked','open')),
  reveal_at timestamptz,
  access_code text,
  image_url text
);

create table if not exists public.vault_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  vault_entry_id bigint not null references public.vault_entries(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key(user_id,vault_entry_id)
);


-- ============================================================
-- 6. PLAYER COLLECTIONS
-- ============================================================
create table if not exists public.collections (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id bigint not null references public.cards(id) on delete cascade,
  quantity integer not null default 1 check (quantity between 1 and 99),
  updated_at timestamptz not null default now(),
  primary key(user_id,card_id)
);


-- ============================================================
-- 7. FORGE (print orders)
-- ============================================================
create table if not exists public.forge_orders (
  id uuid primary key default gen_random_uuid(),
  order_code text unique not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  customer_name text not null,
  email text not null,
  phone text,
  print_type text,
  quantity integer not null default 1 check (quantity > 0),
  deadline date,
  source_link text,
  colors text,
  notes text,
  status text not null default 'new'
    check (status in ('new','quoted','approved','printing','quality_check','ready','completed','cancelled')),
  customer_update text not null default ''
);

create table if not exists public.forge_order_updates (
  id bigint generated by default as identity primary key,
  order_id uuid not null references public.forge_orders(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null,
  message text not null default ''
);


-- ============================================================
-- 8. REVIEWS / CONTACTS / SUBSCRIBERS / SITE_SETTINGS / AUDIT / MEDIA
-- ============================================================
create table if not exists public.reviews (
  id bigint generated by default as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  rating integer not null check (rating between 1 and 5),
  body text not null,
  approved boolean not null default false
);

create table if not exists public.contacts (
  id bigint generated by default as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text not null,
  subject text not null,
  message text not null,
  status text not null default 'new' check (status in ('new','read','closed'))
);

create table if not exists public.subscribers (
  id bigint generated by default as identity primary key,
  created_at timestamptz not null default now(),
  email text unique not null,
  active boolean not null default true
);

create table if not exists public.site_settings (
  key text primary key,
  value text not null default ''
);

create table if not exists public.audit_log (
  id bigint generated by default as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  detail text not null default ''
);

create table if not exists public.media (
  id bigint generated by default as identity primary key,
  created_at timestamptz not null default now(),
  owner_id uuid references auth.users(id) on delete set null,
  title text not null default '',
  alt_text text not null default '',
  category text not null default 'general',
  storage_path text unique not null,
  public boolean not null default true
);


-- ============================================================
-- 9. WARS TABLE (assumed pre-existing — only altering/granting here)
-- ============================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'wars' and column_name = 'short_name'
  ) then
    alter table public.wars add column short_name text;
    update public.wars set short_name = title where short_name is null;
  end if;
end $$;

alter table public.wars enable row level security;
grant select on public.wars to anon, authenticated;

drop policy if exists "public read wars" on public.wars;
create policy "public read wars"
on public.wars for select to anon, authenticated
using (true);


-- ============================================================
-- 10. RLS + GRANTS (everything except cards, which is self-contained
-- in section 3)
-- ============================================================
alter table public.profiles enable row level security;
alter table public.factions enable row level security;
alter table public.whispers enable row level security;
alter table public.vault_entries enable row level security;
alter table public.vault_unlocks enable row level security;
alter table public.collections enable row level security;
alter table public.forge_orders enable row level security;
alter table public.forge_order_updates enable row level security;
alter table public.reviews enable row level security;
alter table public.contacts enable row level security;
alter table public.subscribers enable row level security;
alter table public.site_settings enable row level security;
alter table public.audit_log enable row level security;
alter table public.media enable row level security;

revoke all on table public.profiles, public.factions, public.whispers,
  public.vault_entries, public.vault_unlocks, public.collections, public.forge_orders,
  public.forge_order_updates, public.reviews, public.contacts, public.subscribers,
  public.site_settings, public.audit_log, public.media
from anon, authenticated;

-- Accounts
grant select on public.profiles to authenticated;
grant update(display_name) on public.profiles to authenticated;

drop policy if exists "profile read own or admin" on public.profiles;
create policy "profile read own or admin"
on public.profiles for select to authenticated
using ((select auth.uid()) = id or public.is_admin());

drop policy if exists "profile update own" on public.profiles;
create policy "profile update own"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- Owner/admin content access
grant select,insert,update,delete on public.factions, public.whispers,
  public.vault_entries, public.site_settings, public.media to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='factions' and policyname='admins manage factions') then
    create policy "admins manage factions" on public.factions for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='whispers' and policyname='admins manage whispers') then
    create policy "admins manage whispers" on public.whispers for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='vault_entries' and policyname='admins manage vault') then
    create policy "admins manage vault" on public.vault_entries for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='site_settings' and policyname='admins manage settings') then
    create policy "admins manage settings" on public.site_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='media' and policyname='admins manage media') then
    create policy "admins manage media" on public.media for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
end $$;

-- Collections
grant select,insert,update,delete on public.collections to authenticated;

drop policy if exists "players read own collection" on public.collections;
create policy "players read own collection"
on public.collections for select to authenticated
using ((select auth.uid()) = user_id or public.is_admin());

drop policy if exists "players insert own collection" on public.collections;
create policy "players insert own collection"
on public.collections for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "players update own collection" on public.collections;
create policy "players update own collection"
on public.collections for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "players delete own collection" on public.collections;
create policy "players delete own collection"
on public.collections for delete to authenticated
using ((select auth.uid()) = user_id);

-- Vault unlocks
grant select,insert on public.vault_unlocks to authenticated;

drop policy if exists "players read own vault unlocks" on public.vault_unlocks;
create policy "players read own vault unlocks"
on public.vault_unlocks for select to authenticated
using ((select auth.uid()) = user_id or public.is_admin());

drop policy if exists "players insert own vault unlocks" on public.vault_unlocks;
create policy "players insert own vault unlocks"
on public.vault_unlocks for insert to authenticated
with check ((select auth.uid()) = user_id);

-- Forge
grant select,insert on public.forge_orders to authenticated;
grant update on public.forge_orders to authenticated;
grant select on public.forge_order_updates to authenticated;
grant insert on public.forge_order_updates to authenticated;

drop policy if exists "customers create own forge order" on public.forge_orders;
create policy "customers create own forge order"
on public.forge_orders for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "customers read own forge orders" on public.forge_orders;
create policy "customers read own forge orders"
on public.forge_orders for select to authenticated
using ((select auth.uid()) = user_id or public.is_admin());

drop policy if exists "admins update forge orders" on public.forge_orders;
create policy "admins update forge orders"
on public.forge_orders for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "customers read own order updates" on public.forge_order_updates;
create policy "customers read own order updates"
on public.forge_order_updates for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.forge_orders o
    where o.id = order_id and o.user_id = (select auth.uid())
  )
);

drop policy if exists "admins create order updates" on public.forge_order_updates;
create policy "admins create order updates"
on public.forge_order_updates for insert to authenticated
with check (public.is_admin());

-- Reviews
grant select,insert on public.reviews to anon, authenticated;
grant update,delete on public.reviews to authenticated;

drop policy if exists "public reads approved reviews" on public.reviews;
create policy "public reads approved reviews"
on public.reviews for select to anon, authenticated
using (approved or public.is_admin());

drop policy if exists "anyone submits unapproved review" on public.reviews;
create policy "anyone submits unapproved review"
on public.reviews for insert to anon, authenticated
with check (approved = false);

drop policy if exists "admins manage reviews" on public.reviews;
create policy "admins manage reviews"
on public.reviews for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "admins delete reviews" on public.reviews;
create policy "admins delete reviews"
on public.reviews for delete to authenticated
using (public.is_admin());

-- Contacts
grant insert on public.contacts to anon, authenticated;
grant select,update,delete on public.contacts to authenticated;

drop policy if exists "anyone submits contact" on public.contacts;
create policy "anyone submits contact"
on public.contacts for insert to anon, authenticated
with check (true);

drop policy if exists "admins read contacts" on public.contacts;
create policy "admins read contacts"
on public.contacts for select to authenticated
using (public.is_admin());

drop policy if exists "admins update contacts" on public.contacts;
create policy "admins update contacts"
on public.contacts for update to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "admins delete contacts" on public.contacts;
create policy "admins delete contacts"
on public.contacts for delete to authenticated
using (public.is_admin());

-- Subscribers: insertion through RPC only, admin reads.
grant select on public.subscribers to authenticated;

drop policy if exists "admins read subscribers" on public.subscribers;
create policy "admins read subscribers"
on public.subscribers for select to authenticated
using (public.is_admin());

-- Audit
grant select,insert on public.audit_log to authenticated;

drop policy if exists "admins read audit" on public.audit_log;
create policy "admins read audit"
on public.audit_log for select to authenticated
using (public.is_admin());

drop policy if exists "admins insert audit" on public.audit_log;
create policy "admins insert audit"
on public.audit_log for insert to authenticated
with check (public.is_admin());


-- ============================================================
-- 11. FACTIONS / WHISPERS PUBLIC READ POLICIES (fix_rls_policies.sql)
-- + the whispers base-table grant that files 13-17 diagnosed as
-- actually necessary in addition to the policy.
--
-- NOTE: section 10 above only grants anon,authenticated SELECT on
-- public.cards and public.wars directly — public.factions and
-- public.whispers are granted to `authenticated` only. The public
-- site reads factions/whispers through the public_factions /
-- public_whispers views (section 16), which run with the view
-- owner's rights regardless of this policy. This "public read
-- factions" policy is harmless to keep, but on its own it won't let
-- anon query public.factions directly — there's no anon GRANT on
-- that table (unlike whispers, which got one below after 13-17
-- diagnosed it needed it).
-- ============================================================
drop policy if exists "public read factions" on public.factions;
create policy "public read factions"
on public.factions for select to anon, authenticated
using (true);

drop policy if exists "public read whispers" on public.whispers;
create policy "public read whispers"
on public.whispers for select to anon, authenticated
using (true);

grant select on public.whispers to anon, authenticated;


-- ============================================================
-- 12. ADMIN: DYNAMIC TABLE COLUMNS + ROLE MANAGEMENT
-- ============================================================
create or replace function public.admin_table_columns(p_table text)
returns table(column_name text, data_type text, is_nullable boolean, ordinal_position int)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  return query
  select c.column_name::text, c.data_type::text, (c.is_nullable = 'YES'), c.ordinal_position::int
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = p_table
  order by c.ordinal_position;
end;
$$;

revoke all on function public.admin_table_columns(text) from public;
grant execute on function public.admin_table_columns(text) to authenticated;

create or replace function public.admin_set_user_role(target_user uuid, new_role text, new_active boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin required';
  end if;
  if new_role not in ('player','admin','owner') then
    raise exception 'Invalid role';
  end if;
  update public.profiles set role=new_role,active=new_active where id=target_user;
end;
$$;
grant execute on function public.admin_set_user_role(uuid,text,boolean) to authenticated;


-- ============================================================
-- 13. SECURE RPCs
-- ============================================================
create or replace function public.subscribe_email(input_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if input_email is null or position('@' in input_email) < 2 then
    raise exception 'Invalid email';
  end if;
  insert into public.subscribers(email,active)
  values (lower(trim(input_email)),true)
  on conflict(email) do update set active=true;
end;
$$;
grant execute on function public.subscribe_email(text) to anon,authenticated;

create or replace function public.unlock_vault_code(input_code text)
returns table(
  id bigint, code text, title text, teaser text, body text, image_url text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.vault_entries%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in required';
  end if;

  select * into v
  from public.vault_entries
  where upper(access_code)=upper(trim(input_code))
  limit 1;

  if v.id is null then
    raise exception 'Invalid code';
  end if;

  insert into public.vault_unlocks(user_id,vault_entry_id)
  values ((select auth.uid()),v.id)
  on conflict do nothing;

  return query select v.id,v.code,v.title,v.teaser,v.body,v.image_url;
end;
$$;
grant execute on function public.unlock_vault_code(text) to authenticated;

create or replace function public.get_vault_entries()
returns table(
  id bigint, code text, title text, teaser text, body text,
  status text, reveal_at timestamptz, image_url text, unlocked boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    v.id,
    v.code,
    case when
      v.status='open' or (v.reveal_at is not null and v.reveal_at <= now())
      or public.is_admin()
      or exists(select 1 from public.vault_unlocks u where u.vault_entry_id=v.id and u.user_id=(select auth.uid()))
    then v.title else 'CLASSIFIED' end,
    v.teaser,
    case when
      v.status='open' or (v.reveal_at is not null and v.reveal_at <= now())
      or public.is_admin()
      or exists(select 1 from public.vault_unlocks u where u.vault_entry_id=v.id and u.user_id=(select auth.uid()))
    then v.body else null end,
    v.status,
    v.reveal_at,
    case when
      v.status='open' or (v.reveal_at is not null and v.reveal_at <= now())
      or public.is_admin()
      or exists(select 1 from public.vault_unlocks u where u.vault_entry_id=v.id and u.user_id=(select auth.uid()))
    then v.image_url else null end,
    (
      v.status='open' or (v.reveal_at is not null and v.reveal_at <= now())
      or public.is_admin()
      or exists(select 1 from public.vault_unlocks u where u.vault_entry_id=v.id and u.user_id=(select auth.uid()))
    )
  from public.vault_entries v
  order by v.id;
$$;
grant execute on function public.get_vault_entries() to anon,authenticated;


-- ============================================================
-- 14. AUTO-ARCHIVE FACTION REVEALS
-- ============================================================
create or replace function public.log_faction_reveal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'UPDATE' and new.revealed = true and coalesce(old.revealed,false) = false) then
    insert into public.vault_entries(code,title,teaser,body,status)
    values (
      'reveal-' || new.slug,
      'THE VEIL LIFTS: ' || new.name,
      'A new faction has stepped into the light.',
      new.name || ' has been revealed. ' || coalesce(new.tagline,''),
      'open'
    )
    on conflict (code) do update
      set title = excluded.title,
          teaser = excluded.teaser,
          body = excluded.body,
          status = 'open';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_faction_reveal on public.factions;
create trigger trg_log_faction_reveal
after update on public.factions
for each row
execute function public.log_faction_reveal();


-- ============================================================
-- 15. STORAGE BUCKET for K&D media
-- ============================================================
insert into storage.buckets(id,name,public)
values ('kd-media','kd-media',true)
on conflict(id) do update set public=true;

drop policy if exists "public reads kd media" on storage.objects;
create policy "public reads kd media"
on storage.objects for select to public
using (bucket_id='kd-media');

drop policy if exists "admins upload kd media" on storage.objects;
create policy "admins upload kd media"
on storage.objects for insert to authenticated
with check (bucket_id='kd-media' and public.is_admin());

drop policy if exists "admins update kd media" on storage.objects;
create policy "admins update kd media"
on storage.objects for update to authenticated
using (bucket_id='kd-media' and public.is_admin())
with check (bucket_id='kd-media' and public.is_admin());

drop policy if exists "admins delete kd media" on storage.objects;
create policy "admins delete kd media"
on storage.objects for delete to authenticated
using (bucket_id='kd-media' and public.is_admin());


-- ============================================================
-- 16. PUBLIC-FACING VIEWS (TCG versions — final, superseding any
-- earlier public_factions/public_cards definitions)
-- ============================================================
drop view if exists public.public_factions;
drop view if exists public.public_cards;
drop view if exists public.public_whispers;

-- Hides classified factions from everyone except the owner (who
-- reads the raw public.factions table directly) unless their reveal
-- is within the next 30 days.
create or replace view public.public_factions
with (security_invoker = false)
as
select
  id,
  slug,
  name,
  tagline,
  lore,
  doctrine,
  accent,
  sort_order,
  reveal_at,
  rune_image_url,
  number,
  (revealed or (reveal_at is not null and reveal_at <= now())) as is_live
from public.factions
where revealed
   or (reveal_at is not null and reveal_at <= now() + interval '30 days');

grant select on public.public_factions to anon, authenticated;

-- Hides cards that belong to a faction which is itself still hidden.
-- A card's own revealed flag still controls whether its name/art is
-- masked as CLASSIFIED, but the whole card disappears if its faction
-- isn't public yet.
create or replace view public.public_cards
with (security_invoker = false)
as
select
  c.id,
  c.card_number,
  c.set_name,
  c.rarity,
  c.type,
  c.vigor_type,
  c.vigor_cost,
  c.class_name,
  c.ap,
  c.dp,
  c.mana_card_cost,
  c.strength_vigor,
  c.weakness_vigor,
  c.attacks,
  c.equipment_type,
  c.attack_name,
  c.attack_description,
  c.sort_order,
  c.reveal_at,
  f.slug as faction_slug,
  f.name as faction_name,
  (c.revealed or (c.reveal_at is not null and c.reveal_at <= now())) as is_live,
  case when c.revealed or (c.reveal_at is not null and c.reveal_at <= now()) then c.name else 'CLASSIFIED' end as name,
  case when c.revealed or (c.reveal_at is not null and c.reveal_at <= now()) then c.image_url else null end as image_url
from public.cards c
join public.factions f on f.slug = c.faction_slug
where f.revealed
   or (f.reveal_at is not null and f.reveal_at <= now() + interval '30 days');

grant select on public.public_cards to anon, authenticated;

create or replace view public.public_whispers
with (security_invoker = false)
as
select id, published_at, title, body, classified, image_url, reveal_at
from public.whispers
where reveal_at is null or reveal_at <= now();

grant select on public.public_whispers to anon, authenticated;


-- ============================================================
-- 17. SANITY CHECK
-- ============================================================
select table_name
from information_schema.views
where table_schema = 'public'
  and table_name in ('public_factions', 'public_cards', 'public_whispers')
order by table_name;

select 'profiles' table_name, count(*) rows from public.profiles
union all select 'factions', count(*) from public.factions
union all select 'cards', count(*) from public.cards
union all select 'whispers', count(*) from public.whispers
union all select 'vault_entries', count(*) from public.vault_entries
union all select 'public_factions', count(*) from public.public_factions
union all select 'public_cards', count(*) from public.public_cards
union all select 'public_whispers', count(*) from public.public_whispers;
