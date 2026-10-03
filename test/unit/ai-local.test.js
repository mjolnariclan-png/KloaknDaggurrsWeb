'use strict';

/**
 * Regression tests for the LOCAL AI-battle rules (game/ai-game.js) — most
 * importantly the human player's attack phase, which previously had no wiring
 * at all: the player could not attack in AI mode.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { GameState, CardGenerator, AI_PROFILES } = require('../../game/ai-game.js');

function creature(name, attack, defense) {
  return { type: 'creature', name, attack, defense, manaCost: 1 };
}

test('AI difficulty profiles are genuinely different (not just labels)', () => {
  assert.ok(AI_PROFILES.easy.attackChance < AI_PROFILES.medium.attackChance);
  assert.ok(AI_PROFILES.medium.attackChance < AI_PROFILES.hard.attackChance);
  assert.equal(AI_PROFILES.hard.playAll, true);
  assert.equal(AI_PROFILES.easy.playAll, false);
  assert.equal(AI_PROFILES.hard.smart, true);
});

test('generateDeck produces the established 60-card structure', () => {
  const deck = CardGenerator.generateDeck();
  assert.equal(deck.length, 60);
  assert.equal(deck.filter((c) => c.type === 'primordial').length, 1);
  assert.ok(deck.filter((c) => c.type === 'vigor').length > 0);
  assert.ok(deck.filter((c) => c.type === 'creature').length > 0);
});

test('human attack: must attack the Primordial first (priority rules)', () => {
  const s = new GameState();
  const hero = creature('Hero', 4, 4);
  s.player.battlefield = [hero];
  const king = { type: 'primordial', name: 'AIKing', attack: 2, defense: 3, manaCost: 0 };
  s.opponent.primordial = king;
  const guard = creature('Guard', 1, 1);
  s.opponent.battlefield = [king, guard];
  s.beginPlayerAttackPhase();

  const targets = s.legalPlayerTargets(s.opponent);
  assert.equal(targets.creatures.length, 1);
  assert.equal(targets.creatures[0], king, 'only the Primordial is targetable while it lives');
  assert.equal(targets.canAttackPlayer, false);

  // Attacking the Guard while the King lives is rejected, nothing changes.
  assert.equal(s.playerAttack(hero, guard), false);
  assert.equal(guard.defense, 1);
  // A direct player attack while the King lives is rejected too.
  assert.equal(s.playerAttack(hero, null), false);
  assert.equal(s.opponent.life, 30);
  assert.equal(s.gameOver, false);

  // Attacking the King works, kills it, and wins the game.
  assert.equal(s.playerAttack(hero, king), true);
  assert.equal(king.defense, -1);
  assert.ok(s.gameOver);
  assert.equal(s.winner, s.player.name);
  assert.equal(s.endReason, 'primordial');
});

test('human attack: a unit attacks at most once per attack phase', () => {
  const s = new GameState();
  const hero = creature('Hero', 4, 4);
  s.player.battlefield = [hero];
  const guard = creature('Guard', 1, 1);
  s.opponent.battlefield = [guard];
  s.beginPlayerAttackPhase();

  assert.equal(s.canPlayerAttackWith(hero), true);
  assert.equal(s.playerAttack(hero, guard), true);
  assert.equal(s.canPlayerAttackWith(hero), false, 'attacker is spent for this phase');
  assert.equal(s.playerAttack(hero, guard), false, 'second attack must be rejected');
  // New attack phase: fresh set of attacks.
  s.beginPlayerAttackPhase();
  assert.equal(s.canPlayerAttackWith(hero), true);
});

test('human attack: simultaneous combat — both units can die, resolution completes', () => {
  const s = new GameState();
  const brawler = creature('Brawler', 3, 5);
  s.player.battlefield = [brawler, creature('Backup', 4, 4)];
  const spiker = creature('Spiker', 5, 1);
  s.opponent.battlefield = [spiker];
  s.beginPlayerAttackPhase();

  assert.equal(s.playerAttack(brawler, spiker), true);
  // Spiker: 1-3 <= 0 dies; Brawler: 5-5 <= 0 dies too.
  assert.equal(s.opponent.graveyard.includes(spiker), true);
  assert.equal(s.player.graveyard.includes(brawler), true);
  assert.equal(s.gameOver, false);

  // Combat continues with the second attacker (no phase halt on death).
  const backup = s.player.battlefield[0];
  assert.equal(s.playerAttack(backup, null), true); // no blockers remain -> face
  assert.equal(s.opponent.life, 26);
});

test('human attack: direct attacks with no blockers win by life loss', () => {
  const s = new GameState();
  const brute = creature('Brute', 30, 30);
  s.player.battlefield = [brute];
  s.opponent.battlefield = [];
  s.beginPlayerAttackPhase();

  const targets = s.legalPlayerTargets(s.opponent);
  assert.equal(targets.creatures.length, 0);
  assert.equal(targets.canAttackPlayer, true);

  assert.equal(s.playerAttack(brute, null), true);
  assert.ok(s.gameOver);
  assert.equal(s.winner, s.player.name);
  assert.equal(s.endReason, 'lifeloss');
});

test('human attack: attacker death does not stop the AI king from being killed next', () => {
  const s = new GameState();
  const kamikaze = creature('Kamikaze', 2, 2);
  const slayer = creature('Slayer', 10, 10);
  s.player.battlefield = [kamikaze, slayer];
  const wall = creature('Wall', 5, 2);
  s.opponent.battlefield = [wall]; // no enemy primordial drawn yet
  s.beginPlayerAttackPhase();

  // Kamikaze dies killing the wall (both die).
  assert.equal(s.playerAttack(kamikaze, wall), true);
  assert.equal(s.player.graveyard.includes(kamikaze), true);

  // The dead unit cannot attack again, but Slayer can go face.
  assert.equal(s.playerAttack(kamikaze, null), false);
  assert.equal(s.playerAttack(slayer, null), true);
  assert.equal(s.opponent.life, 20);
});
