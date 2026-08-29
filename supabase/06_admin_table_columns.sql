-- ============================================================
-- Lets the admin Command Center build its edit forms directly from
-- the live table schema, so adding/removing/renaming a column in
-- public.cards or public.factions updates the admin UI automatically.
-- Run once in Supabase SQL Editor.
-- ============================================================
create or replace function public.admin_table_columns(p_table text)
returns table(column_name text, data_type text, is_nullable boolean, ordinal_position int)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  return query
  select c.column_name::text, c.data_type::text, (c.is_nullable = 'YES'), c.ordinal_position::int
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = p_table
  order by c.ordinal_position;
end;
$$;

revoke all on function public.admin_table_columns(text) from public;
grant execute on function public.admin_table_columns(text) to authenticated;
