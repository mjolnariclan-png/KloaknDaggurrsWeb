'use strict';

/**
 * Kloak 'n' Daggurrs — authoritative game engine (pure module, no I/O).
 *
 * Rules implemented (per established game spec):
 *  - Phases per turn: vigor -> draw -> play -> attack (then next player).
 *  - Mana ("Vigor") is produced by Vigor (mana) cards on the battlefield.
 *    There is no automatic free mana. Maximum mana is 20.
 *  - No card may cost more than 15 (validation rejects it).
 *  - Creatures (max 5 on battlefield) and Primordials live on the battlefield.
 *    Primordials use the Command Zone: they enter the battlefield directly
 *    when drawn (they are never held in hand).
 *  - Combat is simultaneous: attacker and defender deal damage to each other
 *    at the same time, computed from pre-combat values, and combat resolution
 *    always completes even when creatures die during it.
 *  - A player loses when:
 *      * life (Scallous) <= 0
 *      * their Primordial leaves the battlefield (King dies)
 *      * they must draw from an empty deck (deck-out)
 *      * they play no card for 5 consecutive of their own turns
 *      * they surrender / forfeit
 *  - Victory/defeat is detected after every mutating action.
 */

const MAX_MANA = 20;
const MAX_CARD_COST = 15;
const MAX_CREATURES = 5;
const MAX_HAND = 10;
const MAX_VIGOR_PER_DECK = 22;
const NO_PLAY_TURN_LIMIT = 5;
const PHASES = ['vigor', 'draw', 'play', 'attack'];
const STARTING_LIFE = 30;
const STARTING_HAND = 7;

const ALLOWED_CARD_TYPES = ['vigor', 'creature', 'primordial', 'equipment', 'rune'];

function isInt(v) {
  return Number.isInteger(v);
}

function clampCost(cost) {
  const n = parseInt(cost, 10);
  if (!isFinite(n) || isNaN(n)) return 0;
  return Math.max(0, Math.min(MAX_CARD_COST, n));
}

function totalVigor(player) {
  return player.battlefield.filter((c) => c && c.type === 'vigor').length;
}

/** Available mana this turn: total vigor (capped at 20) minus spent this turn. */
function availableMana(player) {
  const total = Math.min(MAX_MANA, totalVigor(player));
  return Math.max(0, total - (player.vigorUsedThisTurn || 0));
}

/** Spend mana; returns false when insufficient. */
function spendMana(player, amount) {
  if (!isInt(amount) || amount < 0) return false;
  const avail = availableMana(player);
  if (amount > avail) return false;
  player.vigorUsedThisTurn = (player.vigorUsedThisTurn || 0) + amount;
  return true;
}

function creatureCount(player) {
  return player.battlefield.filter((c) => c && c.type === 'creature').length;
}

function refreshMana(player) {
  player.mana = Math.min(MAX_MANA, totalVigor(player));
  player.vigorUsedThisTurn = 0;
}

/** Create a fully initialized game from two prepared decks (arrays of card objects). */
function createGame({ id, players, firstPlayerIndex }) {
  if (!Array.isArray(players) || players.length !== 2) {
    throw new Error('Game requires exactly two players');
  }
  players.forEach((p, i) => {
    if (!p || typeof p.id !== 'string' || !p.id) throw new Error(`Player ${i} missing id`);
    if (!Array.isArray(p.deck)) throw new Error(`Player ${i} missing deck`);
  });

  const now = Date.now();
  const game = {
    id,
    version: 1,
    status: 'active',
    players: players.map((p) => ({
      id: p.id,
      name: p.name || 'Player',
      life: STARTING_LIFE,
      mana: 0,
      hand: [],
      battlefield: [],
      deck: p.deck.slice(),
      vigorUsedThisTurn: 0,
      noPlayTurns: 0,
      playedThisTurn: false,
      isReady: false,
      lastSeen: now,
    })),
    currentTurn: isInt(firstPlayerIndex) && (firstPlayerIndex === 0 || firstPlayerIndex === 1) ? firstPlayerIndex : 0,
    turnNumber: 1,
    phase: 'vigor',
    phaseStartedAt: now,
    winner: null,
    result: null,
    createdAt: now,
    lastUpdate: now,
  };

  // Starting hands: primordial goes to battlefield (Command Zone), vigor auto-deploys.
  game.players.forEach((p) => {
    for (let i = 0; i < STARTING_HAND; i++) drawOne(game, p, true);
    refreshMana(p);
  });
  return game;
}

/** Draw a single card for a player. initial=true skips deck-out loss (mulligan/start). */
function drawOne(game, player, initial = false) {
  if (player.deck.length === 0) {
    if (!initial) {
      setWinner(game, opposite(game, player), 'deckout');
    }
    return null;
  }
  const card = player.deck.pop();
  if (!card || typeof card !== 'object') return null;
  const type = card.type;
  if (type === 'primordial') {
    card.canAttack = false;
    player.battlefield.push(card);
  } else if (type === 'vigor') {
    player.battlefield.push(card);
  } else {
    if (player.hand.length >= MAX_HAND) return null;
    player.hand.push(card);
  }
  return card;
}

function opposite(game, player) {
  return game.players[0] === player ? game.players[1] : game.players[0];
}

function playerIndex(game, userId) {
  return game.players.findIndex((p) => p.id === userId);
}

function setWinner(game, winnerPlayer, result) {
  if (game.status === 'completed') return;
  game.status = 'completed';
  game.winner = winnerPlayer ? winnerPlayer.id : null;
  game.result = result;
  game.completedAt = Date.now();
}

function checkVictory(game) {
  if (game.status === 'completed') return;
  for (const p of game.players) {
    const other = opposite(game, p);
    if (p.life <= 0) return setWinner(game, other, 'lifeloss');
    // King-death loss: the Primordial has entered play (deck no longer holds it)
    // but is no longer on the battlefield.
    const hasPrimordialInDeckOrPlay =
      p.battlefield.some((c) => c && c.type === 'primordial') ||
      p.deck.some((c) => c && c.type === 'primordial');
    if (!hasPrimordialInDeckOrPlay) {
      return setWinner(game, other, 'primordial');
    }
    if ((p.noPlayTurns || 0) >= NO_PLAY_TURN_LIMIT) {
      return setWinner(game, other, 'noplay');
    }
  }
}

// ---------------------------------------------------------------------------
// Actions. Every action returns { ok, error?, drawnCard? } and mutates `game`.
// ---------------------------------------------------------------------------

function assertActive(game) {
  if (!game) return { ok: false, error: 'Game not found' };
  if (game.status === 'completed') return { ok: false, error: 'Game already finished' };
  return { ok: true };
}

function assertTurn(game, userId) {
  const idx = playerIndex(game, userId);
  if (idx === -1) return { ok: false, error: 'Player not in game' };
  if (game.players[game.currentTurn].id !== userId) return { ok: false, error: 'Not your turn' };
  return { ok: true, idx };
}

function playCard(game, userId, cardIndex) {
  let check = assertActive(game);
  if (!check.ok) return check;
  check = assertTurn(game, userId);
  if (!check.ok) return check;
  const p = game.players[check.idx];
  if (game.phase !== 'play') return { ok: false, error: 'Can only play cards during Play Phase' };
  if (!isInt(cardIndex) || cardIndex < 0 || cardIndex >= p.hand.length) {
    return { ok: false, error: 'Card not found' };
  }
  const card = p.hand[cardIndex];
  const type = card.type;
  if (!ALLOWED_CARD_TYPES.includes(type)) return { ok: false, error: 'Invalid card type' };
  const cost = clampCost(card.cost);
  if (card.cost !== undefined && parseInt(card.cost, 10) > MAX_CARD_COST) {
    return { ok: false, error: `Card cost exceeds the maximum of ${MAX_CARD_COST}` };
  }

  if (type === 'equipment') {
    return { ok: false, error: 'Equipment must be attached to a creature using the equipment action' };
  }

  if (type === 'creature') {
    if (creatureCount(p) >= MAX_CREATURES) {
      return { ok: false, error: `Maximum ${MAX_CREATURES} creatures allowed on battlefield` };
    }
  }

  if (!spendMana(p, cost)) {
    return { ok: false, error: `Not enough Vigor. Need ${cost}, have ${availableMana(p)}` };
  }

  p.hand.splice(cardIndex, 1);
  p.playedThisTurn = true;
  p.noPlayTurns = 0;

  if (type === 'creature') {
    card.canAttack = true; // no summoning sickness per established design
    card.hasHaste = false;
    p.battlefield.push(card);
  } else if (type === 'vigor') {
    p.battlefield.push(card);
  } else if (type === 'rune') {
    // Rune: one-time use spell. Established effect: direct damage to opponent.
    const opponent = opposite(game, p);
    const damage = isInt(card.runeDamage) && card.runeDamage > 0 ? card.runeDamage : 3 + Math.floor(Math.random() * 5);
    opponent.life -= damage;
    p.graveyard = p.graveyard || [];
    p.graveyard.push(card);
  }

  refreshManaDisplay(p);
  checkVictory(game);
  bump(game);
  return { ok: true };
}

function attachEquipment(game, userId, equipmentIndex, targetCreatureIndex) {
  let check = assertActive(game);
  if (!check.ok) return check;
  check = assertTurn(game, userId);
  if (!check.ok) return check;
  const p = game.players[check.idx];
  if (game.phase !== 'play') return { ok: false, error: 'Can only attach equipment during Play Phase' };
  if (!isInt(equipmentIndex) || equipmentIndex < 0 || equipmentIndex >= p.hand.length) {
    return { ok: false, error: 'Equipment not found' };
  }
  const equipment = p.hand[equipmentIndex];
  if (equipment.type !== 'equipment') return { ok: false, error: 'Selected card is not equipment' };
  if (!isInt(targetCreatureIndex) || targetCreatureIndex < 0 || targetCreatureIndex >= p.battlefield.length) {
    return { ok: false, error: 'Target creature not found' };
  }
  const target = p.battlefield[targetCreatureIndex];
  if (target.type !== 'creature' && target.type !== 'primordial') {
    return { ok: false, error: 'Target must be a creature or primordial' };
  }
  if (target.equipment) return { ok: false, error: 'Target already has equipment' };

  const cost = clampCost(equipment.cost);
  if (!spendMana(p, cost)) {
    return { ok: false, error: `Not enough Vigor. Need ${cost}, have ${availableMana(p)}` };
  }

  p.hand.splice(equipmentIndex, 1);
  target.equipment = equipment;
  target.attack = (target.attack || 0) + (equipment.attack || 0);
  target.defense = (target.defense || 0) + (equipment.defense || 0);
  p.playedThisTurn = true;
  p.noPlayTurns = 0;
  refreshManaDisplay(p);
  bump(game);
  return { ok: true };
}

/**
 * Attack. Combat is simultaneous and always resolves fully:
 * damage is computed from pre-combat attack/defense values, then deaths are
 * applied. The attacker may die during its own attack; that never halts
 * resolution or the rest of the phase.
 */
function attack(game, userId, attackerIndex, targetIndex, targetPlayer) {
  let check = assertActive(game);
  if (!check.ok) return check;
  check = assertTurn(game, userId);
  if (!check.ok) return check;
  const p = game.players[check.idx];
  const opponent = opposite(game, p);
  if (game.phase !== 'attack') return { ok: false, error: 'Can only attack during Attack Phase' };

  if (!isInt(attackerIndex) || attackerIndex < 0 || attackerIndex >= p.battlefield.length) {
    return { ok: false, error: 'Attacker not found' };
  }
  const attacker = p.battlefield[attackerIndex];
  if (attacker.type !== 'creature' && attacker.type !== 'primordial') {
    return { ok: false, error: 'Only creatures and primordials can attack' };
  }
  if (!attacker.canAttack && !attacker.hasHaste) {
    return { ok: false, error: 'Unit has summoning sickness' };
  }

  // Target priority: Primordial > Creatures > Player
  const opponentPrimordial = opponent.battlefield.find((c) => c && c.type === 'primordial');
  const opponentCreatures = opponent.battlefield.filter((c) => c && c.type === 'creature');

  if (opponentPrimordial) {
    if (targetPlayer) return { ok: false, error: 'Must attack Primordial first' };
    const target = isInt(targetIndex) ? opponent.battlefield[targetIndex] : null;
    if (!target || target.type !== 'primordial') return { ok: false, error: 'Must attack Primordial first' };
  } else if (opponentCreatures.length > 0) {
    if (targetPlayer) return { ok: false, error: 'Must attack creatures first' };
    const target = isInt(targetIndex) ? opponent.battlefield[targetIndex] : null;
    if (!target || target.type !== 'creature') return { ok: false, error: 'Must attack creatures first' };
  } else if (targetPlayer !== true) {
    return { ok: false, error: 'You must target the player when no blockers remain' };
  }

  const attackerAttack = attacker.attack || 0;

  if (targetPlayer === true) {
    // Direct attack on the player
    opponent.life -= attackerAttack;
  } else {
    const target = opponent.battlefield[targetIndex];
    if (!target) return { ok: false, error: 'Target not found' };

    // Simultaneous combat damage — snapshot pre-combat values first.
    const targetAttack = target.attack || 0;
    target.defense = (target.defense || 0) - attackerAttack;
    attacker.defense = (attacker.defense || 0) - targetAttack;

    // Apply deaths after both damage applications.
    if (target.defense <= 0) {
      const ti = opponent.battlefield.indexOf(target);
      if (ti !== -1) opponent.battlefield.splice(ti, 1);
      opponent.graveyard = opponent.graveyard || [];
      opponent.graveyard.push(target);
    }
    if (attacker.defense <= 0) {
      const ai = p.battlefield.indexOf(attacker);
      if (ai !== -1) p.battlefield.splice(ai, 1);
      p.graveyard = p.graveyard || [];
      p.graveyard.push(attacker);
    }
  }

  // A unit attacks at most once per attack phase.
  attacker.canAttack = false;
  attacker.hasHaste = false;

  checkVictory(game);
  bump(game);
  return { ok: true };
}

function drawCard(game, userId) {
  let check = assertActive(game);
  if (!check.ok) return check;
  check = assertTurn(game, userId);
  if (!check.ok) return check;
  const p = game.players[check.idx];
  if (game.phase !== 'draw') return { ok: false, error: 'Cards can only be drawn during the Draw Phase' };
  if (p.hand.length >= MAX_HAND) return { ok: false, error: 'Hand is full' };
  if (p.deck.length === 0) return { ok: false, error: 'Deck is empty' };
  const card = drawOne(game, p, false);
  refreshManaDisplay(p);
  checkVictory(game);
  bump(game);
  return { ok: true, drawnCard: card };
}

function autoPlayVigor(game, userId) {
  let check = assertActive(game);
  if (!check.ok) return check;
  check = assertTurn(game, userId);
  if (!check.ok) return check;
  const p = game.players[check.idx];
  if (game.phase !== 'vigor') return { ok: false, error: 'Vigor can only be deployed during the Vigor Phase' };
  for (let i = p.hand.length - 1; i >= 0; i--) {
    if (p.hand[i].type === 'vigor') {
      p.battlefield.push(p.hand.splice(i, 1)[0]);
    }
  }
  p.mana = Math.min(MAX_MANA, totalVigor(p));
  bump(game);
  return { ok: true };
}

function startTurn(game, player) {
  refreshMana(player);
  // Vigor phase auto-deploys Vigor (mana) cards from hand — mana comes only
  // from played Mana cards; there is no automatic free mana.
  for (let i = player.hand.length - 1; i >= 0; i--) {
    if (player.hand[i].type === 'vigor') {
      player.battlefield.push(player.hand.splice(i, 1)[0]);
    }
  }
  player.mana = Math.min(MAX_MANA, totalVigor(player));
  // Units that survived a full round can attack again.
  player.battlefield.forEach((c) => {
    if (c && (c.type === 'creature' || c.type === 'primordial')) c.canAttack = true;
  });
}

function advancePhase(game, userId) {
  let check = assertActive(game);
  if (!check.ok) return check;
  check = assertTurn(game, userId);
  if (!check.ok) return check;
  const p = game.players[check.idx];
  const idx = PHASES.indexOf(game.phase);
  if (idx === -1) return { ok: false, error: 'Invalid phase' };

  if (idx < PHASES.length - 1) {
    const next = PHASES[idx + 1];
    game.phase = next;
    game.phaseStartedAt = Date.now();
    if (next === 'draw') {
      // Draw phase: mandatory draw. Deck-out = loss.
      if (p.deck.length === 0) {
        setWinner(game, opposite(game, p), 'deckout');
      } else {
        drawOne(game, p, false);
      }
    } else if (next === 'attack') {
      p.battlefield.forEach((c) => {
        if (c && (c.type === 'creature' || c.type === 'primordial')) c.canAttack = true;
      });
    }
  } else {
    // End of attack phase -> end of this player's turn.
    endOwnTurn(game, p);
  }
  checkVictory(game);
  bump(game);
  return { ok: true };
}

function endOwnTurn(game, player) {
  // Track consecutive no-play turns (loss after 5).
  if (!player.playedThisTurn) {
    player.noPlayTurns = (player.noPlayTurns || 0) + 1;
  } else {
    player.noPlayTurns = 0;
  }
  player.playedThisTurn = false;

  game.currentTurn = (game.currentTurn + 1) % 2;
  if (game.currentTurn === 0) game.turnNumber += 1;
  game.phase = 'vigor';
  game.phaseStartedAt = Date.now();
  const next = game.players[game.currentTurn];
  startTurn(game, next);
}

/**
 * Server-authoritative phase timeout. Advances the current player's phase
 * whenever their phase clock has expired — the same rule the browser client
 * enforces with its 60-second phase timer. A stalled or modified client can
 * therefore never hold a phase (and thus a turn) hostage.
 * Each advance resets the clock, so one call performs at most one advance per
 * expired 60s window; callers poll periodically to keep the game moving.
 * Returns the number of phase advances applied.
 */
function applyPhaseTimeouts(game, timeoutMs) {
  if (!game || game.status !== 'active') return 0;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return 0;
  let advanced = 0;
  while (advanced < 64) {
    const current = game.players[game.currentTurn];
    const started = game.phaseStartedAt || game.lastUpdate || game.createdAt || 0;
    if (Date.now() - started < timeoutMs) break;
    const r = advancePhase(game, current.id);
    if (!r.ok) break;
    advanced++;
    if (game.status === 'completed') break;
  }
  return advanced;
}

function surrender(game, userId) {
  const check = assertActive(game);
  if (!check.ok) return check;
  const idx = playerIndex(game, userId);
  if (idx === -1) return { ok: false, error: 'Player not in game' };
  setWinner(game, game.players[1 - idx], 'surrender');
  bump(game);
  return { ok: true };
}

/** Forfeit: opponent left. Caller wins if opponent hasn't been seen within `thresholdMs`. */
function claimForfeit(game, userId, thresholdMs) {
  const check = assertActive(game);
  if (!check.ok) return check;
  const idx = playerIndex(game, userId);
  if (idx === -1) return { ok: false, error: 'Player not in game' };
  const opponent = game.players[1 - idx];
  const away = Date.now() - (opponent.lastSeen || 0);
  if (away < thresholdMs) {
    return { ok: false, error: `Opponent was seen ${Math.round(away / 1000)}s ago; forfeit unavailable` };
  }
  setWinner(game, game.players[idx], 'forfeit');
  bump(game);
  return { ok: true };
}

function touch(game, userId) {
  const idx = playerIndex(game, userId);
  if (idx !== -1) game.players[idx].lastSeen = Date.now();
}

function bump(game) {
  game.version = (game.version || 0) + 1;
  game.lastUpdate = Date.now();
}

function refreshManaDisplay(p) {
  // Keep `mana` as the total pool for display; available = total - used.
  p.mana = Math.min(MAX_MANA, totalVigor(p));
}

// ---------------------------------------------------------------------------
// View sanitization — hide the opponent's hand and both deck contents.
// ---------------------------------------------------------------------------

function sanitize(game, userId) {
  if (!game) return null;
  const view = JSON.parse(JSON.stringify(game));
  delete view.processedActions; // internal dedupe log — never expose
  const mine = view.players.findIndex((p) => p.id === userId);
  view.players.forEach((p) => {
    delete p.grantedRewards;
    delete p.levelsGained;
    delete p.lastSeen;
  });
  if (mine >= 0) {
    const opp = view.players[1 - mine];
    if (opp) {
      opp.hand = (opp.hand || []).map(() => ({ type: 'hidden', name: 'Hidden Card' }));
      opp.deck = (opp.deck || []).map(() => ({ type: 'hidden' }));
      opp.lastSeen = undefined;
      opp.noPlayTurns = Math.min(opp.noPlayTurns || 0, NO_PLAY_TURN_LIMIT);
    }
    const me = view.players[mine];
    if (me) {
      me.deck = (me.deck || []).map(() => ({ type: 'hidden' }));
      me.lastSeen = undefined;
    }
  } else {
    // Spectator/unrelated user: hide both hands and decks.
    view.players.forEach((p) => {
      p.hand = (p.hand || []).map(() => ({ type: 'hidden', name: 'Hidden Card' }));
      p.deck = (p.deck || []).map(() => ({ type: 'hidden' }));
      p.lastSeen = undefined;
    });
  }
  return view;
}

module.exports = {
  MAX_MANA,
  MAX_CARD_COST,
  MAX_CREATURES,
  MAX_HAND,
  MAX_VIGOR_PER_DECK,
  NO_PLAY_TURN_LIMIT,
  PHASES,
  STARTING_LIFE,
  createGame,
  availableMana,
  playCard,
  attachEquipment,
  attack,
  drawCard,
  autoPlayVigor,
  advancePhase,
  applyPhaseTimeouts,
  surrender,
  claimForfeit,
  checkVictory,
  sanitize,
  touch,
  playerIndex,
  clampCost,
};
