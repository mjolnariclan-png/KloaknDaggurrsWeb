'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const helpers = require('../helpers/server');

const U = {
  A: 'user-111111111111',
  B: 'user-222222222222',
  C: 'user-333333333333',
  outsider: 'user-444444444444',
};

let S;
before(async () => {
  S = helpers;
  await S.ready();
});

after(async () => {
  // Shut the HTTP server down so the test process can exit.
  await new Promise((resolve) => S.serverModule.server.close(resolve));
});

test('health endpoint reports ok', async () => {
  const res = await fetch(`${S.BASE}/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.service, 'kloakndaggurrs');
});

test('unauthenticated requests to game endpoints are rejected (401)', async () => {
  for (const [method, path] of [
    ['POST', '/api/join-lobby'],
    ['GET', '/api/lobby-players'],
    ['POST', '/api/challenge-player'],
    ['GET', '/api/game-state/game_x'],
    ['POST', '/api/play-card'],
    ['POST', '/api/attack'],
    ['POST', '/api/advance-phase'],
    ['POST', '/api/surrender'],
    ['GET', `/api/player/${U.A}`],
    ['POST', '/api/ai/start'],
    ['POST', '/api/ai/result'],
  ]) {
    const res = await fetch(`${S.BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' ? JSON.stringify({}) : undefined,
    });
    assert.equal(res.status, 401, `${method} ${path} must require auth`);
  }
});

test('client-supplied playerId is ignored — identity comes from the token', async () => {
  // A tries to impersonate B by sending B's id in the body.
  const r = await S.post(U.A, '/api/join-lobby', { playerId: U.B, playerName: 'Imposter' });
  assert.ok(r.data.success);
  const lobby = await S.get(U.A, '/api/lobby-players');
  const present = lobby.data.players.map((p) => p.id);
  assert.ok(present.includes(U.A), 'token user should be in lobby');
  assert.ok(!present.includes(U.B), 'spoofed id must be ignored');
});

test('cannot view another player\'s progression', async () => {
  const r = await S.get(U.A, `/api/player/${U.B}`);
  assert.equal(r.status, 403);
});

test('challenge requires the opponent to be in the lobby', async () => {
  const r = await S.post(U.A, '/api/challenge-player', { opponentId: U.outsider });
  assert.ok(!r.data.success);
  assert.match(r.data.error, /lobby/);
});

test('cannot challenge yourself', async () => {
  await S.joinLobby(U.C, 'Charlie');
  const r = await S.post(U.C, '/api/challenge-player', { opponentId: U.C });
  assert.ok(!r.data.success);
});

test('full two-player match: create, sync both directions, fight, rewards exactly once', async () => {
  // --- match creation ---
  const match = await S.createMatch(U.A, U.B);
  assert.ok(match.gameId);
  const gameId = match.gameId;

  // --- both players receive the same authoritative initial state ---
  const stateA = await S.get(U.A, `/api/game-state/${gameId}`);
  const stateB = await S.get(U.B, `/api/game-state/${gameId}`);
  assert.ok(stateA.data.success && stateB.data.success);
  assert.equal(stateA.data.gameState.id, stateB.data.gameState.id);
  assert.equal(stateA.data.gameState.version, stateB.data.gameState.version);
  assert.equal(stateA.data.gameState.turnNumber, stateB.data.gameState.turnNumber);

  // --- opponent hand must be hidden from each player ---
  const oppOfA = stateA.data.gameState.players[1 - match.playerIndex];
  assert.ok(oppOfA.hand.every((c) => c.type === 'hidden'), 'opponent hand must be hidden');

  const idxA = match.playerIndex;
  const idxB = 1 - idxA;
  const who = (state, i) => state.data.gameState.players[i];

  // Whose turn is it? Determine from state.
  let current = stateA.data.gameState.currentTurn;
  let currentUserId = current === idxA ? U.A : U.B;
  let oppUserId = current === idxA ? U.B : U.A;

  // A third party cannot see the match.
  const outsiderView = await S.get(U.outsider, `/api/game-state/${gameId}`);
  assert.equal(outsiderView.status, 403);

  // Out-of-turn player cannot act.
  const notMyTurn = await S.post(oppUserId, '/api/advance-phase', { gameId });
  assert.ok(!notMyTurn.data.success);
  assert.match(notMyTurn.data.error, /Not your turn/);

  // --- walk the current player through their turn until attack, then swing face ---
  const advanceUntil = async (userId, phase) => {
    for (let i = 0; i < 4; i++) {
      const st = await S.get(userId, `/api/game-state/${gameId}`);
      if (st.data.gameState.phase === phase) return st.data.gameState;
      const r = await S.post(userId, '/api/advance-phase', { gameId });
      assert.ok(r.data.success, r.data.error);
      if (r.data.gameState.status === 'completed') return r.data.gameState;
    }
    throw new Error('never reached phase ' + phase);
  };

  const play = async () => {
    // current player loops until their attack phase, then attacks if possible.
    const gs = await advanceUntil(currentUserId, 'attack');
    if (gs.status === 'completed') return gs;
    for (;;) {
      const fresh = await S.get(currentUserId, `/api/game-state/${gameId}`);
      const state = fresh.data.gameState;
      if (state.status === 'completed') return state;
      const myIdx = state.currentTurn;
      const attackerEntry = state.players[myIdx].battlefield
        .map((c, i) => ({ c, i }))
        .find(({ c }) => (c.type === 'creature' || c.type === 'primordial') && (c.canAttack || c.hasHaste));
      if (!attackerEntry) break;
      const oppB = state.players[1 - myIdx].battlefield;
      // Priority rules: primordial first, then creatures, then the player.
      let target = oppB.findIndex((t) => t.type === 'primordial');
      if (target === -1) target = oppB.findIndex((t) => t.type === 'creature');
      const r = target !== -1
        ? await S.post(currentUserId, '/api/attack', { gameId, attackerIndex: attackerEntry.i, targetIndex: target, targetPlayer: false })
        : await S.post(currentUserId, '/api/attack', { gameId, attackerIndex: attackerEntry.i, targetIndex: null, targetPlayer: true });
      assert.ok(r.data.success, r.data.error);
    }
    // end the turn
    const end = await S.post(currentUserId, '/api/advance-phase', { gameId });
    assert.ok(end.data.success, end.data.error);
    return end.data.gameState;
  };

  // Play up to 200 turns until the match completes.
  let final = null;
  for (let turn = 0; turn < 200; turn++) {
    const st = await S.get(currentUserId, `/api/game-state/${gameId}`);
    if (st.data.gameState.status === 'completed') { final = st.data.gameState; break; }
    const next = await play();
    if (next.status === 'completed') { final = next; break; }
    // switch roles
    const tmp = currentUserId; currentUserId = oppUserId; oppUserId = tmp;
  }
  assert.ok(final, 'match should complete within 200 turns');
  assert.ok(final.winner === U.A || final.winner === U.B);

  // --- B (either winner or loser) sees the final state and it matches A ---
  const finalA = await S.get(U.A, `/api/game-state/${gameId}`);
  const finalB = await S.get(U.B, `/api/game-state/${gameId}`);
  assert.equal(finalA.data.gameState.winner, finalB.data.gameState.winner);
  assert.equal(finalA.data.gameState.status, 'completed');
  assert.ok(finalA.data.rewards, 'winner/loser rewards must be reported');
  assert.ok(finalB.data.rewards, 'both players must see their rewards');

  const winner = final.winner;
  const loser = winner === U.A ? U.B : U.A;

  // --- rewards granted exactly once ---
  const winnerBefore = await S.get(winner, `/api/player/${winner}`);
  const loserBefore = await S.get(loser, `/api/player/${loser}`);

  // Re-poll the completed match many times — must never double-grant.
  for (let i = 0; i < 5; i++) {
    await S.get(winner, `/api/game-state/${gameId}`);
    await S.get(loser, `/api/game-state/${gameId}`);
  }

  const winnerAfter = await S.get(winner, `/api/player/${winner}`);
  const loserAfter = await S.get(loser, `/api/player/${loser}`);

  assert.equal(winnerAfter.data.player.coins, winnerBefore.data.player.coins, 'no double coin grants');
  assert.equal(loserAfter.data.player.coins, loserBefore.data.player.coins, 'no double coin grants (loser)');
  assert.equal(winnerAfter.data.player.total_xp, winnerBefore.data.player.total_xp, 'no double XP');
  assert.ok(winnerAfter.data.player.matches_played >= 1);

  // Currency transaction ledger has exactly one reward row per player for this match.
  const tx = await S.fakeDb.collection('currency_transactions')
    .find({ match_id: gameId }).toArray();  assert.equal(tx.length, 2, 'exactly one transaction per player per match');

  // Match history persisted.
  const history = await S.fakeDb.collection('game_matches').findOne({ game_id: gameId });
  assert.ok(history);
  assert.equal(history.status, 'completed');
  assert.equal(history.winner_id, winner);

  // No further actions are accepted on a completed match.
  const zombie = await S.post(winner, '/api/play-card', { gameId, cardIndex: 0 });
  assert.ok(!zombie.data.success);
});

test('duplicate attack request (double-click) does not deal double damage', async () => {
  const match = await S.createMatch(U.A, U.B);
  const gameId = match.gameId;
  try {
    const st = await S.get(U.A, `/api/game-state/${gameId}`);
    const userId = st.data.gameState.currentTurn === match.playerIndex ? U.A : U.B;

    // Move to attack phase.
    let g = st.data.gameState;
    for (let i = 0; i < 3 && g.phase !== 'attack'; i++) {
      const r = await S.post(userId, '/api/advance-phase', { gameId });
      g = r.data.gameState;
    }
    assert.equal(g.phase, 'attack');

    // Deterministic setup: inject a ready attacker directly (white-box) so the
    // duplicate-prevention logic is tested regardless of the random draw.
    const live = S.serverModule.games.get(gameId);
    const meIdx = live.players.findIndex((p) => p.id === userId);
    const oppIdx = 1 - meIdx;
    const attacker = { type: 'creature', name: 'TestKnight', cost: 1, attack: 3, defense: 5, canAttack: true, hasHaste: false };
    live.players[meIdx].battlefield.push(attacker);
    const attackerIndex = live.players[meIdx].battlefield.indexOf(attacker);

    // If the opponent happens to have deployed their Primordial, attacks must
    // target it (priority rules); otherwise go face.
    const kingIdx = live.players[oppIdx].battlefield.findIndex((c) => c.type === 'primordial');
    const hasBlocker = live.players[oppIdx].battlefield.some((c) => c.type === 'primordial' || c.type === 'creature');
    const kingDefenseBefore = kingIdx !== -1 ? live.players[oppIdx].battlefield[kingIdx].defense : null;
    const lifeBefore = live.players[oppIdx].life;

    const r1 = await S.post(userId, '/api/attack', {
      gameId,
      attackerIndex,
      targetIndex: hasBlocker ? kingIdx : null,
      targetPlayer: !hasBlocker,
    });
    assert.ok(r1.data.success, r1.data.error);
    if (hasBlocker) {
      assert.equal(r1.data.gameState.players[oppIdx].battlefield[kingIdx].defense, kingDefenseBefore - 3, 'exactly one instance of damage');
    } else {
      assert.equal(r1.data.gameState.players[oppIdx].life, lifeBefore - 3, 'exactly one instance of damage');
    }
    // Immediate duplicate (double-click / replay): same attacker, same target.
    const r2 = await S.post(userId, '/api/attack', {
      gameId,
      attackerIndex,
      targetIndex: hasBlocker ? kingIdx : null,
      targetPlayer: !hasBlocker,
    });
    assert.ok(!r2.data.success, 'duplicate attack must be rejected');
  } finally {
    await S.post(U.A, '/api/surrender', { gameId });
  }
});

test('refresh/rejoin: a player who reloads rejoins the same match with identical state', async () => {
  const match = await S.createMatch(U.A, U.B);
  const gameId = match.gameId;

  const before = await S.get(U.A, `/api/game-state/${gameId}`);
  // Simulate refresh: brand-new HTTP session, same identity, same gameId.
  const after = await S.get(U.A, `/api/game-state/${gameId}`);
  assert.equal(after.data.gameState.version, before.data.gameState.version);
  assert.equal(after.data.gameState.turnNumber, before.data.gameState.turnNumber);
  assert.deepEqual(after.data.gameState.players[0].hand.length, before.data.gameState.players[0].hand.length);
  // Cleanup: decline/cancel the match so it doesn't interfere with other tests.
  await S.post(U.A, '/api/surrender', { gameId });
});

test('surrender completes the match, grants rewards once, opponent sees it', async () => {
  const match = await S.createMatch(U.A, U.B);
  const gameId = match.gameId;
  const r = await S.post(U.A, '/api/surrender', { gameId });
  assert.ok(r.data.success);
  assert.equal(r.data.gameState.status, 'completed');
  assert.equal(r.data.gameState.winner, U.B);

  // Duplicate surrender is a no-op.
  const r2 = await S.post(U.A, '/api/surrender', { gameId });
  assert.ok(!r2.data.success);

  // B observes the result via polling.
  const bState = await S.get(U.B, `/api/game-state/${gameId}`);
  assert.equal(bState.data.gameState.status, 'completed');
  assert.equal(bState.data.gameState.result, 'surrender');
  assert.ok(bState.data.rewards, 'B must receive their win rewards');

  // B's progression went up exactly once.
  const bProg = await S.get(U.B, `/api/player/${U.B}`);
  assert.ok(bProg.data.player.matches_won >= 1);
});

test('declining a challenge cancels it for both players', async () => {
  await S.joinLobby(U.A, 'Alpha');
  await S.joinLobby(U.B, 'Bravo');
  const ch = await S.post(U.A, '/api/challenge-player', { opponentId: U.B });
  assert.ok(ch.data.success);
  const gameId = ch.data.gameId;

  const dec = await S.post(U.B, '/api/decline-game', { gameId });
  assert.ok(dec.data.success);

  const state = await S.get(U.A, `/api/game-state/${gameId}`);
  assert.ok(!state.data.success, 'game must be gone after decline');
});

test('lobby invitation flow: challenged player sees the game invitation', async () => {
  await S.joinLobby(U.A, 'Alpha');
  await S.joinLobby(U.B, 'Bravo');
  const ch = await S.post(U.A, '/api/challenge-player', { opponentId: U.B });
  assert.ok(ch.data.success);
  const lobbyB = await S.get(U.B, '/api/lobby-players');
  assert.equal(lobbyB.data.status, 'game_ready');
  assert.equal(lobbyB.data.gameInvitation.gameId, ch.data.gameId);
  assert.equal(lobbyB.data.gameInvitation.opponentName, 'Alpha');
  await S.post(U.B, '/api/decline-game', { gameId: ch.data.gameId });
});

test('a player already in a match cannot be challenged again', async () => {
  const match = await S.createMatch(U.A, U.B);
  const gameId = match.gameId;
  await S.joinLobby(U.C, 'Charlie');
  const r = await S.post(U.C, '/api/challenge-player', { opponentId: U.A });
  assert.ok(!r.data.success);
  assert.match(r.data.error, /already in a match/);
  await S.post(U.A, '/api/surrender', { gameId });
});

test('claim-forfeit requires opponent absence and then ends the match', async () => {
  const match = await S.createMatch(U.A, U.B);
  const gameId = match.gameId;
  // Both players just polled -> forfeit unavailable.
  const tooSoon = await S.post(U.A, `/api/match/${gameId}/claim-forfeit`, {});
  assert.ok(!tooSoon.data.success);

  // Simulate B disappearing (backdate lastSeen via engine).
  const g = S.serverModule.games.get(gameId);
  const idxB = g.players.findIndex((p) => p.id === U.B);
  g.players[idxB].lastSeen = Date.now() - 200000;

  const r = await S.post(U.A, `/api/match/${gameId}/claim-forfeit`, {});
  assert.ok(r.data.success, r.data.error);
  assert.equal(r.data.gameState.status, 'completed');
  assert.equal(r.data.gameState.winner, U.A);
  assert.equal(r.data.gameState.result, 'forfeit');
});
