'use strict';

/**
 * Load/stress test for the K&D game server.
 * Boots the production server in test mode (in-memory DB) and drives:
 *   - 100 unauthenticated public requests (health/sets)
 *   - N lobby joins + pair challenges + concurrent matches with rapid actions
 *   - concurrent game-state polling
 * Reports latency percentiles and error counts.
 *
 * Usage: npm run stress [-- --users 50 --matches 25]
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
const USERS = opt('users', 50);
const MATCHES = opt('matches', Math.floor(USERS / 2));

const { createFakeDb } = require('../helpers/fake-mongo');
const fakeDb = createFakeDb();
const mod = require('../../server-production.js');

const latencies = [];
const errors = [];
let requests = 0;

function record(name, ms, ok) {
  requests++;
  latencies.push(ms);
  if (!ok) errors.push(name);
}

async function api(userId, method, path, body) {
  const t0 = performance.now();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer test-${userId}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json();
    record(path, performance.now() - t0, res.status < 500);
    return data;
  } catch (e) {
    record(path, performance.now() - t0, false);
    return null;
  }
}

let port = null;

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function main() {
  await new Promise((res) => {
    if (mod.server.listening) return res();
    mod.server.once('listening', res);
  });
  await new Promise((r) => setTimeout(r, 100));
  mod.__setDbForTests(fakeDb);
  port = mod.server.address().port;
  console.log(`Stress test: ${USERS} users, ${MATCHES} concurrent matches`);

  // Phase 1: 100 unauthenticated public requests fired at once.
  const publicPhase = [];
  for (let i = 0; i < 100; i++) {
    publicPhase.push((async () => {
      const t0 = performance.now();
      try {
        const res = await fetch(`http://127.0.0.1:${port}${i % 2 ? '/health' : '/api/sets'}`);
        await res.json();
        record('public', performance.now() - t0, res.ok);
      } catch (e) {
        record('public', performance.now() - t0, false);
      }
    })());
  }
  await Promise.all(publicPhase);

  // Phase 2: users join the lobby concurrently.
  const userIds = [];
  for (let i = 0; i < USERS; i++) userIds.push(`stress-user-${i.toString().padStart(3, '0')}`);

  const lobbyPhase = userIds.map((u, i) =>
    api(u, 'POST', '/api/join-lobby', { playerName: `Stress${i}` })
  );
  const lobbyResults = await Promise.all(lobbyPhase);
  const lobbyFailures = lobbyResults.filter((r) => !r || !r.success).length;

  // Phase 3: create MATCHES matches concurrently (pairs), then play rapidly.
  const matchPhases = [];
  for (let m = 0; m < MATCHES; m++) {
    const a = userIds[m * 2];
    const b = userIds[m * 2 + 1];
    if (!b) break;
    matchPhases.push((async () => {
      const ch = await api(a, 'POST', '/api/challenge-player', { opponentId: b });
      if (!ch || !ch.success) return;
      const gameId = ch.gameId;

      // Both players poll + rapid-fire actions concurrently.
      const workers = [a, b].map((user) => (async () => {
        for (let i = 0; i < 25; i++) {
          const st = await api(user, 'GET', `/api/game-state/${gameId}`);
          if (!st || !st.success || st.gameState.status === 'completed') break;
          // Aggressive action spam — the server must validate/reject safely.
          await api(user, 'POST', '/api/advance-phase', { gameId });
          await api(user, 'POST', '/api/play-card', { gameId, cardIndex: 0 });
          await api(user, 'POST', '/api/attack', { gameId, attackerIndex: 0, targetIndex: 0, targetPlayer: false });
        }
      })());
      await Promise.all(workers);
    })());
  }
  await Promise.all(matchPhases);

  // Report
  const total = latencies.length;
  const p50 = percentile(latencies, 0.5);
  const p95 = percentile(latencies, 0.95);
  const max = Math.max(...latencies);
  console.log('--- RESULTS ---');
  console.log(`requests: ${total}`);
  console.log(`errors: ${errors.length} (${((errors.length / total) * 100).toFixed(2)}%)`);
  console.log(`lobby join failures: ${lobbyFailures}`);
  console.log(`latency ms p50: ${p50.toFixed(1)}  p95: ${p95.toFixed(1)}  max: ${max.toFixed(1)}`);

  const gamesCreated = mod.games.size;
  const completed = [...mod.games.values()].filter((g) => g.status === 'completed').length;
  console.log(`games in memory: ${gamesCreated} (completed: ${completed})`);
  console.log(`currency transactions written: ${fakeDb.__collections.get('currency_transactions') ? fakeDb.__collections.get('currency_transactions')._docs().length : 0}`);

  const ok = errors.length === 0 && lobbyFailures === 0 && total > 0 && p95 < 1000;
  console.log(ok ? 'STRESS TEST PASS' : 'STRESS TEST FAIL');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('Stress test crashed:', e);
  process.exit(1);
});
