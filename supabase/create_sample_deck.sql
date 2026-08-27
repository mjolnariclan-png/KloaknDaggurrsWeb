-- ============================================================
-- Helper script to create a sample deck after cards exist
-- ============================================================
-- STEP 1: First, check what cards you have available:
-- select id, slug, name, rarity, card_type from public.cards order by id;

-- STEP 2: Then create your deck using this template:

-- Create the deck
insert into public.decks(slug, name, description, faction_slug, total_cards, is_active, image_url)
values
('ash-cycle-starter', 'Ash Cycle Starter Deck', 'A complete deck ready for play featuring the Ash Cycle faction.', 'ash-cycle', 0, true, 'assets/img/deck-ash-cycle.png')
on conflict(slug) do nothing;

-- Add cards to the deck (REPLACE the IDs with your actual card IDs from step 1)
do $$
declare
  v_deck_id bigint;
begin
  select id into v_deck_id from public.decks where slug = 'ash-cycle-starter';
  
  if v_deck_id is not null then
    -- Add your cards here - REPLACE these IDs with actual card IDs from your database
    -- Format: (deck_id, card_id, quantity)
    
    -- Example - replace these IDs with your actual card IDs:
    insert into public.deck_cards(deck_id, card_id, quantity) values
      (v_deck_id, 1, 2),  -- Replace 1 with actual card ID
      (v_deck_id, 2, 1),  -- Replace 2 with actual card ID  
      (v_deck_id, 3, 1)   -- Replace 3 with actual card ID
    on conflict do nothing;
    
    -- Update total cards count
    update public.decks
    set total_cards = (select coalesce(sum(quantity),0) from public.deck_cards where deck_id = v_deck_id)
    where id = v_deck_id;
    
    raise notice 'Deck created with ID: %', v_deck_id;
  end if;
end $$;

-- STEP 3: Create redemption codes for the deck
insert into public.deck_codes(code, deck_id)
values
  ('ASH-STARTER-001', (select id from public.decks where slug = 'ash-cycle-starter')),
  ('ASH-STARTER-002', (select id from public.decks where slug = 'ash-cycle-starter')),
  ('ASH-STARTER-003', (select id from public.decks where slug = 'ash-cycle-starter'))
on conflict(code) do nothing;

-- Verify your deck was created:
-- select * from public.decks where slug = 'ash-cycle-starter';
-- select * from public.deck_cards where deck_id = (select id from public.decks where slug = 'ash-cycle-starter');
-- select * from public.deck_codes where deck_id = (select id from public.decks where slug = 'ash-cycle-starter');