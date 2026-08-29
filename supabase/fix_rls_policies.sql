-- ============================================================
-- FIX MISSING RLS POLICIES FOR FACTIONS AND WHISPERS
-- ============================================================

-- Add public read policy for factions
drop policy if exists "public read factions" on public.factions;
create policy "public read factions"
on public.factions for select to anon, authenticated
using (true);

-- Add public read policy for whispers
drop policy if exists "public read whispers" on public.whispers;
create policy "public read whispers"
on public.whispers for select to anon, authenticated
using (true);

-- Verify the policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies 
WHERE schemaname = 'public' 
AND tablename IN ('factions', 'whispers', 'cards', 'wars')
ORDER BY tablename, policyname;