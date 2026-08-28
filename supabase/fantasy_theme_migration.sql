-- ============================================================
-- FANTASY THEME MIGRATION - Schema updates only
-- ============================================================
-- This script adds the columns needed for the fantasy theme
-- without touching existing data
-- ============================================================

-- Add number column to factions if it doesn't exist
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'factions' and column_name = 'number'
  ) then
    alter table public.factions add column number text;
  end if;
end $$;

-- Set default values for existing factions (only if column exists and values are null)
do $$
begin
  if exists (
    select 1 from information_schema.columns 
    where table_name = 'factions' and column_name = 'number'
  ) then
    update public.factions 
    set number = 'Book ' || row_num::text
    from (
      select id, row_number() over (order by sort_order) as row_num
      from public.factions
    ) numbered
    where public.factions.id = numbered.id and public.factions.number is null;
  end if;
end $$;

-- Add rune_image_url column to factions if it doesn't exist
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'factions' and column_name = 'rune_image_url'
  ) then
    alter table public.factions add column rune_image_url text;
  end if;
end $$;

-- Add short_name column to wars if it doesn't exist
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'wars' and column_name = 'short_name'
  ) then
    alter table public.wars add column short_name text;
    -- Set default values for existing wars
    update public.wars set short_name = title where short_name is null;
  end if;
end $$;

-- Verify the column additions
select 'Schema migration complete' as status,
       (select count(*) from information_schema.columns where table_name = 'factions' and column_name = 'number') as number_column,
       (select count(*) from information_schema.columns where table_name = 'factions' and column_name = 'rune_image_url') as rune_image_column,
       (select count(*) from information_schema.columns where table_name = 'wars' and column_name = 'short_name') as short_name_column;