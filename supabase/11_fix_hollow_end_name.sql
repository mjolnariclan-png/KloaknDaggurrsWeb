-- ============================================================
-- The "Hollow End" image folder/manifest use singular naming, but
-- the seeded faction name was "Hollows End" (plural), which broke
-- every card image path for that faction. Align the DB to the
-- actual asset folder name. Slug is untouched (site links use it).
-- ============================================================
update public.factions
set name = 'Hollow End'
where slug = 'hollows-end';
