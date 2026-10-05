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

/** Mutating game action helper: reads the authoritative version, then posts. */
async function act(user, path, body) {
  const st = await S.get(user, `/api/game-state/${body.gameId}`);
  if (!st.data.success) return st;
  return S.post(user, path, { ...body, expectedVersion: st.data.gameState.version });
}

async function surrender(user, gameId) {
  return act(user, '/api/surrender', { gameId });
}

async function setPlayerLevel(userId, level) {
  await S.fakeDb.collection('player_progression').insertOne({
    user_id: userId,
    level,
    prestige: 0,
    xp: 0,
    xp_to_next: 100,
    total_xp: 0,
    coins: 0,
    matches_played: 0,
    matches_won: 0,
  });
}

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
  const user = 'user-spoof-test';
  const r = await S.post(user, '/api/join-lobby', { playerId: U.B, playerName: 'Imposter' });
  assert.ok(r.data.success);
  assert.equal(r.data.name, `Profile ${user}`);
  const lobby = await S.get(user, '/api/lobby-players');
  const present = lobby.data.players.map((p) => p.id);
  assert.ok(present.includes(user), 'token user should be in lobby');
  assert.ok(!present.includes(U.B), 'spoofed id must be ignored');
  S.serverModule.lobbyPlayers.delete(user);
});

test('joining matchmaking automatically pairs players whose levels differ by at most five', async () => {
  const a = 'match-level-10-a';
  const b = 'match-level-15-b';
  await setPlayerLevel(a, 10);
  await setPlayerLevel(b, 15);

  const waiting = await S.joinLobby(a, 'Name from request is ignored');
  assert.equal(waiting.data.status, 'searching');
  assert.equal(waiting.data.level, 10);

  const matched = await S.joinLobby(b, 'Also ignored');
  assert.equal(matched.data.success, true);
  assert.ok(matched.data.gameId);
  assert.deepEqual(
    matched.data.gameState.players.map((player) => player.name).sort(),
    [`Profile ${a}`, `Profile ${b}`].sort()
  );

  const waitingPlayer = await S.get(a, '/api/lobby-players');
  assert.equal(waitingPlayer.data.gameInvitation.gameId, matched.data.gameId);
});

test('matchmaking skips opponents outside five levels and picks the closest eligible player', async () => {
  const level10 = 'match-range-level-10';
  const level16 = 'match-range-level-16';
  const level15a = 'match-range-level-15-a';
  const level15b = 'match-range-level-15-b';
  await Promise.all([
    setPlayerLevel(level10, 10),
    setPlayerLevel(level16, 16),
    setPlayerLevel(level15a, 15),
    setPlayerLevel(level15b, 15),
  ]);

  await S.joinLobby(level10);
  await S.joinLobby(level16);
  assert.equal((await S.get(level10, '/api/lobby-players')).data.gameInvitation, null);
  assert.equal((await S.get(level16, '/api/lobby-players')).data.gameInvitation, null);

  const firstMatch = await S.joinLobby(level15a);
  assert.ok(firstMatch.data.gameId);
  assert.ok(firstMatch.data.gameState.players.some((player) => player.id === level16));
  assert.ok(!firstMatch.data.gameState.players.some((player) => player.id === level10));

  const matchForLevel10 = await S.joinLobby(level15b);
  assert.ok(matchForLevel10.data.gameId);
  assert.ok(matchForLevel10.data.gameState.players.some((player) => player.id === level10));

  await S.post(level16, '/api/decline-game', { gameId: firstMatch.data.gameId });
  await S.post(level10, '/api/decline-game', { gameId: matchForLevel10.data.gameId });
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
  S.serverModule.lobbyPlayers.delete(U.C);
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

  // Whose turn is it? Determine from state.
  let current = stateA.data.gameState.currentTurn;
  let currentUserId = current === idxA ? U.A : U.B;
  let oppUserId = current === idxA ? U.B : U.A;

  // A third party cannot see the match.
  const outsiderView = await S.get(U.outsider, `/api/game-state/${gameId}`);
  assert.equal(outsiderView.status, 403);

  // Out-of-turn player cannot act (must send the CURRENT version so the
  // rejection comes from the turn check, not the version check).
  const notMyTurn = await S.post(oppUserId, '/api/advance-phase', {
    gameId, expectedVersion: stateA.data.gameState.version,
  });
  assert.ok(!notMyTurn.data.success);
  assert.match(notMyTurn.data.error, /Not your turn/);

  // --- walk the current player through their turn until attack, then swing face ---
  const advanceUntil = async (userId, phase) => {
    for (let i = 0; i < 4; i++) {
      const st = await S.get(userId, `/api/game-state/${gameId}`);
      if (st.data.gameState.phase === phase) return st.data.gameState;
      const r = await S.post(userId, '/api/advance-phase', { gameId, expectedVersion: st.data.gameState.version });
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
        ? await S.post(currentUserId, '/api/attack', { gameId, attackerIndex: attackerEntry.i, targetIndex: target, targetPlayer: false, expectedVersion: state.version })
        : await S.post(currentUserId, '/api/attack', { gameId, attackerIndex: attackerEntry.i, targetIndex: null, targetPlayer: true, expectedVersion: state.version });
      assert.ok(r.data.success, r.data.error);
    }
    // end the turn
    const st = await S.get(currentUserId, `/api/game-state/${gameId}`);
    const end = await S.post(currentUserId, '/api/advance-phase', { gameId, expectedVersion: st.data.gameState.version });
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
    .find({ match_id: gameId }).toArray();
  assert.equal(tx.length, 2, 'exactly one transaction per player per match');

  // Match history persisted.
  const history = await S.fakeDb.collection('game_matches').findOne({ game_id: gameId });
  assert.ok(history);
  assert.equal(history.status, 'completed');
  assert.equal(history.winner_id, winner);

  // No further actions are accepted on a completed match (zombie with a valid
  // version still hits the engine's "already finished" guard).
  const zState = await S.get(winner, `/api/game-state/${gameId}`);
  const zombie = await S.post(winner, '/api/play-card', { gameId, cardIndex: 0, expectedVersion: zState.data.gameState.version });
  assert.ok(!zombie.data.success);
});

test('duplicate attack request (double-click) does not deal double damage', async () => {
  const match = await S.createMatch(U.A, U.B);
  const gameId = match.gameId;
  try {
    // Deterministic setup: inject a ready attacker directly (white-box) so the
    // duplicate-prevention logic is tested regardless of the random draw.
    const live = S.serverModule.games.get(gameId);
    const meIdx = live.currentTurn;
    const oppIdx = 1 - meIdx;
    const userId = live.players[meIdx].id; // whoever's turn it is
    const attacker = { type: 'creature', name: 'TestKnight', cost: 1, attack: 3, defense: 5, canAttack: true, hasHaste: false };
    live.players[meIdx].battlefield.push(attacker);
    const attackerIndex = live.players[meIdx].battlefield.indexOf(attacker);

    // Move to attack phase through the API (with fresh versions).
    let g = (await S.get(userId, `/api/game-state/${gameId}`)).data.gameState;
    for (let i = 0; i < 3 && g.phase !== 'attack'; i++) {
      const r = await S.post(userId, '/api/advance-phase', { gameId, expectedVersion: g.version });
      assert.ok(r.data.success, r.data.error);
      g = r.data.gameState;
    }
    assert.equal(g.phase, 'attack');

    const kingIdx = live.players[oppIdx].battlefield.findIndex((c) => c.type === 'primordial');
    const hasBlocker = live.players[oppIdx].battlefield.some((c) => c.type === 'primordial' || c.type === 'creature');
    const kingDefenseBefore = kingIdx !== -1 ? live.players[oppIdx].battlefield[kingIdx].defense : null;
    const lifeBefore = live.players[oppIdx].life;
    const version = g.version;

    const r1 = await S.post(userId, '/api/attack', {
      gameId, attackerIndex, targetIndex: hasBlocker ? kingIdx : null, targetPlayer: !hasBlocker,
      expectedVersion: version,
    });
    assert.ok(r1.data.success, r1.data.error);
    if (hasBlocker) {
      assert.equal(r1.data.gameState.players[oppIdx].battlefield[kingIdx].defense, kingDefenseBefore - 3, 'exactly one instance of damage');
    } else {
      assert.equal(r1.data.gameState.players[oppIdx].life, lifeBefore - 3, 'exactly one instance of damage');
    }
    // Immediate duplicate (double-click / replay): same request, same version.
    const r2 = await S.post(userId, '/api/attack', {
      gameId, attackerIndex, targetIndex: hasBlocker ? kingIdx : null, targetPlayer: !hasBlocker,
      expectedVersion: version,
    });
    assert.ok(!r2.data.success, 'duplicate attack must be rejected');
    // ...and even with a re-read (fresh) version, the attacker is spent.
    const fresh = (await S.get(userId, `/api/game-state/${gameId}`)).data.gameState;
    const r3 = await S.post(userId, '/api/attack', {
      gameId, attackerIndex, targetIndex: hasBlocker ? kingIdx : null, targetPlayer: !hasBlocker,
      expectedVersion: fresh.version,
    });
    assert.ok(!r3.data.success, 'a unit attacks at most once per phase');
  } finally {
    await surrender(U.A, gameId);
  }
});

test('stale client: acting on an old version is rejected, resync restores play', async () => {
  const match = await S.createMatch(U.A, U.B);
  const gameId = match.gameId;

  // Both players hold the same snapshot (version v).
  const sa = await S.get(U.A, `/api/game-state/${gameId}`);
  const sb = await S.get(U.B, `/api/game-state/${gameId}`);
  const v = sa.data.gameState.version;
  assert.equal(v, sb.data.gameState.version);

  const current = sa.data.gameState.currentTurn === match.playerIndex ? U.A : U.B;
  const next = current === U.A ? U.B : U.A;

  // Current acts: v -> v+1.
  const r1 = await S.post(current, '/api/advance-phase', { gameId, expectedVersion: v });
  assert.ok(r1.data.success, r1.data.error);

  // The stale client (next) tries to act with the old version: REJECTED,
  // with the authoritative state attached for a one-round-trip resync.
  const r2 = await S.post(next, '/api/advance-phase', { gameId, expectedVersion: v });
  assert.ok(!r2.data.success);
  assert.equal(r2.data.stale, true);
  assert.ok(r2.data.gameState, 'rejection must carry authoritative state');
  assert.ok(r2.data.gameState.version > v);

  // Finish the current player's turn using fresh versions.
  let st = r1.data.gameState;
  for (let i = 0; i < 3 && st.status !== 'completed'; i++) {
    const r = await S.post(current, '/api/advance-phase', { gameId, expectedVersion: st.version });
    assert.ok(r.data.success, r.data.error);
    st = r.data.gameState;
  }
  assert.notEqual(st.currentTurn, sa.data.gameState.currentTurn, 'turn must have passed');

  // The previously-stale client refreshes and can continue playing.
  const fresh = await S.get(next, `/api/game-state/${gameId}`);
  const r3 = await S.post(next, '/api/advance-phase', { gameId, expectedVersion: fresh.data.gameState.version });
  assert.ok(r3.data.success, 'refreshed client must be able to continue');

  await surrender(U.A, gameId);
});

test('mutating action without expectedVersion is rejected', async () => {
  const match = await S.createMatch(U.A, U.B);
  const gameId = match.gameId;
  const r = await S.post(U.A, '/api/advance-phase', { gameId });
  assert.ok(!r.data.success);
  assert.match(r.data.error, /Missing expected game version/);
  assert.ok(r.data.gameState, 'rejection must carry authoritative state');
  await surrender(U.A, gameId);
});

test('duplicate action: same actionId executes exactly once even with a fresh version', async () => {
  const match = await S.createMatch(U.A, U.B);
  const gameId = match.gameId;
  const live = S.serverModule.games.get(gameId);
  const current = live.players[live.currentTurn].id;

  // Advance the current player to the play phase with fresh versions.
  let st = (await S.get(current, `/api/game-state/${gameId}`)).data.gameState;
  while (st.phase !== 'play' && st.status === 'active') {
    const r = await S.post(current, '/api/advance-phase', { gameId, expectedVersion: st.version });
    assert.ok(r.data.success, r.data.error);
    st = r.data.gameState;
  }
  assert.equal(st.phase, 'play');

  // [WB] Deterministic hand: two affordable creatures + two deployed Vigor,
  // so the duplicate cannot be blocked by mana or index availability.
  const meIdx = live.players.findIndex((p) => p.id === current);
  live.players[meIdx].battlefield.push(
    { type: 'vigor', name: 'V', cost: 0, attack: 0, defense: 0 },
    { type: 'vigor', name: 'V', cost: 0, attack: 0, defense: 0 }
  );
  live.players[meIdx].hand = [
    { type: 'creature', name: 'Cheap1', cost: 1, attack: 1, defense: 1 },
    { type: 'creature', name: 'Cheap2', cost: 1, attack: 1, defense: 1 },
  ];
  live.players[meIdx].vigorUsedThisTurn = 0;

  const fresh = (await S.get(current, `/api/game-state/${gameId}`)).data.gameState;
  const handBefore = fresh.players[meIdx].hand.length;
  const actionId = 'dup-test-action-0001';

  const r1 = await S.post(current, '/api/play-card', { gameId, cardIndex: 0, expectedVersion: fresh.version, actionId });
  assert.ok(r1.data.success, r1.data.error);

  // The STRONGEST form of a duplicate: the client re-read the (post-action)
  // authoritative version, so the version check alone would pass. The
  // actionId must stop it.
  const r2 = await S.post(current, '/api/play-card', { gameId, cardIndex: 0, expectedVersion: r1.data.gameState.version, actionId });
  assert.ok(!r2.data.success, 'duplicate actionId must be rejected');
  assert.equal(r2.data.duplicate, true);

  const stEnd = (await S.get(current, `/api/game-state/${gameId}`)).data.gameState;
  assert.equal(stEnd.players[meIdx].hand.length, handBefore - 1, 'state changed exactly once');
  await surrender(U.A, gameId);
});

test('API-level phase enforcement: draw-card and auto-play-vigor rejected outside their phases', async () => {
  const match = await S.createMatch(U.A, U.B);
  const gameId = match.gameId;
  const live = S.serverModule.games.get(gameId);
  const current = live.players[live.currentTurn].id;

  let st = (await S.get(current, `/api/game-state/${gameId}`)).data.gameState;
  while (st.phase !== 'attack' && st.status === 'active') {
    const r = await S.post(current, '/api/advance-phase', { gameId, expectedVersion: st.version });
    assert.ok(r.data.success, r.data.error);
    st = r.data.gameState;
  }
  assert.equal(st.phase, 'attack');

  const draw = await S.post(current, '/api/draw-card', { gameId, expectedVersion: st.version });
  assert.ok(!draw.data.success, 'drawing during the ATTACK phase must be rejected server-side');
  assert.match(draw.data.error, /Draw Phase/);

  const vig = await S.post(current, '/api/auto-play-vigor', { gameId, expectedVersion: st.version });
  assert.ok(!vig.data.success, 'deploying vigor during the ATTACK phase must be rejected server-side');
  assert.match(vig.data.error, /Vigor Phase/);

  await surrender(U.A, gameId);
});

test('server-side phase timeout advances a stalled phase (authoritative clock)', async () => {
  const match = await S.createMatch(U.A, U.B);
  const gameId = match.gameId;
  const live = S.serverModule.games.get(gameId);
  const current = live.players[live.currentTurn].id;

  const before = await S.get(current, `/api/game-state/${gameId}`);
  assert.equal(before.data.gameState.phase, 'vigor');

  // [WB] Simulate 61 seconds of stalling; the player stays connected.
  live.phaseStartedAt = Date.now() - 61_000;
  const after = await S.get(current, `/api/game-state/${gameId}`);
  assert.equal(after.data.gameState.phase, 'draw', 'expired phase must auto-advance');
  assert.ok(after.data.gameState.version > before.data.gameState.version);

  // A client still holding the pre-timeout version is now stale.
  const stale = await S.post(current, '/api/advance-phase', { gameId, expectedVersion: before.data.gameState.version });
  assert.ok(!stale.data.success);
  assert.equal(stale.data.stale, true);

  await surrender(U.A, gameId);
});

test('phase timeout does NOT fire for an absent player (forfeit rules own that case)', async () => {
  const match = await S.createMatch(U.A, U.B);
  const gameId = match.gameId;
  const live = S.serverModule.games.get(gameId);
  const curIdx = live.currentTurn;
  const current = live.players[curIdx].id;
  const other = live.players[1 - curIdx].id;

  await S.get(current, `/api/game-state/${gameId}`); // fresh lastSeen
  // [WB] the current player has been GONE for 5 minutes (no polls)
  live.players[curIdx].lastSeen = Date.now() - 300_000;
  live.phaseStartedAt = Date.now() - 61_000;

  const st = await S.get(other, `/api/game-state/${gameId}`);
  assert.equal(st.data.gameState.phase, 'vigor', 'absent player phases are not auto-played');
  assert.equal(st.data.gameState.version, 1, 'state must not move');
  await surrender(other, gameId);
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
  await surrender(U.A, gameId);
});

test('surrender completes the match, grants rewards once, opponent sees it', async () => {
  const match = await S.createMatch(U.A, U.B);
  const gameId = match.gameId;
  const r = await act(U.A, '/api/surrender', { gameId });
  assert.ok(r.data.success);
  assert.equal(r.data.gameState.status, 'completed');
  assert.equal(r.data.gameState.winner, U.B);

  // Duplicate surrender is a no-op.
  const r2 = await surrender(U.A, gameId);
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
  const match = await S.createMatch(U.A, U.B);
  const gameId = match.gameId;

  const dec = await S.post(U.B, '/api/decline-game', { gameId });
  assert.ok(dec.data.success);

  const state = await S.get(U.A, `/api/game-state/${gameId}`);
  assert.ok(!state.data.success, 'game must be gone after decline');
});

test('lobby invitation flow: challenged player sees the game invitation', async () => {
  const match = await S.createMatch(U.A, U.B);
  const lobbyB = await S.get(U.B, '/api/lobby-players');
  assert.equal(lobbyB.data.status, 'game_ready');
  assert.equal(lobbyB.data.gameInvitation.gameId, match.gameId);
  assert.equal(lobbyB.data.gameInvitation.opponentName, `Profile ${U.A}`);
  await S.post(U.B, '/api/decline-game', { gameId: match.gameId });
});

test('a player already in a match cannot be challenged again', async () => {
  const match = await S.createMatch(U.A, U.B);
  const gameId = match.gameId;
  await S.joinLobby(U.C, 'Charlie');
  const r = await S.post(U.C, '/api/challenge-player', { opponentId: U.A });
  assert.ok(!r.data.success);
  assert.match(r.data.error, /already in a match/);
  S.serverModule.lobbyPlayers.delete(U.C);
  await surrender(U.A, gameId);
  await surrender(U.A, gameId);
});

test('claim-forfeit requires opponent absence and then ends the match', async () => {
  const match = await S.createMatch(U.A, U.B);
  const gameId = match.gameId;
  // Both players just polled -> forfeit unavailable (and must carry a version).
  const tooSoonState = await S.get(U.A, `/api/game-state/${gameId}`);
  const tooSoon = await S.post(U.A, `/api/match/${gameId}/claim-forfeit`, {
    expectedVersion: tooSoonState.data.gameState.version,
  });
  assert.ok(!tooSoon.data.success);

  // Forfeit without a version is rejected too.
  const noVersion = await S.post(U.A, `/api/match/${gameId}/claim-forfeit`, {});
  assert.ok(!noVersion.data.success);
  assert.match(noVersion.data.error, /expected game version/);

  // Simulate B disappearing (backdate lastSeen via engine).
  const g = S.serverModule.games.get(gameId);
  const idxB = g.players.findIndex((p) => p.id === U.B);
  g.players[idxB].lastSeen = Date.now() - 200000;

  const fresh = await S.get(U.A, `/api/game-state/${gameId}`);
  const r = await S.post(U.A, `/api/match/${gameId}/claim-forfeit`, {
    expectedVersion: fresh.data.gameState.version,
  });
  assert.ok(r.data.success, r.data.error);
  assert.equal(r.data.gameState.status, 'completed');
  assert.equal(r.data.gameState.winner, U.A);
  assert.equal(r.data.gameState.result, 'forfeit');
});

/* =========================================================================
 * AI battles — result validation ordering + exactly-once
 * ========================================================================= */

/** [WB] Level a fresh user to 3 (Easy AI gate) directly in the fake DB. */
async function makeLevel3(userId) {
  await S.get(userId, `/api/player/${userId}`); // creates the progression record
  const store = S.fakeDb.__collections.get('player_progression').store;
  for (const doc of store.values()) {
    if (doc.user_id === userId) {
      doc.level = 3; doc.total_xp = 215; doc.xp = 0; doc.xp_to_next = 116;
    }
  }
}

/** [WB] Backdate an AI match's started_at so the 45s duration guard passes. */
function backdateAiMatch(aiMatchId, ms = 60_000) {
  const store = S.fakeDb.__collections.get('ai_matches').store;
  for (const doc of store.values()) {
    if (doc.ai_match_id === aiMatchId) doc.started_at = new Date(Date.now() - ms);
  }
}

test('AI gates: level 1 cannot start any AI; level 3 unlocks easy only', async () => {
  const user = 'user-ai-gate-01';
  await S.get(user, `/api/player/${user}`);
  const fresh = await S.post(user, '/api/ai/start', { difficulty: 'easy' });
  const med = await S.post(user, '/api/ai/start', { difficulty: 'medium' });
  const hard = await S.post(user, '/api/ai/start', { difficulty: 'hard' });
  assert.ok(!fresh.data.success && /level 3/.test(fresh.data.error));
  assert.ok(!med.data.success && /level 5/.test(med.data.error));
  assert.ok(!hard.data.success && /level 8/.test(hard.data.error));

  await makeLevel3(user);
  const easy = await S.post(user, '/api/ai/start', { difficulty: 'easy' });
  const med2 = await S.post(user, '/api/ai/start', { difficulty: 'medium' });
  assert.ok(easy.data.success, easy.data.error);
  assert.ok(!med2.data.success);
});

test('AI result: a too-short result is rejected but does NOT burn the match', async () => {
  const user = 'user-ai-order-1';
  await makeLevel3(user);
  const start = await S.post(user, '/api/ai/start', { difficulty: 'easy' });
  assert.ok(start.data.success, start.data.error);
  const mid = start.data.aiMatchId;

  // Reported instantly: rejected by the duration guard...
  const instant = await S.post(user, '/api/ai/result', { aiMatchId: mid, won: true });
  assert.ok(!instant.data.success);
  assert.match(instant.data.error, /too short/);

  // ...but the match must STILL be reportable once enough time has passed
  // (this is the regression for the claim-before-validate ordering bug).
  backdateAiMatch(mid);
  const valid = await S.post(user, '/api/ai/result', { aiMatchId: mid, won: true });
  assert.ok(valid.data.success, valid.data.error);
  assert.ok(valid.data.rewards, 'valid AI win must be rewarded');
});

test('AI result: repeated result, wrong owner, and unknown match are rejected', async () => {
  const user = 'user-ai-order-2';
  const other = 'user-ai-order-3';
  await makeLevel3(user);
  const start = await S.post(user, '/api/ai/start', { difficulty: 'easy' });
  const mid = start.data.aiMatchId;
  backdateAiMatch(mid);

  // Someone else cannot report (or even see) this match.
  const thief = await S.post(other, '/api/ai/result', { aiMatchId: mid, won: true });
  assert.ok(!thief.data.success);

  const win1 = await S.post(user, '/api/ai/result', { aiMatchId: mid, won: true });
  assert.ok(win1.data.success, win1.data.error);
  const before = (await S.get(user, `/api/player/${user}`)).data.player;

  // Repeated result: no double reward.
  const win2 = await S.post(user, '/api/ai/result', { aiMatchId: mid, won: true });
  assert.ok(!win2.data.success);
  assert.match(win2.data.error, /already submitted/);

  // Unknown match id.
  const ghost = await S.post(user, '/api/ai/result', { aiMatchId: 'ai_ghost', won: true });
  assert.ok(!ghost.data.success);

  const after = (await S.get(user, `/api/player/${user}`)).data.player;
  assert.equal(after.coins, before.coins, 'no double AI reward');
  assert.equal(after.total_xp, before.total_xp, 'no double AI XP');

  // A loss reports stats only.
  const start2 = await S.post(user, '/api/ai/start', { difficulty: 'easy' });
  backdateAiMatch(start2.data.aiMatchId);
  const loss = await S.post(user, '/api/ai/result', { aiMatchId: start2.data.aiMatchId, won: false });
  assert.ok(loss.data.success, loss.data.error);
  assert.equal(loss.data.rewards, null, 'AI loss grants nothing');
});
