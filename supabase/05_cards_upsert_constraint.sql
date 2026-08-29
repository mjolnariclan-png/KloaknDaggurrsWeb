-- ============================================================
-- Lets sync-cards.js upsert by (faction_slug, card_number) instead
-- of creating duplicate rows every time it runs.
-- Run once in Supabase SQL Editor.
-- ============================================================

-- Inspect duplicates first if you want to see what's about to be removed.
-- select faction_slug, card_number, count(*) from public.cards
-- group by faction_slug, card_number having count(*) > 1;

-- Keep the newest row per (faction_slug, card_number), drop the rest.
delete from public.cards c
using public.cards newer
where c.faction_slug = newer.faction_slug
  and c.card_number = newer.card_number
  and c.id < newer.id;

alter table public.cards
  add constraint cards_faction_card_number_uq unique (faction_slug, card_number);

