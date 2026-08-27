-- ============================================================
-- Update factions with new lore, doctrine, and taglines
-- ============================================================

-- Update Ash Cycle
update public.factions 
set 
  tagline = 'Fate is a loom, and every thread is a debt.',
  lore = 'Named for the ash left behind when an old fate burns to make room for a new one, Ash Cycle is a faction of diviners, fate-brokers, and quiet manipulators. They play every side of a conflict at once — not out of chaos, but because they believe imbalance is what actually causes ruin. They release truth carefully, in threads, at the moment it will do the most good (or the most damage). They despise First Light''s instinct to burn the whole loom down for a moment of clarity.',
  doctrine = 'Ash Cycle believes nothing happens by accident — every alliance, betrayal, and coincidence is a thread pulled taut by unseen hands. To act is to weave; to refuse is to be woven anyway. Better to hold the shuttle yourself than let another hold it for you.'
where slug = 'ash-cycle';

-- Update First Light
update public.factions 
set 
  tagline = 'When the shadow retreats, some still prefer the dark.',
  lore = 'Zealous illuminators, oracles, and purifiers, First Light tears down curtains other factions spent generations weaving. Many of their founders were themselves manipulated by Ash Cycle''s "necessary" secrets, and they''ve never forgiven it. To them, Ash Cycle''s slow-revealed truth is just another tyranny — deciding who deserves to see, and when.',
  doctrine = 'First Light holds that truth is a right, not a privilege doled out by whoever profits from keeping it hidden. The sun doesn''t ask permission to rise — neither should revelation.'
where slug = 'first-light';

-- Update Golden Flow
update public.factions 
set 
  tagline = 'Wealth has a blood price — someone always pays it.',
  lore = 'Merchant princes, contract-brokers, and mercenary courts, Golden Flow rose out of the vacuum left when Crimson Oath''s throne fell. Where others saw a wound, Golden Flow saw a market — and they moved in fast, selling protection, loyalty, and stability itself to the highest bidder. To Crimson Oath, they''re vultures monetizing a grief that should have been honored, not sold.',
  doctrine = 'Golden Flow believes value is the only true law. Anything can be measured, bought, or bled for, and power flows to whoever controls the exchange.'
where slug = 'golden-flow';

-- Update Crimson Oath
update public.factions 
set 
  tagline = 'The empty throne remembers every hand that reached for it.',
  lore = 'Knights, remnant loyalists, and oathbound dead, Crimson Oath guards the ruins of a fallen kingdom as though the king might still return. They see Golden Flow''s rise as a desecration — profit built on a grave that hasn''t even finished cooling. Where Golden Flow tries to replace the old order with commerce, Crimson Oath tries to resurrect it through bloodline, ritual, and war.',
  doctrine = 'Crimson Oath believes sovereignty is sacred and unbroken — a throne claimed by blood and oath is never truly vacated, only waiting. Loyalty outlives death.'
where slug = 'crimson-oath';

-- Update Etched Power
update public.factions 
set 
  tagline = 'Strength carved in stone outlives the hand that carved it.',
  lore = 'Rune-smiths, golem-forgers, and monument-builders, Etched Power constructs empires meant to survive the erosion of time itself. To them, permanence is victory. They see Tangled Weave''s obsession with connection as an admission of weakness — a refusal to ever stand alone and finished.',
  doctrine = 'Etched Power believes true strength is permanent — written into the fabric of reality itself. Endure. Carve your will into existence. Let nothing erase what you have built.'
where slug = 'etched-power';

-- Update Tangled Weave
update public.factions 
set 
  tagline = 'Every thread connects — pull one, and all of them move.',
  lore = 'Web-cults, druidic network-mages, and saboteurs, Tangled Weave believes nothing carved in stone is truly finished — it''s just a node in a larger pattern, waiting for someone to find the thread that unravels it. They view Etched Power''s monuments not as strength, but as arrogance: a wall that forgot it was built on a web.',
  doctrine = 'Tangled Weave sees the connections between all things. Nothing is isolated; everything influences everything else. Connect. Entangle. Use the web to control what cannot be seen directly.'
where slug = 'tangled-weave';

-- Update Eternal Reach
update public.factions 
set 
  tagline = 'Beyond the horizon, there is always more.',
  lore = 'Void-sailors, portal-mages, and ascension-seekers, Eternal Reach never stops moving outward. Their flaw, as Hidden Truth sees it, is that they conquer breadth and never depth — they map a thousand new worlds but never notice what''s hiding in the one they''re standing on.',
  doctrine = 'Eternal Reach seeks what lies beyond the known. The horizon is not a limit, but an invitation. Expand. Explore. The boundary exists only to be crossed.'
where slug = 'eternal-reach';

-- Update Hidden Truth
update public.factions 
set 
  tagline = 'What is seen is not what is.',
  lore = 'Spies, illusionists, and inquisitors, Hidden Truth burrows where Eternal Reach expands. They exploit exactly what Eternal Reach ignores — the ground already beneath its feet — infiltrating its ever-growing empire because an explorer chasing the next horizon rarely looks behind them.',
  doctrine = 'Hidden Truth knows perception is deception. The real truth lies beneath the surface, waiting to be uncovered. Observe. Analyze. Never accept the surface as the whole story.'
where slug = 'hidden-truth';

-- Update Hollow End
update public.factions 
set 
  tagline = 'All things must conclude. So must this.',
  lore = 'Hollow End isn''t a ninth faction with its own rival — it''s the horizon line all eight of the others are, whether they admit it or not, walking toward. Reapers, entropy-elementals, and death-cult remnants make up its ranks, and its role in the game''s story is structural: it''s the faction that marks the end of the current series — not just a faction''s defeat, but the conclusion of everything this era of Klandestine has been building toward. Every war (Ash Cycle vs. First Light, Crimson Oath vs. Golden Flow, Etched Power vs. Tangled Weave, Eternal Reach vs. Hidden Truth) burns fuel that Hollow End eventually collects.',
  doctrine = 'Hollow End represents the finality of all things. Every story has an ending, and every ending creates space for new beginnings. Accept. Conclude. Let the end be as meaningful as the beginning.'
where slug = 'hollows-end';

-- Verify updates
select slug, name, tagline from public.factions order by sort_order;