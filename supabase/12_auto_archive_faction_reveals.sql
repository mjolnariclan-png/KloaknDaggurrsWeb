-- ============================================================
-- Auto-logs major faction reveals into The Archive (vault_entries).
-- If the same reveal event fires again (same faction slug), the
-- newest data wins via ON CONFLICT DO UPDATE — it never blocks or
-- errors out, it just lets the new write take priority.
-- Run once in Supabase SQL Editor.
-- ============================================================
create or replace function public.log_faction_reveal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'UPDATE' and new.revealed = true and coalesce(old.revealed,false) = false) then
    insert into public.vault_entries(code,title,teaser,body,status)
    values (
      'reveal-' || new.slug,
      'THE VEIL LIFTS: ' || new.name,
      'A new faction has stepped into the light.',
      new.name || ' has been revealed. ' || coalesce(new.tagline,''),
      'open'
    )
    on conflict (code) do update
      set title = excluded.title,
          teaser = excluded.teaser,
          body = excluded.body,
          status = 'open';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_faction_reveal on public.factions;
create trigger trg_log_faction_reveal
after update on public.factions
for each row
execute function public.log_faction_reveal();
