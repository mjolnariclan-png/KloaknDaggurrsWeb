-- Fix war short_name values immediately
update public.wars set short_name = 'The Illumination' where slug = 'ash-vs-first';
update public.wars set short_name = 'The Desecration' where slug = 'crimson-vs-golden';
update public.wars set short_name = 'The Unraveling' where slug = 'etched-vs-tangled';
update public.wars set short_name = 'The Infiltration' where slug = 'eternal-vs-hidden';

-- Verify
select slug, title, short_name from public.wars;