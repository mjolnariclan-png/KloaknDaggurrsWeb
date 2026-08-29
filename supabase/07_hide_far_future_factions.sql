-- ============================================================
-- Fully hide classified factions from everyone except the owner
-- (who reads the raw public.factions table via app.js instead of
-- this view) unless their reveal is within the next 30 days.
-- Run once in Supabase SQL Editor.
-- ============================================================
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
