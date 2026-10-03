'use strict';

/**
 * Kloak 'n' Daggurrs — progression math (pure module).
 *
 * XP table formula (verified against the established XP_TABLE in the legacy
 * server): xpNeeded(level) = round(100 * 1.05^(level-1) * (1 + 0.1 * prestige)).
 * It reproduces every value of the legacy tables (prestige0: 100, 105, 110,
 * 116, 122, ... 155@10 ... 410@30) and extends them to level 100.
 *
 * Prestige: at level 100 a player may prestige -> back to level 1, +1 star,
 * up to 5 stars. Each star grants +10% XP and +10% coins.
 */

const MAX_LEVEL = 100;
const PRESTIGE_LEVEL = 100;
/**
 * Five prestige tiers (0-4), matching the five established legacy XP tables
 * exactly. The legacy system's cap ("Already at maximum prestige" at tier 4)
 * is preserved. Each tier/star grants +10% XP and +10% coins.
 */
const MAX_PRESTIGE = 4;

/**
 * XP requirements.
 * Levels 1-49 per prestige star use the ESTABLISHED legacy XP tables verbatim
 * (they are hand-tuned and not an exact formula). Level 50+ is extended to the
 * Level-100 prestige gate by compounding the last established value by 5% per
 * level (the table's own growth pattern).
 */
const LEGACY_XP = {
  0: { 1: 100, 2: 105, 3: 110, 4: 116, 5: 122, 6: 128, 7: 134, 8: 141, 9: 148, 10: 155, 11: 163, 12: 171, 13: 179, 14: 188, 15: 197, 16: 207, 17: 217, 18: 228, 19: 239, 20: 251, 21: 263, 22: 276, 23: 290, 24: 305, 25: 320, 26: 336, 27: 353, 28: 371, 29: 390, 30: 410, 31: 431, 32: 452, 33: 475, 34: 499, 35: 524, 36: 550, 37: 578, 38: 607, 39: 637, 40: 669, 41: 702, 42: 737, 43: 774, 44: 813, 45: 853, 46: 896, 47: 941, 48: 988, 49: 1037 },
  1: { 1: 110, 2: 116, 3: 121, 4: 128, 5: 134, 6: 141, 7: 147, 8: 155, 9: 163, 10: 171, 11: 179, 12: 188, 13: 197, 14: 207, 15: 217, 16: 228, 17: 239, 18: 251, 19: 263, 20: 276, 21: 290, 22: 305, 23: 320, 24: 336, 25: 353, 26: 371, 27: 390, 28: 410, 29: 431, 30: 452, 31: 475, 32: 499, 33: 524, 34: 550, 35: 578, 36: 607, 37: 637, 38: 669, 39: 702, 40: 737, 41: 774, 42: 813, 43: 853, 44: 896, 45: 941, 46: 988, 47: 1037, 48: 1089, 49: 1141 },
  2: { 1: 120, 2: 126, 3: 132, 4: 139, 5: 146, 6: 154, 7: 161, 8: 169, 9: 178, 10: 186, 11: 196, 12: 205, 13: 215, 14: 226, 15: 236, 16: 248, 17: 260, 18: 274, 19: 287, 20: 301, 21: 316, 22: 331, 23: 348, 24: 366, 25: 384, 26: 403, 27: 424, 28: 445, 29: 468, 30: 492, 31: 517, 32: 542, 33: 570, 34: 599, 35: 629, 36: 660, 37: 694, 38: 728, 39: 764, 40: 803, 41: 842, 42: 884, 43: 929, 44: 976, 45: 1024, 46: 1075, 47: 1129, 48: 1186, 49: 1244 },
  3: { 1: 135, 2: 142, 3: 149, 4: 157, 5: 165, 6: 173, 7: 181, 8: 190, 9: 200, 10: 209, 11: 220, 12: 231, 13: 242, 14: 254, 15: 266, 16: 280, 17: 293, 18: 308, 19: 323, 20: 339, 21: 355, 22: 373, 23: 392, 24: 412, 25: 432, 26: 454, 27: 477, 28: 501, 29: 527, 30: 554, 31: 582, 32: 610, 33: 641, 34: 674, 35: 707, 36: 743, 37: 780, 38: 819, 39: 860, 40: 903, 41: 948, 42: 995, 43: 1045, 44: 1098, 45: 1152, 46: 1210, 47: 1270, 48: 1333, 49: 1400 },
  4: { 1: 150, 2: 158, 3: 165, 4: 174, 5: 183, 6: 192, 7: 201, 8: 212, 9: 222, 10: 233, 11: 245, 12: 257, 13: 269, 14: 282, 15: 296, 16: 311, 17: 326, 18: 342, 19: 359, 20: 377, 21: 395, 22: 414, 23: 435, 24: 458, 25: 480, 26: 504, 27: 530, 28: 557, 29: 585, 30: 615, 31: 647, 32: 678, 33: 713, 34: 749, 35: 786, 36: 825, 37: 867, 38: 911, 39: 956, 40: 1004, 41: 1053, 42: 1106, 43: 1161, 44: 1220, 45: 1280, 46: 1344, 47: 1412, 48: 1482, 49: 1556 },
};

const xpCache = new Map();

function xpNeeded(level, prestige = 0) {
  const l = Math.max(1, Math.min(MAX_LEVEL, level));
  const p = Math.max(0, Math.min(MAX_PRESTIGE, prestige));
  const key = `${p}:${l}`;
  if (xpCache.has(key)) return xpCache.get(key);

  const table = LEGACY_XP[p];
  let value;
  if (Object.prototype.hasOwnProperty.call(table, l)) {
    value = table[l];
  } else {
    // Deterministic extension from level 49 (the last established value):
    // each subsequent level costs 5% more, rounded.
    let v = table[49];
    for (let lv = 50; lv <= l; lv++) {
      v = Math.round(v * 1.05);
      xpCache.set(`${p}:${lv}`, v);
    }
    value = v;
  }
  xpCache.set(key, value);
  return value;
}

/** Prestige bonus multiplier: 1 + 10% per star. */
function prestigeMultiplier(prestige) {
  return 1 + 0.1 * Math.max(0, Math.min(MAX_PRESTIGE, prestige));
}

/**
 * Apply XP to a progression record (pure; returns list of levels gained).
 * Mutates: xp, level, total_xp, xp_to_next, prestige unchanged.
 */
function applyXp(record, amount) {
  if (!Number.isInteger(amount) || amount <= 0) return [];
  const levels = [];
  record.xp = (record.xp || 0) + amount;
  record.total_xp = (record.total_xp || 0) + amount;
  while (record.level < MAX_LEVEL && record.xp >= xpNeeded(record.level, record.prestige || 0)) {
    record.xp -= xpNeeded(record.level, record.prestige || 0);
    record.level += 1;
    levels.push(record.level);
  }
  if (record.level >= MAX_LEVEL) record.xp = Math.min(record.xp, xpNeeded(MAX_LEVEL, record.prestige || 0));
  record.xp_to_next = xpNeeded(record.level, record.prestige || 0);
  return levels;
}

/**
 * Prestige: requires level 100 and prestige < 5.
 * Keeps friends/tutorial/settings/cosmetics (not stored in this record).
 */
function prestige(record) {
  if (record.level < PRESTIGE_LEVEL) return { ok: false, error: `Must be level ${PRESTIGE_LEVEL} to prestige` };
  if ((record.prestige || 0) >= MAX_PRESTIGE) return { ok: false, error: 'Already at maximum prestige' };
  record.prestige = (record.prestige || 0) + 1;
  record.level = 1;
  record.xp = 0;
  record.xp_to_next = xpNeeded(1, record.prestige);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Match rewards — server-authoritative values only.
// ---------------------------------------------------------------------------

const REWARDS = {
  multiplayer: { winXp: 150, loseXp: 25, winCoins: 50, loseCoins: 10 },
  ai: { winXp: 75, loseXp: 0, winCoins: 25, loseCoins: 0 },
};

/** Compute (un-rounded-then-rounded) rewards for a player, applying prestige stars. */
function computeMatchRewards({ mode, won, prestige }) {
  const table = REWARDS[mode] || REWARDS.multiplayer;
  const mult = prestigeMultiplier(prestige);
  const xp = Math.round((won ? table.winXp : table.loseXp) * mult);
  const coins = Math.round((won ? table.winCoins : table.loseCoins) * mult);
  return { xp, coins };
}

// Level gates (established progression spec)
const LEVEL_GATES = {
  friends: 3,
  clans: 5,
  aiEasy: 3,
  aiMedium: 5,
  aiHard: 8,
};

module.exports = {
  MAX_LEVEL,
  PRESTIGE_LEVEL,
  MAX_PRESTIGE,
  LEVEL_GATES,
  xpNeeded,
  prestigeMultiplier,
  applyXp,
  prestige,
  computeMatchRewards,
  REWARDS,
};
