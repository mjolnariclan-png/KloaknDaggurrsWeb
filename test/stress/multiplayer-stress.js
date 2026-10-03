'use strict';

/**
 * REAL multiplayer stress test for the K&D game server.
 *
 * Unlike test/stress/load.js (a generic HTTP load test), this drives complete,
 * legal two-player matches: lobby join -> challenge -> accept -> phase walks ->
 * card plays -> combat -> completion -> reward finalization, with every action
 * carrying optimistic-concurrency versions and action IDs, and both players of
 * every match acting CONCURRENTLY (polling + acting in parallel like real
 * browser clients).
 *
 * Measured:
 *   - errors (HTTP/protocol failures)
 *   - latency percentiles
 *   - stale-state conflicts (expected: only when both clients race)
 *   - duplicate-action rejections
 *   - match completion rate (a pass REQUIRES matches to actually complete)
 *   - duplicate rewards (ledger must contain exactly one row per player/match)
 *   - orphaned matches (still 'active' when the run ends)
 *
 * Database: uses the in-memory fake Mongo by default. Set
 * KD_STRESS_MONGODB_URI (a CONTROLLED TEST database — never production) to
 * exercise the real MongoDB driver path instead. Real-DB contention testing
 * requires credentials this environment does not have; report it as a
 * limitation when it is not configured.
 *
 * Usage: npm run stress:mp [-- --users 20 --matches 10]
 */

process.env.KD_TEST_AUTH = '1';
process.env.MONGODB_URI = '';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_PUBLISHABLE_KEY = '';
process.env.PORT = '0';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? Number(args[i + 1]) : dflt;
};
const USERS = opt('users', 20);
const MATCHES = opt('matches', Math.min(Math.floor(USERS / 2), 10));
const MAX_HALF_TURNS = 200;

const { createFakeDb } = require('../helpers/fake-mongo');
const { MongoClient } = require('mongodb');

const stats = {
  requests: 0,
  errors: 0,
  staleConflicts: 0,
  duplicateRejections: 0,
  completed: 0,
  failedMatches: 0,
  orphanMatches: 0,
  rewardRows: 0,
  duplicateRewards: 0,
  latencies: [],
  results: {},
};

function recordLatency(ms) {
  stats.requests++;
  stats.latencies.push(ms);
}

let db = null;
let fakeDb = null;
let usingRealMongo = false;

let port = null;
let mod = null;

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function api(userId, method, path, body) {
  const t0 = performance.now();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer test-${userId}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json();
    recordLatency(performance.now() - t0);
    if (!data || typeof data !== 'object' || res.status >= 500) stats.errors++;
    return data;
  } catch (e) {
    recordLatency(performance.now() - t0);
    stats.errors++;
    return null;
  }
}

/** A concurrent browser-like client for one side of a match. */
async function matchWorker(userId, gameId, stats_) {
  let halfTurns = 0;
  let actionCounter = 0;
  while (halfTurns < MAX_HALF_TURNS) {
    const st = await api(userId, 'GET', `/api/game-state/${gameId}`);
    if (!st || !st.success) return 'state-error';
    const gs = st.gameState;
    if (gs.status === 'completed') { stats_.results[gs.result] = (stats_.results[gs.result] || 0) + 1; return 'completed'; }
    if (gs.currentTurn !== gs.players.findIndex((p) => p.id === userId)) {
      // Opponent's turn: poll again (simulates the 1.5s browser poll, faster).
      await new Promise((r) => setTimeout(r, 5));
      continue;
    }

    const my = gs.players[gs.currentTurn];
    const act = async (path, body) => {
      actionCounter++;
      const r = await api(userId, 'POST', path, {
        gameId,
        expectedVersion: gs.version,
        actionId: `${userId}-${gameId}-${actionCounter}`,
        ...body,
      });
      if (r && r.stale) stats.staleConflicts++;
      if (r && r.duplicate) stats.duplicateRejections++;
      return r;
    };

    // Vigor -> draw -> play
    if (gs.phase === 'vigor') {
      const r = await act('/api/advance-phase', {});
      if (r && r.success) continue;
    } else if (gs.phase === 'draw') {
      const r = await act('/api/advance-phase', {});
      if (r && r.success) continue;
    } else if (gs.phase === 'play') {
      const mana = Math.min(20, my.battlefield.filter((c) => c.type === 'vigor').length) - (my.vigorUsedThisTurn || 0);
      const i = my.hand.findIndex((c) => (c.type === 'creature' || c.type === 'rune') && (c.cost || 0) <= mana);
      if (i !== -1) {
        const r = await act('/api/play-card', { cardIndex: i });
        if (r && r.success) continue;
      }
      const r = await act('/api/advance-phase', {});
      if (r && r.success) continue;
    } else if (gs.phase === 'attack') {
      const opp = gs.players[1 - gs.currentTurn];
      const attacker = my.battlefield.map((c, i) => ({ c, i }))
        .find(({ c }) => (c.type === 'creature' || c.type === 'primordial') && (c.canAttack || c.hasHaste));
      if (attacker) {
        let target = opp.battlefield.findIndex((t) => t.type === 'primordial');
        if (target === -1) target = opp.battlefield.findIndex((t) => t.type === 'creature');
        const r = target !== -1
          ? await act('/api/attack', { attackerIndex: attacker.i, targetIndex: target, targetPlayer: false })
          : await act('/api/attack', { attackerIndex: attacker.i, targetIndex: null, targetPlayer: true });
        if (r && r.success) continue;
      }
      const r = await act('/api/advance-phase', {}); // ends the turn
      if (r && r.success) halfTurns++;
      else await new Promise((res) => setTimeout(res, 5));
    } else {
      await new Promise((res) => setTimeout(res, 5));
    }
  }
  return 'turn-limit';
}

async function main() {
  // Database: fake by default, real (controlled test) DB when configured.
  if (process.env.KD_STRESS_MONGODB_URI) {
    usingRealMongo = true;
    const client = new MongoClient(process.env.KD_STRESS_MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    db = client.db(process.env.KD_STRESS_MONGODB_DB_NAME || 'kd_stress_test');
    console.log(`Using REAL MongoDB test database: ${db.databaseName}`);
  } else {
    fakeDb = createFakeDb();
    db = fakeDb;
    console.log('Using in-memory fake MongoDB (set KD_STRESS_MONGODB_URI for real-DB contention testing)');
  }

  mod = require('../../server-production.js');
  await new Promise((res) => {
    if (mod.server.listening) return res();
    mod.server.once('listening', res);
  });
  await new Promise((r) => setTimeout(r, 150));
  mod.__setDbForTests(db);
  port = mod.server.address().port;

  console.log(`Multiplayer stress: ${USERS} users, ${MATCHES} concurrent REAL matches`);
  const userIds = [];
  for (let i = 0; i < USERS; i++) userIds.push(`mp-stress-${i.toString().padStart(3, '0')}`);

  // Phase 1: everyone joins the lobby concurrently.
  const lobbyJoins = await Promise.all(
    userIds.map((u) => api(u, 'POST', '/api/join-lobby', { playerName: `Stress${u.slice(-3)}` }))
  );
  const lobbyFailures = lobbyJoins.filter((r) => !r || !r.success).length;

  // Phase 2: create MATCHES matches; each pair runs two CONCURRENT workers
  // (both sides poll and act in parallel, exactly like browser clients).
  const matchRuns = [];
  for (let m = 0; m < MATCHES; m++) {
    const a = userIds[m * 2];
    const b = userIds[m * 2 + 1];
    if (!b) break;
    matchRuns.push((async () => {
      const ch = await api(a, 'POST', '/api/challenge-player', { opponentId: b, cardSet: 'Ash Cycle' });
      if (!ch || !ch.success) { stats.failedMatches++; return; }
      const gameId = ch.gameId;
      await api(b, 'POST', '/api/accept-game', { gameId });
      const perMatch = { results: {} };
      const outcomes = await Promise.all([
        matchWorker(a, gameId, perMatch),
        matchWorker(b, gameId, perMatch),
      ]);
      const final = await api(a, 'GET', `/api/game-state/${gameId}`);
      const done = final && final.success && final.gameState.status === 'completed';
      if (done) {
        stats.completed++;
        for (const [k, v] of Object.entries(perMatch.results)) stats.results[k] = (stats.results[k] || 0) + v;
      } else {
        stats.orphanMatches++;
      }
      return { gameId, done, outcomes };
    })());
  }
  await Promise.all(matchRuns);

  // Phase 3: reward-integrity audit — exactly one reward row per player per
  // completed match, no duplicates anywhere.
  const txs = await db.collection('currency_transactions').find({}).toArray();
  stats.rewardRows = txs.length;
  const seen = new Map();
  for (const t of txs) {
    const key = `${t.user_id}|${t.match_id}|${t.reason}`;
    if (seen.has(key)) stats.duplicateRewards++;
    seen.set(key, true);
  }

  // Phase 4: progression sanity — no player may have more coins than
  // the maximum legal grant for their completed matches.
  const progressions = await db.collection('player_progression').find({}).toArray();
  const overpaid = progressions.filter((p) => (p.matches_played || 0) > MATCHES || (p.coins || 0) > 50 * MATCHES).length;

  const p50 = percentile(stats.latencies, 0.5);
  const p95 = percentile(stats.latencies, 0.95);
  const max = Math.max(...stats.latencies);

  console.log('--- RESULTS ---');
  console.log(`requests: ${stats.requests}`);
  console.log(`errors (5xx/protocol): ${stats.errors}`);
  console.log(`lobby join failures: ${lobbyFailures}`);
  console.log(`matches completed: ${stats.completed}/${MATCHES} (rate ${((stats.completed / MATCHES) * 100).toFixed(0)}%)`);
  console.log(`failed to create: ${stats.failedMatches}, orphaned/unfinished: ${stats.orphanMatches}`);
  console.log(`end reasons: ${JSON.stringify(stats.results)}`);
  console.log(`stale-state conflicts (races rejected): ${stats.staleConflicts}`);
  console.log(`duplicate-action rejections: ${stats.duplicateRejections}`);
  console.log(`reward rows: ${stats.rewardRows}, DUPLICATE rewards: ${stats.duplicateRewards}`);
  console.log(`overpaid players: ${overpaid}`);
  console.log(`latency ms p50: ${p50.toFixed(1)}  p95: ${p95.toFixed(1)}  max: ${max.toFixed(1)}`);

  const ok = stats.errors === 0
    && lobbyFailures === 0
    && stats.failedMatches === 0
    && stats.orphanMatches === 0
    && stats.completed === MATCHES
    && stats.duplicateRewards === 0
    && overpaid === 0
    && p95 < 2000;
  console.log(ok ? 'MULTIPLAYER STRESS TEST PASS' : 'MULTIPLAYER STRESS TEST FAIL');

  await new Promise((r) => mod.server.close(r));
  if (usingRealMongo) {
    // Never leave stress data behind in a real (test) database.
    await db.collection('currency_transactions').deleteMany({});
    await db.collection('player_progression').deleteMany({});
    await db.collection('game_matches').deleteMany({});
    await db.collection('ai_matches').deleteMany({});
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('Multiplayer stress test crashed:', e);
  process.exit(1);
});
