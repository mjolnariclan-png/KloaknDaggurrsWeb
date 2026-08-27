-- ============================================================
-- Fix faction reveal status to match current design
-- ============================================================

-- Set Ash Cycle and First Light as revealed
update public.factions 
set revealed = true 
where slug in ('ash-cycle', 'first-light');

-- Keep all other factions locked for now
update public.factions 
set revealed = false 
where slug not in ('ash-cycle', 'first-light');

-- Verify the changes
select slug, name, revealed from public.factions order by sort_order;