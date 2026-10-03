'use strict';

/**
 * DEPRECATED — kept only as a compatibility entry point.
 *
 * All game logic (authoritative engine, matchmaking/lobby, progression,
 * rewards) now lives in server-production.js + lib/game-engine.js +
 * lib/progression.js. This file previously contained a divergent copy of the
 * game server WITH HARDCODED PRODUCTION CREDENTIALS, which have been removed.
 * Those credentials must be rotated (they were committed to git history).
 */

console.warn('server-multiplayer.js is deprecated. Starting server-production.js instead.');
require('./server-production.js');
