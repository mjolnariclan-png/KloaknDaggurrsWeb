'use strict';

/**
 * Boots one shared instance of the production server in test mode.
 * - KD_TEST_AUTH=1: Bearer test-<uuid> tokens map to user <uuid>.
 * - No MONGODB_URI: the server never touches any real database.
 * - The DB handle is swapped for an in-memory fake.
 */

process.env.KD_TEST_AUTH = '1';
process.env.MONGODB_URI = '';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_PUBLISHABLE_KEY = '';
process.env.PORT = '0';
process.env.ALLOWED_ORIGINS = 'http://127.0.0.1';

const { createFakeDb } = require('./fake-mongo');

const fakeDb = createFakeDb();
const mod = require('../../server-production.js');

let _readyPromise = null;
let _port = null;

async function ready() {
  if (!_readyPromise) {
    _readyPromise = (async () => {
      if (!mod.server.listening) {
        await new Promise((res) => mod.server.once('listening', res));
      }
      // Give the server's async boot (local manifest fallback) a moment,
      // then install the fake DB.
      await new Promise((r) => setTimeout(r, 100));
      mod.__setDbForTests(fakeDb);
      _port = mod.server.address().port;
    })();
  }
  return _readyPromise;
}

function authHeaders(userId) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer test-${userId}`,
  };
}

async function api(userId, method, path, body) {
  const res = await fetch(`http://127.0.0.1:${_port}${path}`, {
    method,
    headers: authHeaders(userId),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no json */ }
  return { status: res.status, data };
}

async function get(userId, path) { return api(userId, 'GET', path); }
async function post(userId, path, body) { return api(userId, 'POST', path, body || {}); }

async function joinLobby(userId, name) {
  return post(userId, '/api/join-lobby', { playerName: name });
}

/** Join both users and return their automatic match, or create it directly for API tests. */
async function createMatch(userA, userB, opts = {}) {
  const first = await joinLobby(userA, opts.nameA || 'Alpha');
  if (first.data.gameState?.players.some((player) => player.id === userB)) return first.data;
  const second = await joinLobby(userB, opts.nameB || 'Bravo');
  if (second.data.gameState?.players.some((player) => player.id === userA)) {
    const stateForA = await get(userA, `/api/game-state/${second.data.gameId}`);
    return {
      ...second.data,
      playerIndex: stateForA.data.gameState.players.findIndex((player) => player.id === userA),
      gameState: stateForA.data.gameState,
    };
  }
  const r = await post(userA, '/api/challenge-player', {
    opponentId: userB,
    cardSet: opts.cardSet || 'Ash Cycle',
    vigorType: opts.vigorType || null,
  });
  if (!r.data.success) throw new Error(`createMatch failed: ${JSON.stringify(r.data)}`);
  return r.data;
}

module.exports = {
  ready,
  get BASE() { return `http://127.0.0.1:${_port}`; },
  authHeaders,
  api,
  get,
  post,
  joinLobby,
  createMatch,
  fakeDb,
  serverModule: mod,
};
