-- ============================================================
-- Update database factions to match the JSON file changes
-- ============================================================

-- Step 1: Update existing faction names and reveal status
update public.factions 
set 
  name = 'Golden Flow',
  revealed = false
where slug = 'fehu';

update public.factions 
set 
  name = 'Crimson Oath', 
  revealed = false
where slug = 'godrin';

update public.factions 
set 
  name = 'Ash Cycle',
  revealed = true
where slug = 'braided';

-- Step 2: Insert First Light (new faction)
insert into public.factions(slug, name, rune, tagline, lore, doctrine, accent, revealed, sort_order)
values
('first-light', 'First Light', '☀', 'Dawn reveals what darkness hid.', 'First Light emerges when the shadows retreat. Truth becomes visible, but not everyone is ready to see it.', 'Illuminate. Expose. Guide others toward the revelation they fear but need.', '#ffd700', true, 40)
on conflict(slug) do update set
  name = 'First Light',
  rune = '☀',
  tagline = 'Dawn reveals what darkness hid.',
  lore = 'First Light emerges when the shadows retreat. Truth becomes visible, but not everyone is ready to see it.',
  doctrine = 'Illuminate. Expose. Guide others toward the revelation they fear but need.',
  accent = '#ffd700',
  revealed = true;

-- Step 3: Add the remaining new factions
insert into public.factions(slug, name, rune, tagline, lore, doctrine, accent, revealed, sort_order)
values 
  ('etched-power', 'Etched Power', '⚡', 'Strength carved in stone.', 'Etched Power believes that true strength is permanent, written into the fabric of reality itself.', 'Endure. Carve your will into existence. Let nothing erase what you have built.', '#8b4513', false, 50),
  ('tangled-weave', 'Tangled Weave', '🕸', 'Every thread connects.', 'Tangled Weave sees the connections between all things. Nothing is isolated; everything influences everything else.', 'Connect. Entangle. Use the web to control what cannot be seen directly.', '#4a90e2', false, 60),
  ('eternal-reach', 'Eternal Reach', '🌌', 'Beyond the horizon lies more.', 'Eternal Reach seeks what lies beyond the known. The horizon is not a limit, but an invitation.', 'Expand. Explore. The boundary exists only to be crossed.', '#9370db', false, 70),
  ('hidden-truth', 'Hidden Truth', '👁', 'What is seen is not what is.', 'Hidden Truth knows that perception is deception. The real truth lies beneath the surface, waiting to be uncovered.', 'Observe. Analyze. Never accept the surface as the whole story.', '#2f4f4f', false, 80),
  ('hollows-end', 'Hollows End', '🌀', 'All things must conclude.', 'Hollows End represents the finality of all things. Every story has an ending, and every ending creates space for new beginnings.', 'Accept. Conclude. Let the end be as meaningful as the beginning.', '#800080', false, 90)
on conflict(slug) do nothing;

-- Step 4: Remove old classified factions (04-13)
delete from public.factions where slug like 'classified-%';

-- Step 5: Update faction slugs for the renamed ones
update public.factions set slug = 'golden-flow' where slug = 'fehu';
update public.factions set slug = 'crimson-oath' where slug = 'godrin';
update public.factions set slug = 'ash-cycle' where slug = 'braided';

-- Step 6: Update card slugs and card types/rarities
update public.cards 
set 
  slug = 'golden-flow-blood-price',
  rarity = 'Karls',
  card_type = 'Runes',
  revealed = false
where slug = 'fehu-blood-price';

update public.cards 
set 
  slug = 'crimson-oath-empty-throne',
  rarity = 'Jarls',
  card_type = 'Primordials',
  revealed = false
where slug = 'godrin-empty-throne';

update public.cards 
set 
  slug = 'ash-cycle-loose-thread',
  rarity = 'Skilled',
  card_type = 'Runes',
  revealed = true
where slug = 'braided-loose-thread';

-- Step 7: Update card faction_id references
update public.cards 
set faction_id = (select id from public.factions where slug = 'golden-flow')
where slug = 'golden-flow-blood-price';

update public.cards 
set faction_id = (select id from public.factions where slug = 'crimson-oath')
where slug = 'crimson-oath-empty-throne';

update public.cards 
set faction_id = (select id from public.factions where slug = 'ash-cycle')
where slug = 'ash-cycle-loose-thread';

-- Step 8: Update classified cards to use new card types and rarities
update public.cards 
set 
  rarity = 'Jarls',
  card_type = 'Creatures'
where rarity = 'Mythic' and card_type = 'Reaction';

update public.cards 
set 
  rarity = 'Konugr',
  card_type = 'Accoutrements'
where rarity = 'Gold' and card_type = 'Relic';

update public.cards 
set 
  rarity = 'Thrall',
  card_type = 'Creatures'
where rarity = 'Common' and card_type = 'Action';

update public.cards 
set 
  rarity = 'Skilled',
  card_type = 'Runes'
where rarity = 'Uncommon' and card_type = 'Kloak';

update public.cards 
set 
  rarity = 'Karls',
  card_type = 'Primordials'
where rarity = 'Rare' and card_type = 'Faction';

-- Step 9: Update any remaining cards with new types
update public.cards set card_type = 'Vigor' where card_type = 'Action';
update public.cards set card_type = 'Accoutrements' where card_type = 'Relic';
update public.cards set card_type = 'Runes' where card_type = 'Kloak';
update public.cards set card_type = 'Creatures' where card_type = 'Reaction';
update public.cards set card_type = 'Primordials' where card_type = 'Faction';

-- Step 10: Update any remaining rarities
update public.cards set rarity = 'Thrall' where rarity = 'Common';
update public.cards set rarity = 'Skilled' where rarity = 'Uncommon';
update public.cards set rarity = 'Karls' where rarity = 'Rare';
update public.cards set rarity = 'Jarls' where rarity = 'Mythic';
update public.cards set rarity = 'Konugr' where rarity = 'Gold';

-- Verify the changes
select 'Total factions' as check, count(*) as count from public.factions
union all
select 'Total cards', count(*) from public.cards
union all
select 'Revealed factions', count(*) from public.factions where revealed = true
union all
select 'Revealed cards', count(*) from public.cards where revealed = true;