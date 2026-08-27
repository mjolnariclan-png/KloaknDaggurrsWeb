-- ============================================================
-- COMPLETE DATABASE RESET - Replaces ALL data with JSON file data
-- ============================================================
-- WARNING: This will DELETE ALL existing data and replace it with
-- the current data from your site-data.json file
-- ============================================================

-- Delete all existing data
delete from public.wars;
delete from public.deck_codes;
delete from public.deck_cards;
delete from public.decks;
delete from public.user_decks;
delete from public.collections;
delete from public.vault_unlocks;
delete from public.vault_entries;
delete from public.cards;
delete from public.whispers;
delete from public.factions;

-- Reset sequences
alter sequence public.factions_id_seq restart with 1;
alter sequence public.cards_id_seq restart with 1;
alter sequence public.whispers_id_seq restart with 1;
alter sequence public.wars_id_seq restart with 1;

-- Add number column if it doesn't exist
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_name = 'factions' and column_name = 'number'
  ) then
    alter table public.factions add column number text;
  end if;
end $$;

-- Insert factions (matching your current JSON data)
insert into public.factions(slug, name, tagline, lore, doctrine, accent, revealed, reveal_at, sort_order, rune_image_url, number)
values
('ash-cycle', 'Ash Cycle', 'Fate is a loom, and every thread is a debt.', 'Named for the ash left behind when an old fate burns to make room for a new one, Ash Cycle is a faction of diviners, fate-brokers, and quiet manipulators. They play every side of a conflict at once — not out of chaos, but because they believe imbalance is what actually causes ruin. They release truth carefully, in threads, at the moment it will do the most good (or the most damage). They despise First Light''s instinct to burn the whole loom down for a moment of clarity.', 'Ash Cycle believes nothing happens by accident — every alliance, betrayal, and coincidence is a thread pulled taut by unseen hands. To act is to weave; to refuse is to be woven anyway. Better to hold the shuttle yourself than let another hold it for you.', '#9b57cb', true, null, 10, 'assets/img/Ash Cycle-S.svg', 'Tome I, Book I'),
('first-light', 'First Light', 'When the shadow retreats, some still prefer the dark.', 'Zealous illuminators, oracles, and purifiers, First Light tears down curtains other factions spent generations weaving. Many of their founders were themselves manipulated by Ash Cycle''s "necessary" secrets, and they''ve never forgiven it. To them, Ash Cycle''s slow-revealed truth is just another tyranny — deciding who deserves to see, and when.', 'First Light holds that truth is a right, not a privilege doled out by whoever profits from keeping it hidden. The sun doesn''t ask permission to rise — neither should revelation.', '#ffd700', true, null, 20, 'assets/img/First Light-S.svg', 'Tome I, Book II'),
('golden-flow', 'Golden Flow', 'Wealth has a blood price — someone always pays it.', 'Merchant princes, contract-brokers, and mercenary courts, Golden Flow rose out of the vacuum left when Crimson Oath''s throne fell. Where others saw a wound, Golden Flow saw a market — and they moved in fast, selling protection, loyalty, and stability itself to the highest bidder. To Crimson Oath, they''re vultures monetizing a grief that should have been honored, not sold.', 'Golden Flow believes value is the only true law. Anything can be measured, bought, or bled for, and power flows to whoever controls the exchange.', '#b58a42', false, null, 30, 'assets/img/Golden Flow-S.svg', 'Tome I, Book III'),
('crimson-oath', 'Crimson Oath', 'The empty throne remembers every hand that reached for it.', 'Knights, remnant loyalists, and oathbound dead, Crimson Oath guards the ruins of a fallen kingdom as though the king might still return. They see Golden Flow''s rise as a desecration — profit built on a grave that hasn''t even finished cooling. Where Golden Flow tries to replace the old order with commerce, Crimson Oath tries to resurrect it through bloodline, ritual, and war.', 'Crimson Oath believes sovereignty is sacred and unbroken — a throne claimed by blood and oath is never truly vacated, only waiting. Loyalty outlives death.', '#7794bf', false, null, 40, 'assets/img/Crimson Oath-S.svg', 'Tome I, Book IV'),
('etched-power', 'Etched Power', 'Strength carved in stone outlives the hand that carved it.', 'Rune-smiths, golem-forgers, and monument-builders, Etched Power constructs empires meant to survive the erosion of time itself. To them, permanence is victory. They see Tangled Weave''s obsession with connection as an admission of weakness — a refusal to ever stand alone and finished.', 'Etched Power believes true strength is permanent — written into the fabric of reality itself. Endure. Carve your will into existence. Let nothing erase what you have built.', '#8b4513', false, null, 50, 'assets/img/Etched Power-S.svg', 'Tome I, Book V'),
('tangled-weave', 'Tangled Weave', 'Every thread connects — pull one, and all of them move.', 'Web-cults, druidic network-mages, and saboteurs, Tangled Weave believes nothing carved in stone is truly finished — it''s just a node in a larger pattern, waiting for someone to find the thread that unravels it. They view Etched Power''s monuments not as strength, but as arrogance: a wall that forgot it was built on a web.', 'Tangled Weave sees the connections between all things. Nothing is isolated; everything influences everything else. Connect. Entangle. Use the web to control what cannot be seen directly.', '#4a90e2', false, null, 60, 'assets/img/Tangled Weave-S.svg', 'Tome I, Book VI'),
('eternal-reach', 'Eternal Reach', 'Beyond the horizon, there is always more.', 'Void-sailors, portal-mages, and ascension-seekers, Eternal Reach never stops moving outward. Their flaw, as Hidden Truth sees it, is that they conquer breadth and never depth — they map a thousand new worlds but never notice what''s hiding in the one they''re standing on.', 'Eternal Reach seeks what lies beyond the known. The horizon is not a limit, but an invitation. Expand. Explore. The boundary exists only to be crossed.', '#9370db', false, null, 70, 'assets/img/Eternal Reach-S.svg', 'Tome I, Book VII'),
('hidden-truth', 'Hidden Truth', 'What is seen is not what is.', 'Spies, illusionists, and inquisitors, Hidden Truth burrows where Eternal Reach expands. They exploit exactly what Eternal Reach ignores — the ground already beneath its feet — infiltrating its ever-growing empire because an explorer chasing the next horizon rarely looks behind them.', 'Hidden Truth knows perception is deception. The real truth lies beneath the surface, waiting to be uncovered. Observe. Analyze. Never accept the surface as the whole story.', '#2f4f4f', false, null, 80, 'assets/img/Hidden Truth-S.svg', 'Tome I, Book VIII'),
('hollows-end', 'Hollows End', 'All things must conclude. So must this.', 'Hollow End isn''t a ninth faction with its own rival — it''s the horizon line all eight of the others are, whether they admit it or not, walking toward. Reapers, entropy-elementals, and death-cult remnants make up its ranks, and its role in the game''s story is structural: it''s the faction that marks the end of the current series — not just a faction''s defeat, but the conclusion of everything this era of Klandestine has been building toward. Every war (Ash Cycle vs. First Light, Crimson Oath vs. Golden Flow, Etched Power vs. Tangled Weave, Eternal Reach vs. Hidden Truth) burns fuel that Hollow End eventually collects.', 'Hollow End represents the finality of all things. Every story has an ending, and every ending creates space for new beginnings. Accept. Conclude. Let the end be as meaningful as the beginning.', '#800080', false, null, 90, 'assets/img/Hollow End-S.svg', 'Tome I, The Sealed Rites');

-- Insert whispers
insert into public.whispers(title, body, published_at, classified, image_url)
values
('THE VEIL LIFTS', 'A signal has been received. Eight factions are moving, but only a few have chosen to reveal themselves.', '2026-08-26', false, null),
('ARCHIVE FRAGMENT 001', 'Two sigils have surfaced. The rest remain sealed. Do not mistake silence for absence.', '2026-08-29', true, null);

-- Insert wars
insert into public.wars(slug, faction1_slug, faction2_slug, title, description)
values
('ash-vs-first', 'ash-cycle', 'first-light', 'Control vs. Exposure', 'Ash Cycle believes truth must be released carefully or it burns the world; First Light believes withholding truth is the burn. Every First Light victory risks unraveling a fate Ash Cycle spent generations weaving; every Ash Cycle victory risks letting a lie live one day too long.'),
('crimson-vs-golden', 'crimson-oath', 'golden-flow', 'Legacy vs. Profit', 'Crimson Oath fights to resurrect what Golden Flow has turned into a marketplace. Golden Flow doesn''t hate Crimson Oath — they just see grief as a resource nobody''s collecting yet.'),
('etched-vs-tangled', 'etched-power', 'tangled-weave', 'Permanence vs. Connection', 'Etched Power builds to last forever alone; Tangled Weave insists nothing survives alone. Their war is fought in the gap between a monument and the vine that eventually grows through it.'),
('eternal-vs-hidden', 'eternal-reach', 'hidden-truth', 'Expansion vs. Depth', 'One always looks outward, one always looks under. Eternal Reach''s empire keeps growing faster than it can be defended from within — which is exactly the opening Hidden Truth needs.');

-- Insert vault entries
insert into public.vault_entries(code, title, teaser, body, status, reveal_at)
values
('KD-001', 'The First Signal', 'Initial transmission received from beyond the Veil.', 'The signal contains coordinates and patterns that suggest intelligent design. The origin remains classified.', 'open', null),
('KD-013', 'Shadow Protocol', 'What happens when the watchers become the watched.', 'Some secrets are too dangerous to be known, even by those who guard them. This protocol outlines the containment procedures for such knowledge.', 'open', null),
('KD-404', 'The Lost Archives', 'Records that were never meant to be found.', 'Contains fragments of conversations, intercepted transmissions, and incomplete schematics that suggest a larger organization operating in the shadows.', 'open', null);

-- Verify the reset
select 'FACTIONS' as table_name, count(*) as records from public.factions
union all select 'WHISPERS', count(*) from public.whispers
union all select 'WARS', count(*) from public.wars
union all select 'VAULT_ENTRIES', count(*) from public.vault_entries
union all select 'CARDS', count(*) from public.cards
union all select 'COLLECTIONS', count(*) from public.collections
union all select 'USER_DECKS', count(*) from public.user_decks;