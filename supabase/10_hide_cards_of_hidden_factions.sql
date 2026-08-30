-- ============================================================
-- Hide cards that belong to a faction which is itself still hidden
-- (mirrors 07_hide_far_future_factions.sql). A card's own revealed
-- flag still controls whether its name/art is masked as CLASSIFIED,
-- but now the whole card disappears if its faction isn't public yet.
-- Run once in Supabase SQL Editor.
-- ============================================================
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
