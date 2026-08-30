-- ============================================================
-- Diagnose + fix cards stuck in "classified/locked" state.
-- sync-cards.js always sets revealed=true, so any revealed=false
-- rows are leftovers from before that (or manual test inserts).
-- ============================================================

-- 1) See how many cards are affected (run this first to confirm).
select revealed, count(*) from public.cards group by revealed;

-- 2) If step 1 shows revealed=false rows that shouldn't be locked,
--    reveal everything currently in the table.
update public.cards set revealed = true where revealed = false;
