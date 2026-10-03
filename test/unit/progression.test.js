'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const progression = require('../../lib/progression');

test('xpNeeded reproduces the established legacy XP table (prestige 0)', () => {
  const legacy = {
    1: 100, 2: 105, 3: 110, 4: 116, 5: 122, 6: 128, 7: 134, 8: 141, 9: 148, 10: 155,
    20: 251, 30: 410, 40: 669, 49: 1037,
  };
  for (const [level, xp] of Object.entries(legacy)) {
    assert.equal(progression.xpNeeded(Number(level), 0), xp, `level ${level}`);
  }
});

test('xpNeeded reproduces the established legacy XP table (prestige 1-4)', () => {
  assert.equal(progression.xpNeeded(1, 1), 110);
  assert.equal(progression.xpNeeded(10, 1), 171);
  assert.equal(progression.xpNeeded(1, 2), 120);
  assert.equal(progression.xpNeeded(30, 3), 554);
  assert.equal(progression.xpNeeded(49, 4), 1556);
});

test('xpNeeded extends to level 100 (prestige gate)', () => {
  assert.ok(progression.xpNeeded(100, 0) > progression.xpNeeded(99, 0));
  assert.ok(progression.xpNeeded(50, 0) > 0);
});

test('applyXp levels up correctly and stops at 100', () => {
  const rec = { level: 1, xp: 0, prestige: 0, total_xp: 0 };
  const levels = progression.applyXp(rec, 100); // exactly level 1 requirement
  assert.deepEqual(levels, [2]);
  assert.equal(rec.level, 2);
  assert.equal(rec.xp, 0);
  assert.equal(rec.total_xp, 100);
  assert.equal(rec.xp_to_next, progression.xpNeeded(2, 0));

  progression.applyXp(rec, 1000000);
  assert.equal(rec.level, 100); // capped
  assert.ok(rec.xp >= 0);
});

test('prestige: requires level 100, max 5 stars, resets level', () => {
  const rec = { level: 99, xp: 10, prestige: 0 };
  assert.equal(progression.prestige(rec).ok, false);

  rec.level = 100;
  let r = progression.prestige(rec);
  assert.ok(r.ok);
  assert.equal(rec.prestige, 1);
  assert.equal(rec.level, 1);
  assert.equal(rec.xp, 0);

  // Tiers 0-4 are the five established prestige stars; the 5th event is the cap.
  for (let tier = 2; tier <= 4; tier++) {
    rec.level = 100;
    r = progression.prestige(rec);
    assert.ok(r.ok, `tier ${tier} must be allowed`);
    assert.equal(rec.prestige, tier);
  }
  assert.equal(rec.prestige, 4);
  rec.level = 100;
  r = progression.prestige(rec);
  assert.equal(r.ok, false, 'tier 5 must be rejected (maximum prestige)');
});

test('prestige stars grant +10% XP and coins each', () => {
  assert.equal(progression.prestigeMultiplier(0), 1);
  assert.equal(progression.prestigeMultiplier(2), 1.2);
  const base = progression.computeMatchRewards({ mode: 'multiplayer', won: true, prestige: 0 });
  const star3 = progression.computeMatchRewards({ mode: 'multiplayer', won: true, prestige: 3 });
  assert.equal(base.xp, 150);
  assert.equal(base.coins, 50);
  assert.equal(star3.xp, Math.round(150 * 1.3));
  assert.equal(star3.coins, Math.round(50 * 1.3));
});

test('AI rewards are half of multiplayer rewards per established design', () => {
  const ai = progression.computeMatchRewards({ mode: 'ai', won: true, prestige: 0 });
  assert.equal(ai.xp, 75);
  assert.equal(ai.coins, 25);
  const loss = progression.computeMatchRewards({ mode: 'ai', won: false, prestige: 0 });
  assert.equal(loss.xp, 0);
  assert.equal(loss.coins, 0);
  const mpLoss = progression.computeMatchRewards({ mode: 'multiplayer', won: false, prestige: 0 });
  assert.equal(mpLoss.xp, 25);
  assert.equal(mpLoss.coins, 10);
});

test('level gates match the progression spec', () => {
  assert.equal(progression.LEVEL_GATES.aiEasy, 3);
  assert.equal(progression.LEVEL_GATES.aiMedium, 5);
  assert.equal(progression.LEVEL_GATES.aiHard, 8);
  assert.equal(progression.LEVEL_GATES.friends, 3);
  assert.equal(progression.LEVEL_GATES.clans, 5);
});
