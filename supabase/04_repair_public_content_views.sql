-- ============================================================
-- Restore public content access for the K&D web client.
-- Run once in Supabase SQL Editor after the legacy complete setup.
-- ============================================================

drop view if exists public.public_factions;
drop view if exists public.public_cards;
drop view if exists public.public_whispers;

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
from public.factions;

create or replace view public.public_cards
with (security_invoker = false)
as
select
  c.id,
  c.slug,
  c.card_number,
  c.rarity,
  c.card_type,
  c.sort_order,
  c.reveal_at,
  case when f.revealed or (f.reveal_at is not null and f.reveal_at <= now()) then f.slug else null end as faction_slug,
  case when f.revealed or (f.reveal_at is not null and f.reveal_at <= now()) then f.name else 'UNKNOWN' end as faction_name,
  (c.revealed or (c.reveal_at is not null and c.reveal_at <= now())) as is_live,
  case when c.revealed or (c.reveal_at is not null and c.reveal_at <= now()) then c.name else 'CLASSIFIED' end as name,
  case when c.revealed or (c.reveal_at is not null and c.reveal_at <= now()) then c.ability else null end as ability,
  case when c.revealed or (c.reveal_at is not null and c.reveal_at <= now()) then c.lore else null end as lore,
  case when c.revealed or (c.reveal_at is not null and c.reveal_at <= now()) then c.image_url else null end as image_url
from public.cards c
left join public.factions f on f.id = c.faction_id;

create or replace view public.public_whispers
with (security_invoker = false)
as
select id, published_at, title, body, classified, image_url, reveal_at
from public.whispers
where reveal_at is null or reveal_at <= now();

grant select on public.public_factions, public.public_cards, public.public_whispers to anon, authenticated;

alter table public.wars enable row level security;
grant select on public.wars to anon, authenticated;

drop policy if exists "public read wars" on public.wars;
create policy "public read wars"
on public.wars for select to anon, authenticated
using (true);

-- Expect three views, plus public read access to wars.
select table_name
from information_schema.views
where table_schema = 'public'
  and table_name in ('public_factions', 'public_cards', 'public_whispers')
order by table_name;