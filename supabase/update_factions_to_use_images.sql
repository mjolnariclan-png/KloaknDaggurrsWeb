-- ============================================================
-- Update factions to use image runes instead of text symbols
-- ============================================================

-- First, add the rune_image_url column if it doesn't exist
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'factions' and column_name = 'rune_image_url'
  ) then
    alter table public.factions add column rune_image_url text;
  end if;
end $$;

-- Update each faction with their corresponding image
update public.factions 
set rune_image_url = 'assets/img/Golden Flow-S.png'
where slug = 'golden-flow';

update public.factions 
set rune_image_url = 'assets/img/Crimson Oath-S.png'
where slug = 'crimson-oath';

update public.factions 
set rune_image_url = 'assets/img/Ash Cycle-S.png'
where slug = 'ash-cycle';

update public.factions 
set rune_image_url = 'assets/img/First Light-S.png'
where slug = 'first-light';

update public.factions 
set rune_image_url = 'assets/img/Etched Power-S.png'
where slug = 'etched-power';

update public.factions 
set rune_image_url = 'assets/img/Tangled Weave-S.png'
where slug = 'tangled-weave';

update public.factions 
set rune_image_url = 'assets/img/Eternal Reach-S.png'
where slug = 'eternal-reach';

update public.factions 
set rune_image_url = 'assets/img/Hidden Truth-S.png'
where slug = 'hidden-truth';

update public.factions 
set rune_image_url = 'assets/img/Hollow End-S.png'
where slug = 'hollows-end';

-- Verify the changes
select slug, name, rune, rune_image_url from public.factions order by sort_order;