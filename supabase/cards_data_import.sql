-- ============================================================
-- SAMPLE CARD DATA IMPORT
-- ============================================================
-- This is sample data to test the Arsenal system
-- Full manifest import will be done separately
-- ============================================================

-- Delete existing sample data first
delete from public.cards where faction_slug = 'ash-cycle';

-- Insert sample Vigor cards (no image_url - will use mapping system)
insert into public.cards(name, card_number, set_name, faction_slug, type, rarity, vigor_type, vigor_cost, revealed, sort_order)
values
('Warpbinder', '1/147', 'Ash Cycle', 'ash-cycle', 'Vigor', null, 'Chaos', null, true, 1),
('Wealthbinder', '2/147', 'Ash Cycle', 'ash-cycle', 'Vigor', null, 'Greed', null, true, 2),
('Flamebeast', '3/147', 'Ash Cycle', 'ash-cycle', 'Vigor', null, 'Lava', null, true, 3);

-- Insert sample Creature cards (matching your actual file structure)
insert into public.cards(name, card_number, set_name, faction_slug, type, rarity, vigor_type, class_name, ap, dp, mana_card_cost, strength_vigor, weakness_vigor, attacks, revealed, sort_order)
values
('Bromunt', '10/147', 'Ash Cycle', 'ash-cycle', 'Creature', 'Thrall', 'Chaos', 'Barbarian', 8, 8, 8, 'Purity', 'Sun', '[{"name":"Chaos Strike","description":"Attacks opponent 2 damage","manaCost":"4"}]', true, 10);

-- Insert sample Creature cards
insert into public.cards(name, card_number, set_name, faction_slug, type, rarity, vigor_type, class_name, ap, dp, mana_card_cost, strength_vigor, weakness_vigor, attacks, revealed, sort_order)
values
('Tirk', '8/147', 'Ash Cycle', 'ash-cycle', 'Creature', 'Thrall', 'Greed', 'Rogue', 4, 1, 1, 'Spirit', 'Purity', '[{"name":"Galactic Graviton","description":"Reflects opponent spell","manaCost":"6"},{"name":"Authentic Beaver","description":"Conjures authentic beaver, removes extras","manaCost":"1"}]', true, 8),
('Galadrielleth', '9/147', 'Ash Cycle', 'ash-cycle', 'Creature', 'Thrall', 'Chaos', 'Barbarian', 10, 10, 10, 'Purity', 'Sun', '[{"name":"Elemental Stab","description":"Attacks flying 1 round","manaCost":"3"},{"name":"Twilight Strike","description":"Attacks opponent 3 damage","manaCost":"4"}]', true, 9),
('Bromunt', '10/147', 'Ash Cycle', 'ash-cycle', 'Creature', 'Thrall', 'Chaos', 'Barbarian', 8, 8, 8, 'Purity', 'Sun', '[{"name":"Chaos Strike","description":"Attacks opponent 2 damage","manaCost":"4"}]', true, 10);

-- Insert sample Accoutrements cards
insert into public.cards(name, card_number, set_name, faction_slug, type, rarity, vigor_type, vigor_cost, equipment_type, attack_description, revealed, sort_order)
values
('Shield Wall', '108/147', 'Ash Cycle', 'ash-cycle', 'Accoutrements', 'Thrall', 'Chaos', 2, 'Shields', 'Form a shield wall with allies, providing cover and reducing damage taken by 10 hit points.', true, 108);

-- Insert sample Runes cards
insert into public.cards(name, card_number, set_name, faction_slug, type, rarity, vigor_type, vigor_cost, attack_name, attack_description, revealed, sort_order)
values
('Charge', '131/147', 'Ash Cycle', 'ash-cycle', 'Runes', 'Thrall', 'Greed', 7, 'Charge', 'Rush towards the enemy with great force, dealing 20 hit points of damage upon impact.', true, 131);

-- Insert sample Primordial cards
insert into public.cards(name, card_number, set_name, faction_slug, type, rarity, vigor_type, class_name, ap, dp, mana_card_cost, strength_vigor, weakness_vigor, attacks, revealed, sort_order)
values
('Alariana', '143/147', 'Ash Cycle', 'ash-cycle', 'Primordial Being', 'Konugr', 'Spirit', 'Primordial', 14, 12, 15, 'Sorcery', 'Tar', '[{"name":"Twilight Offering","description":"Summon a 5/5 Shadow Wraith token with Lifesteal.","manaCost":"19"},{"name":"Blood Pact","description":"Gain 10 life for each sacrificed creature with more than 15 health.","manaCost":"14"}]', true, 143);

-- Verify import
select type, rarity, count(*) as card_count from public.cards group by type, rarity order by type, rarity;