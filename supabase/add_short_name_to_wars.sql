-- ============================================================
-- Add short_name column to existing wars table
-- ============================================================

-- Add the short_name column if it doesn't exist
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'wars' and column_name = 'short_name'
  ) then
    alter table public.wars add column short_name text;
  end if;
end $$;

-- Set default short_name to title for existing wars
update public.wars set short_name = title where short_name is null;

-- Now set your custom short names
update public.wars set short_name = 'The Illumination' where slug = 'ash-vs-first';
update public.wars set short_name = 'The Desecration' where slug = 'crimson-vs-golden';
update public.wars set short_name = 'The Unraveling' where slug = 'etched-vs-tangled';
update public.wars set short_name = 'The Infiltration' where slug = 'eternal-vs-hidden';

-- Verify the changes
select slug, title, short_name from public.wars;