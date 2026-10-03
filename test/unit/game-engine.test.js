'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const engine = require('../../lib/game-engine');

const U = {
  A: 'user-aaaaaaaa',
  B: 'user-bbbbbbbb',
};

function creature(name, attack, defense, extra = {}) {
  return { type: 'creature', name, cost: 1, attack, defense, canAttack: true, hasHaste: false, ...extra };
}
function vigor() {
  return { type: 'vigor', name: 'Vigor', cost: 0, attack: 0, defense: 0 };
}
function primordial(name = 'King', attack = 10, defense = 10) {
  return { type: 'primordial', name, cost: 5, attack, defense, canAttack: false };
}

/**
 * Build a game in a controlled state.
 * Decks are built with the Primordial FIRST in the array — createGame draws
 * with pop() from the END, so the king stays in the deck unless deployKing
 * is used. `aBattle`/`bBattle` replace each battlefield but keep deployed
 * Vigor cards (mana source).
 */
function makeGame({ aBattle = null, bBattle = null, aHand = null, bHand = null, aDeck = null, bDeck = null, phase = 'play', deployKingA = true, deployKingB = true, kingA = null, kingB = null } = {}) {
  const deckA = aDeck !== null ? aDeck : [primordial('KingA'), creature('FillerA', 1, 1), ...Array(24).fill(0).map(() => vigor()), ...(aHand || [])];
  const deckB = bDeck !== null ? bDeck : [primordial('KingB'), creature('FillerB', 1, 1), ...Array(24).fill(0).map(() => vigor()), ...(bHand || [])];
  const game = engine.createGame({
    id: 'game_test',
    firstPlayerIndex: 0,
    players: [
      { id: U.A, name: 'Alpha', deck: deckA },
      { id: U.B, name: 'Bravo', deck: deckB },
    ],
  });
  game.phase = phase;

  const setupPlayer = (p, battle, hand, deployKing, kingSpec) => {
    if (battle !== null) {
      const keepVigor = p.battlefield.filter((c) => c.type === 'vigor');
      p.battlefield = [...battle, ...keepVigor];
    }
    if (hand !== null) p.hand = [...hand];
    if (deployKing) {
      // King deploys to the battlefield (Command Zone) and leaves the deck.
      p.deck = p.deck.filter((c) => c.type !== 'primordial');
      p.battlefield = p.battlefield.filter((c) => c.type !== 'primordial');
      const king = typeof kingSpec === 'object' ? { ...kingSpec, canAttack: false } : primordial(kingSpec);
      p.battlefield.push(king);
    } else {
      // King remains in the deck (not yet drawn).
      const hasKing = p.deck.some((c) => c.type === 'primordial') || p.battlefield.some((c) => c.type === 'primordial');
      if (!hasKing) p.deck.unshift(typeof kingSpec === 'object' ? { ...kingSpec, canAttack: false } : primordial(kingSpec));
    }
  };

  setupPlayer(game.players[0], aBattle, aHand, deployKingA, kingA || 'KingA');
  setupPlayer(game.players[1], bBattle, bHand, deployKingB, kingB || 'KingB');
  game.version = 1;
  return game;
}

test('starting hands: 7 cards drawn, mana only from deployed Vigor cards, no free mana', () => {
  const game = engine.createGame({
    id: 'g1',
    firstPlayerIndex: 0,
    players: [
      { id: U.A, name: 'A', deck: [primordial(), ...Array(59).fill(0).map((_, i) => (i % 2 ? creature(`c${i}`, 2, 2) : vigor()))] },
      { id: U.B, name: 'B', deck: [primordial(), ...Array(59).fill(0).map((_, i) => (i % 2 ? creature(`d${i}`, 2, 2) : vigor()))] },
    ],
  });
  const a = game.players[0];
  const vigorOnField = a.battlefield.filter((c) => c.type === 'vigor').length;
  // Seven cards were consumed from the deck into hand/battlefield.
  assert.equal(a.hand.length + vigorOnField, 7);
  // Mana equals the number of Vigor (mana) cards deployed — no automatic mana.
  assert.equal(a.mana, vigorOnField);
  assert.equal(a.vigorUsedThisTurn, 0);
  // Every player's Primordial is in the deck or on the battlefield.
  for (const p of game.players) {
    assert.ok(
      p.deck.some((c) => c.type === 'primordial') || p.battlefield.some((c) => c.type === 'primordial'),
      'primordial must exist in deck or play'
    );
  }
  assert.equal(game.phase, 'vigor');
  assert.equal(game.status, 'active');
});

test('mana comes from vigor cards and is capped at 20', () => {
  const game = makeGame({});
  const a = game.players[0];
  a.battlefield = [...Array(25).fill(0).map(() => vigor())];
  a.vigorUsedThisTurn = 0;
  assert.equal(engine.availableMana(a), 20);
  a.vigorUsedThisTurn = 3;
  assert.equal(engine.availableMana(a), 17);
});

test('cards costing over 15 are rejected', () => {
  const game = makeGame({ aHand: [{ type: 'creature', name: 'Expensive', cost: 16, attack: 9, defense: 9 }], phase: 'play' });
  const r = engine.playCard(game, U.A, 0);
  assert.ok(!r.ok);
  assert.match(r.error, /maximum of 15/);
});

test('playing a creature costs mana and fills the battlefield', () => {
  const game = makeGame({ aHand: [creature('Bear', 3, 3)] });
  game.players[0].battlefield.push(vigor(), vigor());
  game.players[0].vigorUsedThisTurn = 0;
  const r = engine.playCard(game, U.A, 0);
  assert.ok(r.ok, r.error);
  assert.equal(game.players[0].battlefield.filter((c) => c.type === 'creature').length, 1);
  assert.equal(game.players[0].vigorUsedThisTurn, 1);
});

test('creature limit of 5 is enforced', () => {
  const game = makeGame({});
  const a = game.players[0];
  for (let i = 0; i < 5; i++) a.battlefield.push(creature(`x${i}`, 1, 1));
  a.hand = [creature('Overflow', 1, 1)];
  a.vigorUsedThisTurn = 0;
  const r = engine.playCard(game, U.A, 0);
  assert.ok(!r.ok);
  assert.match(r.error, /Maximum 5 creatures/);
});

test('not your turn: rejected', () => {
  const game = makeGame({});
  const r = engine.playCard(game, U.B, 0);
  assert.ok(!r.ok);
  assert.match(r.error, /Not your turn/);
});

test('combat is simultaneous: both units can die in one attack', () => {
  const game = makeGame({
    aBattle: [creature('Attacker', 5, 2)],
    kingB: primordial('KingB', 3, 3),
    phase: 'attack',
  });
  const kingIdx = game.players[1].battlefield.findIndex((c) => c.type === 'primordial');
  const r = engine.attack(game, U.A, 0, kingIdx, false);
  assert.ok(r.ok, r.error);
  // Attacker took 3 damage (defense 2 -> -1, dead); king took 5 (defense 3 -> -2, dead).
  assert.equal(game.players[0].battlefield.some((c) => c.name === 'Attacker'), false);
  assert.equal(game.players[1].battlefield.some((c) => c.type === 'primordial'), false);
  // King death ends the game immediately in the attacker's favor.
  assert.equal(game.status, 'completed');
  assert.equal(game.winner, U.A);
  assert.equal(game.result, 'primordial');
});

test('attacker dying does NOT stop combat resolution — remaining attacks still work', () => {
  const game = makeGame({
    aBattle: [creature('Suicider', 2, 1), creature('Survivor', 4, 4)],
    kingB: primordial('KingB', 10, 10),
    phase: 'attack',
  });
  // First attacker dies in combat; king survives (10-2=8).
  let kingIdx = game.players[1].battlefield.findIndex((c) => c.type === 'primordial');
  let r = engine.attack(game, U.A, 0, kingIdx, false);
  assert.ok(r.ok, r.error);
  assert.equal(game.players[0].battlefield.some((c) => c.name === 'Suicider'), false);
  assert.equal(game.status, 'active');
  // The phase continues: the second attacker can still act (the known bug).
  const survivorIdx = game.players[0].battlefield.findIndex((c) => c.name === 'Survivor');
  kingIdx = game.players[1].battlefield.findIndex((c) => c.type === 'primordial');
  r = engine.attack(game, U.A, survivorIdx, kingIdx, false);
  assert.ok(r.ok, 'second attack after an attacker death must resolve');
  // King: 8-4=4 defense, alive; Survivor: 4-10 dead.
  assert.equal(game.players[1].battlefield.some((c) => c.type === 'primordial'), true);
  assert.equal(game.players[0].battlefield.some((c) => c.name === 'Survivor'), false);
  assert.equal(game.status, 'active');
});

test('a unit can only attack once per attack phase (canAttack cleared)', () => {
  const game = makeGame({
    aBattle: [creature('Once', 1, 15)],
    kingB: primordial('KingB', 10, 10),
    phase: 'attack',
  });
  const kingIdx = game.players[1].battlefield.findIndex((c) => c.type === 'primordial');
  let r = engine.attack(game, U.A, 0, kingIdx, false);
  assert.ok(r.ok, r.error);
  // Immediate duplicate (double-click / replay): same attacker, same target.
  const attackerIdx = game.players[0].battlefield.findIndex((c) => c.name === 'Once');
  r = engine.attack(game, U.A, attackerIdx, kingIdx, false);
  assert.ok(!r.ok);
  assert.match(r.error, /summoning sickness/);
});

test('must attack primordial first, then creatures, then player', () => {
  const game = makeGame({
    aBattle: [creature('Guy', 5, 5)],
    bBattle: [creature('Guard', 2, 2)], // + helper-deployed KingB
    phase: 'attack',
  });
  const guardIdx = game.players[1].battlefield.findIndex((c) => c.name === 'Guard');
  const kingIdx = game.players[1].battlefield.findIndex((c) => c.type === 'primordial');
  let r = engine.attack(game, U.A, 0, guardIdx, false); // targeting Guard while King lives
  assert.ok(!r.ok); assert.match(r.error, /Primordial first/);
  r = engine.attack(game, U.A, 0, null, true); // going face while King lives
  assert.ok(!r.ok); assert.match(r.error, /Primordial first/);
  r = engine.attack(game, U.A, 0, kingIdx, false); // attacking the King works
  assert.ok(r.ok, r.error);
});

test('primordial death wins the game', () => {
  const game = makeGame({
    aBattle: [creature('Slayer', 20, 20)],
    kingB: primordial('FrailKing', 10, 5),
    phase: 'attack',
  });
  const kingIdx = game.players[1].battlefield.findIndex((c) => c.type === 'primordial');
  const r = engine.attack(game, U.A, 0, kingIdx, false);
  assert.ok(r.ok);
  assert.equal(game.status, 'completed');
  assert.equal(game.winner, U.A);
  assert.equal(game.result, 'primordial');
});

test('life loss wins the game', () => {
  const game = makeGame({
    aBattle: [creature('Sprinter', 30, 30)],
    bBattle: [],
    deployKingB: false, // B's Primordial is still in their deck — face attacks allowed
    phase: 'attack',
  });
  const r = engine.attack(game, U.A, 0, null, true); // direct attack, no blockers
  assert.ok(r.ok, r.error);
  assert.equal(game.status, 'completed');
  assert.equal(game.winner, U.A);
  assert.equal(game.result, 'lifeloss');
});

test('deck-out on the draw phase loses the game', () => {
  const game = makeGame({ aDeck: [], bDeck: [] });
  game.phase = 'vigor';
  game.players[0].hand = [];
  game.players[0].deck = [];
  const r = engine.advancePhase(game, U.A); // vigor -> draw: must draw, deck empty
  assert.ok(r.ok);
  assert.equal(game.status, 'completed');
  assert.equal(game.winner, U.B);
  assert.equal(game.result, 'deckout');
});

test('5 consecutive no-play turns loses the game', () => {
  const game = makeGame({ phase: 'attack' });
  // Every player just presses "End Phase" through their turns without ever
  // playing a card. Alpha (index 0, current) ends their turn first, so Alpha
  // hits 5 no-play turns one turn before Bravo.
  for (let i = 0; i < 60 && game.status === 'active'; i++) {
    const current = game.players[game.currentTurn].id;
    const r = engine.advancePhase(game, current);
    assert.ok(r.ok, r.error);
  }
  assert.equal(game.status, 'completed');
  assert.equal(game.result, 'noplay');
  assert.equal(game.winner, U.B);
});

test('surrender immediately ends the game with the other player as winner', () => {
  const game = makeGame({});
  const r = engine.surrender(game, U.A);
  assert.ok(r.ok);
  assert.equal(game.status, 'completed');
  assert.equal(game.winner, U.B);
  assert.equal(game.result, 'surrender');
});

test('actions after completion are rejected (no zombie matches)', () => {
  const game = makeGame({});
  engine.surrender(game, U.A);
  const r = engine.playCard(game, U.A, 0);
  assert.ok(!r.ok);
  assert.match(r.error, /already finished/);
});

test('out-of-range attack indexes are rejected, never crash', () => {
  const game = makeGame({
    aBattle: [creature('A', 1, 1)],
    bBattle: [],
    deployKingB: false,
    phase: 'attack',
  });
  let r = engine.attack(game, U.A, 99, 0, false);
  assert.ok(!r.ok); assert.match(r.error, /Attacker not found/);
  r = engine.attack(game, U.A, 0, 99, false); // no blockers: must target the player
  assert.ok(!r.ok);
  assert.ok(engine.attack(game, U.A, 0, null, true).ok);
});

test('runes deal damage to the opponent and leave the hand', () => {
  const game = makeGame({ aHand: [{ type: 'rune', name: 'Zap', cost: 2, attack: 0, defense: 0 }] });
  game.players[0].battlefield.push(vigor(), vigor());
  game.players[0].vigorUsedThisTurn = 0;
  const lifeBefore = game.players[1].life;
  const r = engine.playCard(game, U.A, 0);
  assert.ok(r.ok, r.error);
  assert.ok(game.players[1].life < lifeBefore);
  assert.equal(game.players[0].hand.length, 0);
});

test('sanitize hides the opponent hand/deck but keeps battlefield visible', () => {
  const game = makeGame({ aHand: [creature('SecretA', 1, 1)], bHand: [creature('SecretB', 1, 1)] });
  assert.ok(game.players[1].hand.length > 0, 'B must hold a card for this test');
  const view = engine.sanitize(game, U.A);
  const mine = view.players[0];
  const opp = view.players[1];
  assert.ok(opp.hand.every((c) => c.type === 'hidden'));
  assert.ok(opp.deck.every((c) => c.type === 'hidden'));
  assert.ok(mine.deck.every((c) => c.type === 'hidden'));
  assert.ok(!mine.hand.some((c) => c.type === 'hidden'));
  assert.equal(opp.lastSeen, undefined);
  // The real card objects are untouched (deep copy).
  assert.notEqual(game.players[1].hand[0], opp.hand[0]);
  assert.equal(game.players[1].hand[0].name, 'SecretB');
});

test('every mutation bumps the version (stale-client detection)', () => {
  const game = makeGame({ aHand: [creature('Bear', 2, 2)] });
  game.players[0].battlefield.push(vigor(), vigor());
  const v0 = game.version;
  assert.ok(engine.playCard(game, U.A, 0).ok);
  assert.ok(game.version > v0);
});

test('claimForfeit requires the opponent to actually be gone', () => {
  const game = makeGame({});
  engine.touch(game, U.A);
  game.players[1].lastSeen = Date.now() - 1000;
  let r = engine.claimForfeit(game, U.A, 180000);
  assert.ok(!r.ok);
  game.players[1].lastSeen = Date.now() - 200000;
  r = engine.claimForfeit(game, U.A, 180000);
  assert.ok(r.ok);
  assert.equal(game.winner, U.A);
  assert.equal(game.result, 'forfeit');
});
