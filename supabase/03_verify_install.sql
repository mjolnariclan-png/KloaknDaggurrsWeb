select 'profiles' table_name, count(*) rows from public.profiles
union all select 'factions', count(*) from public.factions
union all select 'cards', count(*) from public.cards
union all select 'whispers', count(*) from public.whispers
union all select 'vault_entries', count(*) from public.vault_entries;

select * from public.public_factions order by sort_order;
select * from public.public_cards order by sort_order limit 10;
