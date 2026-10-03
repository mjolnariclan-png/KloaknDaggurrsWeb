'use strict';

/**
 * Kloak 'n' Daggurrs — unified production server.
 *
 * - Serves the marketing SPA (root) and the game client (/game).
 * - Authoritative multiplayer engine: lib/game-engine.js
 * - Persistence: MongoDB Atlas (card data, progression, match history,
 *   currency transactions). Live match state is in memory (single instance).
 * - Authentication: Supabase JWT. ALL gameplay/matchmaking/progression
 *   endpoints require a valid session; the caller's identity is ALWAYS taken
 *   from the verified token, never from the request body.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const { v2: cloudinary } = require('cloudinary');
const helmet = require('helmet');
const { createClient } = require('@supabase/supabase-js');

const engine = require('./lib/game-engine');
const progression = require('./lib/progression');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const GAME_DIR = path.join(ROOT, 'game');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'tcg-game-db';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'https://www.kloakndaggurrs.com,https://kloakndaggurrs.com')
  .split(',').map((v) => v.trim()).filter(Boolean);

// Test-only auth hook: enabled ONLY when KD_TEST_AUTH=1 is explicitly set
// (used by the automated integration/multiplayer tests; never set in production).
const TEST_AUTH = process.env.KD_TEST_AUTH === '1';

if (!MONGODB_URI) console.warn('MONGODB_URI is not configured. Card data will be unavailable until it is set.');
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) console.warn('Supabase server auth environment variables are not configured.');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const supabase = SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

let db = null;
let mongoClient = null;

// ---------------------------------------------------------------------------
// In-memory live state
// ---------------------------------------------------------------------------
const games = new Map(); // gameId -> game (active or recently completed)
const lobbyPlayers = new Map(); // userId -> { id, name, gameId, lastSeen }

const LOBBY_TTL_MS = 30_000; // lobby presence expires after 30s without a poll
const FORFEIT_THRESHOLD_MS = 180_000; // opponent gone 3min -> forfeit claimable
const GAME_ABANDON_MS = 10 * 60_000; // both gone 10min -> abandoned, no rewards
const COMPLETED_GAME_MEMORY_MS = 60 * 60_000; // keep completed games in memory 1h
const MAX_COMPLETED_VIEW_MS = 60 * 60_000;
// Server-authoritative phase clock — same 60s per-phase rule the client shows.
// Overridable for tests via KD_PHASE_TIMEOUT_MS.
const PHASE_TIMEOUT_MS = Number(process.env.KD_PHASE_TIMEOUT_MS) > 0
  ? Number(process.env.KD_PHASE_TIMEOUT_MS) : 60_000;
// A phase only times out while its player is actively connected (polling);
// absent players are handled by the forfeit/abandon rules instead.
const PRESENCE_WINDOW_MS = 90_000;
// Bounded history of processed action IDs per game (duplicate suppression).
const MAX_PROCESSED_ACTIONS = 256;

let cardManifests = {};
let availableSets = [];

// ---------------------------------------------------------------------------
// Card data loading
// ---------------------------------------------------------------------------

async function connectToMongoDB() {
  try {
    if (!MONGODB_URI) throw new Error('MONGODB_URI missing');
    mongoClient = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await mongoClient.connect();
    console.log('Connected to MongoDB Atlas');
    db = mongoClient.db(DB_NAME);

    await loadCardSetsFromDB();
    await createGameIndexes();
    await sweepOrphanedMatches();
  } catch (error) {
    console.error('Error connecting to MongoDB:', error.message);
    console.log('Falling back to local file system');
    loadCardManifests();
  }
}

async function createGameIndexes() {
  try {
    const c = (name) => db.collection(name);
    await c('prebuilt_decks').createIndex({ deck_name: 1 }, { unique: true });
    await c('prebuilt_decks').createIndex({ set: 1 });
    await c('player_decks').createIndex({ user_id: 1 });
    await c('player_decks').createIndex({ user_id: 1, is_custom: 1 });
    await c('player_progression').createIndex({ user_id: 1 }, { unique: true });
    await c('queue_penalties').createIndex({ user_id: 1, date: 1 });
    // Exactly-once reward guards:
    await c('match_rewards').createIndex({ match_id: 1 }, { unique: true });
    await c('game_matches').createIndex({ game_id: 1 }, { unique: true });
    await c('game_matches').createIndex({ player1_id: 1 });
    await c('game_matches').createIndex({ player2_id: 1 });
    await c('game_matches').createIndex({ status: 1, created_at: 1 });
    await c('currency_transactions').createIndex({ user_id: 1, created_at: -1 });
    await c('currency_transactions').createIndex({ user_id: 1, match_id: 1, reason: 1 }, { unique: true });
    await c('ai_matches').createIndex({ ai_match_id: 1 }, { unique: true });
    await c('ai_matches').createIndex({ user_id: 1, started_at: -1 });
    console.log('Game indexes created successfully');
  } catch (error) {
    console.error('Error creating game indexes:', error.message);
  }
}

/** Mark any 'active' matches from a previous process as abandoned (server restart). */
async function sweepOrphanedMatches() {
  try {
    const res = await db.collection('game_matches').updateMany(
      { status: 'active' },
      { $set: { status: 'abandoned', result: 'server_restart', completed_at: new Date() } }
    );
    if (res.modifiedCount > 0) console.log(`Marked ${res.modifiedCount} orphaned matches (from restart) as abandoned`);
  } catch (e) {
    console.error('Orphan sweep failed:', e.message);
  }
}

async function loadCardSetsFromDB() {
  try {
    const sets = await db.collection('card_sets')
      .find({}, { projection: { set_name: 1, base_total: 1, type_distribution: 1 } })
      .toArray();
    availableSets = sets.map((s) => s.set_name);
    console.log(`Found ${sets.length} card sets in MongoDB: ${availableSets.join(', ')}`);
    for (const set of sets) {
      const cards = await db.collection(`cards_${set.set_name.replace(/\s+/g, '_')}`).find({}).toArray();
      cardManifests[set.set_name] = {
        set_name: set.set_name,
        base_total: set.base_total,
        type_distribution: set.type_distribution,
        cards,
      };
      console.log(`Loaded ${cards.length} cards for ${set.set_name}`);
    }
  } catch (error) {
    console.error('Error loading card sets from MongoDB:', error.message);
    loadCardManifests();
  }
}

function loadCardManifests() {
  const setsPath = path.join(ROOT, 'assets', 'img', 'cards');
  if (!fs.existsSync(setsPath)) {
    console.log(`Sets directory not found at ${setsPath}`);
    return;
  }
  const sets = fs.readdirSync(setsPath).filter((dir) => fs.statSync(path.join(setsPath, dir)).isDirectory());
  availableSets = sets;
  console.log(`Found ${sets.length} card sets: ${sets.join(', ')}`);
  sets.forEach((setName) => {
    const manifestPath = path.join(setsPath, setName, `${setName}_manifest.json`);
    if (fs.existsSync(manifestPath)) {
      try {
        cardManifests[setName] = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        console.log(`Loaded manifest for ${setName}: ${cardManifests[setName].cards.length} cards`);
      } catch (error) {
        console.error(`Error loading manifest for ${setName}:`, error.message);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Deck building (server-side, uses manifest data; costs clamped to the 15 max)
// ---------------------------------------------------------------------------

function convertImagePath(originalPath, setName) {
  if (!originalPath) return null;
  if (originalPath.startsWith('http://') || originalPath.startsWith('https://')) return originalPath;
  // Without Cloudinary credentials (or on a Cloudinary error) fall back to the
  // raw path instead of crashing deck generation.
  if (!process.env.CLOUDINARY_CLOUD_NAME) return originalPath;
  try {
    const relativePath = originalPath.replace('B:\\Cards', `B:\\Sets\\${setName}`);
    const fileName = path.basename(relativePath);
    const folderStructure = path.dirname(relativePath).replace('B:\\Sets\\', '').replace(/\\/g, '/');
    return cloudinary.url(`tcg-cards/${folderStructure}/${fileName.replace(/\.[^/.]+$/, '')}`);
  } catch (e) {
    console.warn('Card image URL generation failed, using raw path:', e.message);
    return originalPath;
  }
}

function convertCard(manifestCard, setName) {
  const card = {
    name: manifestCard.name,
    type: (manifestCard.type || '').toLowerCase(),
    image: convertImagePath(manifestCard.standard_path || manifestCard.image, setName),
    cost: engine.clampCost(manifestCard['Mana Card Cost']),
    vigor: manifestCard.vigor || manifestCard.vigor_type || null,
    rarity: manifestCard.rarity || null,
  };
  if (card.type === 'accoutrements') card.type = 'equipment';
  if (card.type === 'vigor') {
    card.attack = 0;
    card.defense = 0;
  } else if (card.type === 'creature' || card.type === 'primordial') {
    card.attack = parseInt(String(manifestCard.ap || '').replace('AP ', ''), 10) || 1;
    card.defense = parseInt(String(manifestCard.dp || '').replace('DP ', ''), 10) || 1;
    card.className = manifestCard.className || '';
    card.strength = manifestCard.strength?.Vigor || null;
    card.weakness = manifestCard.weakness?.Vigor || null;
    card.hasHaste = false;
    card.canAttack = false;
  } else if (card.type === 'equipment') {
    card.attack = parseInt(manifestCard.attack, 10) || 0;
    card.defense = parseInt(manifestCard.defense, 10) || 0;
  } else if (card.type === 'rune') {
    card.attack = 0;
    card.defense = 0;
  }
  return card;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build a deck per the established structure:
 * 1 Primordial, up to 22 Vigor, up to 24 Creatures, up to 7 Equipment,
 * up to 6 Runes (60 cards total).
 */
function buildDeck(setName = 'Ash Cycle', vigorType = null) {
  const deck = [];
  const manifest = cardManifests[setName];
  if (!manifest) return buildFallbackDeck(vigorType);

  const cards = manifest.cards;
  const filter = (type, vf = null) => cards.filter((c) => {
    const t = (c.type || '').toLowerCase();
    if (t !== type && !(type === 'equipment' && t === 'accoutrements')) return false;
    if (vf) {
      const cv = c.vigor || c.vigor_type;
      if (!cv || cv.toLowerCase() !== vf.toLowerCase()) return false;
    }
    return true;
  });

  let vigorCards = filter('vigor', vigorType);
  let creatureCards = filter('creature', vigorType);
  let primordialCards = filter('primordial', vigorType);
  let equipmentCards = filter('equipment', vigorType);
  let runeCards = filter('rune', vigorType);
  if (vigorType) {
    if (!vigorCards.length) vigorCards = filter('vigor');
    if (!creatureCards.length) creatureCards = filter('creature');
    if (!primordialCards.length) primordialCards = filter('primordial');
    if (!equipmentCards.length) equipmentCards = filter('equipment');
    if (!runeCards.length) runeCards = filter('rune');
  }

  const pick = (arr, n) => shuffle(arr).slice(0, n);

  const primordial = pick(primordialCards, 1)[0];
  deck.push(primordial
    ? { ...convertCard(primordial, setName), canAttack: false }
    : { type: 'primordial', name: 'Primordial King', cost: 5, attack: 10, defense: 10, isPrimordial: true, canAttack: false });

  pick(vigorCards, engine.MAX_VIGOR_PER_DECK).forEach((c) => deck.push(convertCard(c, setName)));
  pick(creatureCards, 24).forEach((c) => deck.push({ ...convertCard(c, setName), hasHaste: false }));
  pick(equipmentCards, 7).forEach((c) => deck.push(convertCard(c, setName)));
  pick(runeCards, 6).forEach((c) => deck.push(convertCard(c, setName)));

  return shuffle(deck);
}

function buildFallbackDeck(vigorType = null) {
  const deck = [
    { type: 'primordial', name: 'Primordial King', cost: 5, attack: 10, defense: 10, isPrimordial: true, canAttack: false },
  ];
  for (let i = 0; i < engine.MAX_VIGOR_PER_DECK; i++) deck.push({ type: 'vigor', name: 'Vigor', cost: 0, attack: 0, defense: 0, vigor: vigorType });
  for (let i = 0; i < 24; i++) {
    deck.push({
      type: 'creature',
      name: `Creature ${i + 1}`,
      cost: 1,
      attack: crypto.randomInt(1, 6),
      defense: crypto.randomInt(1, 6),
      hasHaste: false,
      canAttack: false,
      vigor: vigorType,
    });
  }
  for (let i = 0; i < 7; i++) {
    deck.push({ type: 'equipment', name: `Equipment ${i + 1}`, cost: 1, attack: crypto.randomInt(0, 2), defense: crypto.randomInt(0, 2), vigor: vigorType });
  }
  for (let i = 0; i < 6; i++) {
    deck.push({ type: 'rune', name: `Rune ${i + 1}`, cost: crypto.randomInt(1, 4), attack: 0, defense: 0, vigor: vigorType });
  }
  return shuffle(deck);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) res.header('Access-Control-Allow-Origin', origin);
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin,Content-Type,Accept,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => res.json({
  ok: true,
  service: 'kloakndaggurrs',
  database: !!db,
  uptime: Math.round(process.uptime()),
}));

async function requireGameAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!token) return res.status(401).json({ success: false, error: 'Sign in required' });

    if (TEST_AUTH && token.startsWith('test-')) {
      const uid = token.slice(5);
      if (!/^[a-zA-Z0-9-]{6,64}$/.test(uid)) return res.status(401).json({ success: false, error: 'Invalid or expired session' });
      req.authUser = { id: uid, email: `${uid}@test.local` };
    } else {
      if (!supabase) return res.status(503).json({ success: false, error: 'Authentication backend not configured' });
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) return res.status(401).json({ success: false, error: 'Invalid or expired session' });
      req.authUser = user;
    }

    // Identity is authoritative from the token; client-supplied ids are ignored.
    if (req.body && typeof req.body === 'object') {
      delete req.body.playerId;
      delete req.body.userId;
    }
    next();
  } catch (e) {
    return res.status(401).json({ success: false, error: 'Authentication failed' });
  }
}

// All game systems require authentication.
app.use('/api/player', requireGameAuth);
app.use('/api/matchmaking', requireGameAuth);
app.use('/api/match', requireGameAuth);
app.use('/api/decks/custom', requireGameAuth);
app.use('/api/game', requireGameAuth);
app.use('/api/join-lobby', requireGameAuth);
app.use('/api/lobby-players', requireGameAuth);
app.use('/api/challenge-player', requireGameAuth);
app.use('/api/accept-game', requireGameAuth);
app.use('/api/decline-game', requireGameAuth);
app.use('/api/ai', requireGameAuth);
app.use(['/api/play-card', '/api/attack', '/api/end-turn', '/api/advance-phase',
  '/api/draw-card', '/api/attach-equipment', '/api/auto-play-vigor',
  '/api/surrender', '/api/game-state'], requireGameAuth);

// ---------------------------------------------------------------------------
// Progression / currency (MongoDB, server-authoritative)
// ---------------------------------------------------------------------------

async function getOrCreateProgression(userId) {
  const col = db.collection('player_progression');
  let rec = await col.findOne({ user_id: userId });
  if (!rec) {
    const now = new Date();
    rec = {
      user_id: userId,
      level: 1,
      prestige: 0,
      xp: 0,
      xp_to_next: progression.xpNeeded(1, 0),
      total_xp: 0,
      coins: 0,
      matches_played: 0,
      matches_won: 0,
      created_at: now,
      last_played: now,
    };
    try {
      await col.insertOne(rec);
    } catch (e) {
      if (e.code !== 11000) throw e; // duplicate -> someone else created it first
      rec = await col.findOne({ user_id: userId });
    }
  }
  return rec;
}

/**
 * Grant match rewards exactly once per player per match.
 * Guard: unique index on currency_transactions {user_id, match_id, reason}.
 */
async function grantMatchRewards(userId, { mode, won, matchId }) {
  if (!db) return { granted: false, reason: 'no-database' };
  const now = new Date();

  // Exactly-once guard: a unique index rejects the second insert for the same
  // user+match+reason.
  try {
    await db.collection('currency_transactions').insertOne({
      user_id: userId,
      match_id: matchId,
      reason: won ? `${mode}_win` : `${mode}_loss`,
      created_at: now,
      amount: 0, // filled below
      xp: 0,
    });
  } catch (e) {
    if (e.code === 11000) return { granted: false, duplicate: true };
    throw e;
  }

  const rec = await getOrCreateProgression(userId);
  const rewards = progression.computeMatchRewards({ mode, won, prestige: rec.prestige || 0 });

  // Snapshot pre-update values, then apply XP locally. The conditional update
  // (filter on the snapshot) makes the grant safe under concurrency.
  const before = {
    level: rec.level || 1,
    xp: rec.xp || 0,
    coins: rec.coins || 0,
    matches_played: rec.matches_played || 0,
    matches_won: rec.matches_won || 0,
  };
  const levels = progression.applyXp(rec, rewards.xp);

  const res = await db.collection('player_progression').updateOne(
    { user_id: userId, ...before },
    {
      $set: {
        level: rec.level,
        xp: rec.xp,
        xp_to_next: rec.xp_to_next,
        total_xp: rec.total_xp,
        last_played: now,
      },
      $inc: {
        coins: rewards.coins,
        matches_played: 1,
        matches_won: won ? 1 : 0,
      },
    }
  );
  if (res.modifiedCount === 0) {
    // Lost a race; refund the guard document so the win is not silently dropped.
    await db.collection('currency_transactions').deleteOne({ user_id: userId, match_id: matchId });
    return { granted: false, reason: 'race-retry' };
  }

  await db.collection('currency_transactions').updateOne(
    { user_id: userId, match_id: matchId },
    { $set: { amount: rewards.coins, xp: rewards.xp } }
  );

  return { granted: true, rewards, levelsGained: levels };
}

/** Finalize a completed match: persist result + grant rewards exactly once. */
async function finalizeMatch(game) {
  if (!game || game.status !== 'completed') return;
  if (game.finalized) return;
  game.finalized = true;

  if (db) {
    try {
      await db.collection('game_matches').updateOne(
        { game_id: game.id },
        {
          $set: {
            status: game.status,
            result: game.result,
            winner_id: game.winner,
            turn_number: game.turnNumber,
            completed_at: new Date(),
          },
        },
        { upsert: true }
      );
    } catch (e) {
      console.error(`Failed to persist match ${game.id}:`, e.message);
    }

    if (game.winner) {
      for (const p of game.players) {
        try {
          const r = await grantMatchRewards(p.id, {
            mode: 'multiplayer',
            won: p.id === game.winner,
            matchId: game.id,
          });
          if (r.granted && r.rewards) {
            p.grantedRewards = r.rewards;
            if (r.levelsGained && r.levelsGained.length) p.levelsGained = r.levelsGained;
          }
        } catch (e) {
          console.error(`Reward grant failed for ${p.id} in ${game.id}:`, e.message);
        }
      }
    }
  }
  scheduleGameCleanup(game.id);
}

function scheduleGameCleanup(gameId) {
  setTimeout(() => {
    const g = games.get(gameId);
    if (g && g.status === 'completed') games.delete(gameId);
  }, COMPLETED_GAME_MEMORY_MS).unref();
}

// ---------------------------------------------------------------------------
// Public content endpoints (no auth required — static card/deck data)
// ---------------------------------------------------------------------------

app.get('/api/sets', (req, res) => {
  res.json({
    success: true,
    sets: availableSets.map((setName) => ({
      name: setName,
      manifest: cardManifests[setName] ? {
        set_name: cardManifests[setName].set_name,
        base_total: cardManifests[setName].base_total,
        type_distribution: cardManifests[setName].type_distribution,
      } : null,
    })),
  });
});

app.get('/api/decks', async (req, res) => {
  try {
    if (!db) {
      const decksDir = path.join(ROOT, 'decks');
      const decks = [];
      if (fs.existsSync(decksDir)) {
        fs.readdirSync(decksDir).filter((f) => f.endsWith('.json')).forEach((file) => {
          try {
            const d = JSON.parse(fs.readFileSync(path.join(decksDir, file), 'utf8'));
            decks.push({ name: d.deck_name, set: d.set, vigor: d.vigor });
          } catch (e) { console.error(`Error reading deck file ${file}:`, e.message); }
        });
      }
      return res.json({ success: true, decks });
    }
    const decks = await db.collection('prebuilt_decks')
      .find({}, { projection: { deck_name: 1, set: 1, vigor: 1 } })
      .toArray();
    res.json({ success: true, decks: decks.map((d) => ({ name: d.deck_name, set: d.set, vigor: d.vigor })) });
  } catch (error) {
    console.error('Error loading decks:', error.message);
    res.json({ success: false, error: error.message, decks: [] });
  }
});

app.get('/api/decks/:deckName', async (req, res) => {
  try {
    const { deckName } = req.params;
    let deckData = null;
    if (!db) {
      const decksDir = path.join(ROOT, 'decks');
      if (fs.existsSync(decksDir)) {
        for (const file of fs.readdirSync(decksDir).filter((f) => f.endsWith('.json'))) {
          const data = JSON.parse(fs.readFileSync(path.join(decksDir, file), 'utf8'));
          if (data.deck_name === deckName) { deckData = data; break; }
        }
      }
    } else {
      deckData = await db.collection('prebuilt_decks').findOne({ deck_name: deckName });
    }
    if (!deckData) return res.json({ success: false, error: 'Deck not found' });

    let fullDeck = [];
    if (db) {
      const cardsCollection = db.collection(`cards_${String(deckData.set).replace(/\s+/g, '_')}`);
      for (const entry of deckData.cards) {
        const card = await cardsCollection.findOne({ name: entry.name });
        if (card) for (let i = 0; i < entry.quantity; i++) fullDeck.push(card);
        else console.warn(`Card not found in MongoDB: ${entry.name}`);
      }
    }
    res.json({ success: true, deck: { name: deckData.deck_name, set: deckData.set, vigor: deckData.vigor, cards: fullDeck } });
  } catch (error) {
    console.error('Error loading deck:', error.message);
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/cards/:setName', (req, res) => {
  const { setName } = req.params;
  const { type, vigorType } = req.query;
  if (!cardManifests[setName]) return res.json({ success: false, error: 'Set not found' });
  let cards = cardManifests[setName].cards;
  if (type) cards = cards.filter((c) => (c.type || '').toLowerCase() === String(type).toLowerCase());
  if (vigorType) cards = cards.filter((c) => {
    const cv = c.vigor || c.vigor_type;
    return cv && cv.toLowerCase() === String(vigorType).toLowerCase();
  });
  res.json({ success: true, cards, total: cards.length });
});

app.get('/api/cards-public', async (req, res) => {
  try {
    const { set, type, vigorType } = req.query;
    let cards = [];
    if (set && cardManifests[set]) cards = cardManifests[set].cards;
    else Object.values(cardManifests).forEach((m) => { cards = cards.concat(m.cards); });
    if (type) cards = cards.filter((c) => (c.type || '').toLowerCase() === String(type).toLowerCase());
    if (vigorType) cards = cards.filter((c) => {
      const cv = c.vigor || c.vigor_type;
      return cv && cv.toLowerCase() === String(vigorType).toLowerCase();
    });
    const transformed = cards.map((c) => ({
      _id: c._id,
      name: c.name,
      type: c.type,
      vigor: c.vigor || c.vigor_type,
      rarity: c.rarity,
      set: set || c.set_name,
      description: c.description,
      image: c.standard_path || c.image,
    }));
    res.json({ success: true, cards: transformed, total: transformed.length });
  } catch (error) {
    console.error('Error fetching public cards:', error.message);
    res.json({ success: false, error: error.message, cards: [], total: 0 });
  }
});

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------

function cleanLobby() {
  const now = Date.now();
  for (const [id, p] of lobbyPlayers) {
    if (now - p.lastSeen > LOBBY_TTL_MS && !p.gameId) lobbyPlayers.delete(id);
  }
}

function userActiveGame(userId) {
  for (const g of games.values()) {
    if (g.status === 'active' && engine.playerIndex(g, userId) !== -1) return g;
  }
  return null;
}

app.post('/api/join-lobby', (req, res) => {
  const userId = req.authUser.id;
  const name = (typeof req.body.playerName === 'string' ? req.body.playerName : '').trim().slice(0, 40);
  const active = userActiveGame(userId);
  if (active) {
    // Rejoin path: tell the player they have a live match instead of parking them in the lobby.
    return res.json({ success: true, activeGameId: active.id });
  }
  const entry = lobbyPlayers.get(userId) || { id: userId };
  entry.id = userId;
  entry.name = name || entry.name || 'Player';
  entry.lastSeen = Date.now();
  entry.gameId = entry.gameId || null;
  lobbyPlayers.set(userId, entry);
  console.log(`Player ${entry.name} (${userId}) in lobby (${lobbyPlayers.size} players)`);
  res.json({ success: true, message: 'Joined lobby successfully' });
});

app.get('/api/lobby-players', (req, res) => {
  const userId = req.authUser.id;
  cleanLobby();
  const me = lobbyPlayers.get(userId);
  if (me) {
    me.lastSeen = Date.now();
    if (me.gameId) {
      const game = games.get(me.gameId);
      if (game) {
        const idx = engine.playerIndex(game, userId);
        if (idx !== -1) {
          return res.json({
            success: true,
            status: 'game_ready',
            players: [...lobbyPlayers.values()].map((p) => ({ id: p.id, name: p.name })),
            gameInvitation: {
              gameId: game.id,
              opponentName: game.players[1 - idx].name,
              playerIndex: idx,
              goesFirst: idx === game.currentTurn,
              gameState: engine.sanitize(game, userId),
            },
          });
        }
      }
      me.gameId = null; // game vanished (declined/swept) — back to normal lobby
    }
  }

  const players = [...lobbyPlayers.values()].map((p) => ({ id: p.id, name: p.name }));
  const status = players.length >= 2 ? 'matchmaking_ready' : 'waiting_for_players';
  res.json({ success: true, status, players, gameInvitation: null });
});

// ---------------------------------------------------------------------------
// Challenge / match creation
// ---------------------------------------------------------------------------

app.post('/api/challenge-player', async (req, res) => {
  const userId = req.authUser.id;
  const { opponentId, cardSet, vigorType } = req.body || {};
  if (typeof opponentId !== 'string' || !opponentId) return res.json({ success: false, error: 'Missing opponent' });
  if (opponentId === userId) return res.json({ success: false, error: 'Cannot challenge yourself' });
  if (userActiveGame(userId)) return res.json({ success: false, error: 'You are already in a match' });
  const opponentActive = userActiveGame(opponentId);
  if (opponentActive) return res.json({ success: false, error: 'Opponent is already in a match' });

  const challengerLobby = lobbyPlayers.get(userId);
  const opponentLobby = lobbyPlayers.get(opponentId);
  // Opponent must be present in the lobby (fresh presence).
  if (!opponentLobby || Date.now() - opponentLobby.lastSeen > LOBBY_TTL_MS) {
    return res.json({ success: false, error: 'Player not found in lobby' });
  }

  const setName = typeof cardSet === 'string' && availableSets.includes(cardSet) ? cardSet : (availableSets[0] || 'Ash Cycle');
  const vigor = typeof vigorType === 'string' && vigorType ? vigorType : null;

  const gameId = `game_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const firstPlayerIndex = crypto.randomInt(2);

  const game = engine.createGame({
    id: gameId,
    firstPlayerIndex,
    players: [
      {
        id: userId,
        name: challengerLobby?.name || 'Player',
        deck: buildDeck(setName, vigor),
      },
      {
        id: opponentId,
        name: opponentLobby.name || 'Player',
        deck: buildDeck(setName, vigor),
      },
    ],
  });
  game.cardSet = setName;
  game.vigorType = vigor;
  games.set(gameId, game);

  challengerLobby.gameId = gameId;
  opponentLobby.gameId = gameId;

  if (db) {
    try {
      await db.collection('game_matches').insertOne({
        game_id: gameId,
        player1_id: userId,
        player2_id: opponentId,
        player1_name: game.players[0].name,
        player2_name: game.players[1].name,
        status: 'active',
        result: null,
        winner_id: null,
        created_at: new Date(),
      });
    } catch (e) {
      console.error('Failed to record match:', e.message);
    }
  }

  const challengerIdx = engine.playerIndex(game, userId);
  console.log(`Match created: ${gameId} — ${game.players[0].name} vs ${game.players[1].name}; first: ${game.players[firstPlayerIndex].name}`);
  res.json({
    success: true,
    gameId,
    opponentName: game.players[1 - challengerIdx].name,
    playerIndex: challengerIdx,
    goesFirst: challengerIdx === firstPlayerIndex,
    gameState: engine.sanitize(game, userId),
  });
});

app.post('/api/accept-game', (req, res) => {
  const userId = req.authUser.id;
  const { gameId } = req.body || {};
  const game = games.get(gameId);
  if (!game) return res.json({ success: false, error: 'Game not found' });
  const idx = engine.playerIndex(game, userId);
  if (idx === -1) return res.json({ success: false, error: 'Player not in game' });
  engine.touch(game, userId);
  game.players[idx].isReady = true;
  res.json({ success: true, gameState: engine.sanitize(game, userId) });
});

app.post('/api/decline-game', (req, res) => {
  const userId = req.authUser.id;
  const { gameId } = req.body || {};
  const game = games.get(gameId);
  if (!game) return res.json({ success: true, message: 'Game not found' });
  const idx = engine.playerIndex(game, userId);
  if (idx === -1) return res.json({ success: false, error: 'Player not in game' });
  // Declining an unstarted challenge cancels it for both players.
  game.status = 'completed';
  game.result = 'declined';
  game.winner = null;
  games.delete(gameId);
  for (const p of [userId, game.players[1 - idx].id]) {
    const entry = lobbyPlayers.get(p);
    if (entry) { entry.gameId = null; entry.lastSeen = Date.now(); }
  }
  if (db) {
    db.collection('game_matches').updateOne(
      { game_id: gameId },
      { $set: { status: 'cancelled', result: 'declined', completed_at: new Date() } }
    ).catch((e) => console.error('decline-game persist failed:', e.message));
  }
  console.log(`Game ${gameId} declined by ${userId}`);
  res.json({ success: true, message: 'Game declined' });
});

// ---------------------------------------------------------------------------
// Gameplay — all validated by the authoritative engine
// ---------------------------------------------------------------------------

function respondWithGame(res, game, userId, extra = {}) {
  if (game && game.status === 'completed') finalizeMatch(game);
  res.json({ success: true, gameState: engine.sanitize(game, userId), ...extra });
}

app.get('/api/game-state/:gameId', async (req, res) => {
  const userId = req.authUser.id;
  const game = games.get(req.params.gameId);
  if (!game) return res.json({ success: false, error: 'Game not found' });
  const idx = engine.playerIndex(game, userId);
  if (idx === -1) return res.status(403).json({ success: false, error: 'You are not a player in this match' });
  engine.touch(game, userId);
  enforcePhaseTimeout(game);
  if (game.status === 'completed') await finalizeMatch(game);
  res.json({
    success: true,
    gameState: engine.sanitize(game, userId),
    youWon: game.winner === userId,
    result: game.result,
    rewards: game.players[idx].grantedRewards || null,
    levelsGained: game.players[idx].levelsGained || [],
  });
});

/**
 * Server-authoritative phase timeout: if the current player's phase clock has
 * expired (they are connected but not acting), advance their phase — the same
 * thing their browser's 60s timer would do. Absent players are excluded so the
 * forfeit/abandon rules (which require 3min/10min of absence) stay in charge.
 */
function enforcePhaseTimeout(game) {
  if (!game || game.status !== 'active') return;
  const current = game.players[game.currentTurn];
  if (Date.now() - (current.lastSeen || 0) > PRESENCE_WINDOW_MS) return;
  if (engine.applyPhaseTimeouts(game, PHASE_TIMEOUT_MS) > 0 && game.status === 'completed') {
    finalizeMatch(game); // fire-and-forget: guarded exactly-once by game.finalized
  }
}

/**
 * Wrap a mutating game action with server-side validation:
 *  1. phase timeout enforcement (authoritative clock),
 *  2. optimistic concurrency — the client must state which game version it
 *     acted on; a stale version means the state moved (opponent action, our
 *     own double-click, a network retry, or a phase timeout) and the action
 *     is REJECTED instead of applied,
 *  3. duplicate suppression by actionId (double-click / network retry of the
 *     exact same logical request).
 * Every rejection carries the authoritative state so the client can resync
 * without a second round trip.
 */
function gameAction(handler) {
  return async (req, res) => {
    const userId = req.authUser.id;
    const { gameId, expectedVersion, actionId } = req.body || {};
    const game = games.get(gameId);
    if (!game) return res.json({ success: false, error: 'Game not found' });
    const idx = engine.playerIndex(game, userId);
    if (idx === -1) return res.status(403).json({ success: false, error: 'You are not a player in this match' });
    engine.touch(game, userId);
    enforcePhaseTimeout(game);

    if (!Number.isInteger(expectedVersion)) {
      return res.json({
        success: false, error: 'Missing expected game version', invalidRequest: true,
        gameState: engine.sanitize(game, userId),
      });
    }
    if (expectedVersion !== game.version) {
      return res.json({
        success: false, error: 'Stale game state — your view is out of date', stale: true,
        gameState: engine.sanitize(game, userId),
      });
    }
    if (typeof actionId === 'string' && actionId &&
        (game.processedActions || []).includes(actionId)) {
      return res.json({
        success: false, error: 'Duplicate action ignored', duplicate: true,
        gameState: engine.sanitize(game, userId),
      });
    }

    const result = handler(game, userId, req.body || {});
    if (!result.ok) return res.json({ success: false, error: result.error });

    // Record the actionId only on success: a rejected action did not mutate
    // state, so an identical retry remains safe to evaluate on its merits.
    if (typeof actionId === 'string' && actionId) {
      game.processedActions = game.processedActions || [];
      game.processedActions.push(actionId);
      if (game.processedActions.length > MAX_PROCESSED_ACTIONS) {
        game.processedActions.splice(0, game.processedActions.length - MAX_PROCESSED_ACTIONS);
      }
    }
    if (game.status === 'completed') await finalizeMatch(game);
    respondWithGame(res, game, userId, result.extra || {});
  };
}

app.post('/api/play-card', gameAction((game, userId, body) =>
  engine.playCard(game, userId, body.cardIndex)));

app.post('/api/attack', gameAction((game, userId, body) =>
  engine.attack(game, userId, body.attackerIndex, body.targetIndex, body.targetPlayer === true)));

app.post('/api/attach-equipment', gameAction((game, userId, body) =>
  engine.attachEquipment(game, userId, body.equipmentIndex, body.targetCreatureIndex)));

app.post('/api/draw-card', gameAction((game, userId) => {
  const r = engine.drawCard(game, userId);
  return r.ok ? { ok: true, extra: { drawnCard: r.drawnCard } } : r;
}));

app.post('/api/auto-play-vigor', gameAction((game, userId) =>
  engine.autoPlayVigor(game, userId)));

app.post('/api/advance-phase', gameAction((game, userId) =>
  engine.advancePhase(game, userId)));

// Legacy alias: end-turn used to skip the turn entirely. Keep behavior safe:
// end the caller's turn (jump to next player's vigor phase).
app.post('/api/end-turn', gameAction((game, userId) => {
  const idx = engine.playerIndex(game, userId);
  if (game.players[game.currentTurn].id !== userId) return { ok: false, error: 'Not your turn' };
  let phases = 0;
  while (game.phase !== 'attack' && phases < 5) {
    const r = engine.advancePhase(game, userId);
    if (!r.ok) return r;
    phases++;
  }
  return engine.advancePhase(game, userId); // attack -> end turn
}));

app.post('/api/surrender', gameAction((game, userId) => {
  const r = engine.surrender(game, userId);
  return r;
}));

app.post('/api/match/:gameId/claim-forfeit', async (req, res) => {
  const userId = req.authUser.id;
  const game = games.get(req.params.gameId);
  if (!game) return res.json({ success: false, error: 'Game not found' });
  const idx = engine.playerIndex(game, userId);
  if (idx === -1) return res.status(403).json({ success: false, error: 'You are not a player in this match' });
  engine.touch(game, userId);

  const { expectedVersion } = req.body || {};
  if (!Number.isInteger(expectedVersion)) {
    return res.json({ success: false, error: 'Missing expected game version', invalidRequest: true, gameState: engine.sanitize(game, userId) });
  }
  if (expectedVersion !== game.version) {
    return res.json({ success: false, error: 'Stale game state — your view is out of date', stale: true, gameState: engine.sanitize(game, userId) });
  }

  const r = engine.claimForfeit(game, userId, FORFEIT_THRESHOLD_MS);
  if (!r.ok) return res.json({ success: false, error: r.error });
  await finalizeMatch(game);
  respondWithGame(res, game, userId);
});

// ---------------------------------------------------------------------------
// Player progression (self access only)
// ---------------------------------------------------------------------------

app.get('/api/player/:userId', async (req, res) => {
  const userId = req.authUser.id;
  if (req.params.userId !== userId) {
    return res.status(403).json({ success: false, error: 'You can only view your own progression' });
  }
  try {
    if (!db) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const player = await getOrCreateProgression(userId);
    res.json({ success: true, player });
  } catch (error) {
    console.error('Error getting player progression:', error.message);
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/player/:userId/prestige', async (req, res) => {
  const userId = req.authUser.id;
  if (req.params.userId !== userId) {
    return res.status(403).json({ success: false, error: 'You can only prestige your own account' });
  }
  try {
    if (!db) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const col = db.collection('player_progression');
    const rec = await getOrCreateProgression(userId);
    const before = { level: rec.level, prestige: rec.prestige || 0 };
    const result = progression.prestige(rec);
    if (!result.ok) return res.json({ success: false, error: result.error });
    const upd = await col.updateOne(
      { user_id: userId, level: before.level, prestige: before.prestige },
      { $set: { level: rec.level, prestige: rec.prestige, xp: rec.xp, xp_to_next: rec.xp_to_next, updated_at: new Date() } }
    );
    if (upd.modifiedCount === 0) return res.json({ success: false, error: 'Prestige failed, please retry' });
    console.log(`Player ${userId} prestiged to star ${rec.prestige}`);
    res.json({ success: true, player: rec });
  } catch (error) {
    console.error('Error prestiging:', error.message);
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/player/:userId/decks', async (req, res) => {
  const userId = req.authUser.id;
  if (req.params.userId !== userId) {
    return res.status(403).json({ success: false, error: 'You can only view your own decks' });
  }
  try {
    if (!db) return res.json({ success: true, decks: [] });
    const decks = await db.collection('player_decks').find({ user_id: userId }).sort({ created_at: -1 }).toArray();
    res.json({ success: true, decks });
  } catch (error) {
    res.json({ success: false, error: error.message, decks: [] });
  }
});

// Custom deck creation with structure validation (established 60-card layout).
app.post('/api/decks/custom', async (req, res) => {
  const userId = req.authUser.id;
  const { deckName, set, vigor, cards } = req.body || {};
  try {
    if (!db) return res.status(503).json({ success: false, error: 'Database unavailable' });
    if (typeof deckName !== 'string' || !deckName.trim()) return res.json({ success: false, error: 'Deck name required' });
    if (!Array.isArray(cards)) return res.json({ success: false, error: 'Cards array required' });

    const counts = { primordial: 0, vigor: 0, creature: 0, equipment: 0, rune: 0 };
    let total = 0;
    for (const c of cards) {
      if (!c || typeof c !== 'object') return res.json({ success: false, error: 'Invalid card entry' });
      const t = String(c.type || '').toLowerCase() === 'accoutrements' ? 'equipment' : String(c.type || '').toLowerCase();
      if (!(t in counts)) return res.json({ success: false, error: `Invalid card type: ${c.type}` });
      const qty = Number(c.quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > 4) return res.json({ success: false, error: 'Card quantity must be 1-4' });
      counts[t] += qty;
      total += qty;
    }
    if (counts.primordial !== 1) return res.json({ success: false, error: 'Deck must contain exactly 1 Primordial' });
    if (counts.vigor > engine.MAX_VIGOR_PER_DECK) return res.json({ success: false, error: `Max ${engine.MAX_VIGOR_PER_DECK} Vigor cards` });
    if (counts.creature > 24) return res.json({ success: false, error: 'Max 24 Creature cards' });
    if (counts.equipment > 7) return res.json({ success: false, error: 'Max 7 Equipment cards' });
    if (counts.rune > 6) return res.json({ success: false, error: 'Max 6 Rune cards' });
    if (total !== 60) return res.json({ success: false, error: 'Deck must contain exactly 60 cards' });

    const rec = await getOrCreateProgression(userId);
    const prestige = rec.prestige || 0;
    const customDeckLimit = prestige >= 4 ? 3 : prestige >= 2 ? 2 : 1;
    const existing = await db.collection('player_decks').countDocuments({ user_id: userId, is_custom: true });
    if (existing >= customDeckLimit) {
      return res.json({ success: false, error: `Custom deck limit reached. Prestige ${prestige} allows ${customDeckLimit} custom deck(s).` });
    }

    const newDeck = {
      user_id: userId,
      deck_name: deckName.trim().slice(0, 60),
      set: typeof set === 'string' ? set : null,
      vigor: typeof vigor === 'string' ? vigor : null,
      cards,
      is_custom: true,
      created_at: new Date(),
      updated_at: new Date(),
    };
    await db.collection('player_decks').insertOne(newDeck);
    res.json({ success: true, deck: newDeck });
  } catch (error) {
    console.error('Error creating custom deck:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// AI battles — server-issued match tokens + validated rewards
// ---------------------------------------------------------------------------

const AI_MIN_DURATION_MS = 45_000; // min seconds a real match takes
const AI_DAILY_REWARD_CAP = 30;
const AI_DIFFICULTIES = {
  easy: progression.LEVEL_GATES.aiEasy,
  medium: progression.LEVEL_GATES.aiMedium,
  hard: progression.LEVEL_GATES.aiHard,
};

app.post('/api/ai/start', async (req, res) => {
  const userId = req.authUser.id;
  const difficulty = String((req.body || {}).difficulty || 'easy').toLowerCase();
  if (!AI_DIFFICULTIES[difficulty]) return res.json({ success: false, error: 'Invalid difficulty' });
  try {
    if (!db) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const rec = await getOrCreateProgression(userId);
    const requiredLevel = AI_DIFFICULTIES[difficulty];
    if ((rec.level || 1) < requiredLevel) {
      return res.json({ success: false, error: `${difficulty} AI unlocks at level ${requiredLevel}` });
    }
    const aiMatchId = `ai_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    await db.collection('ai_matches').insertOne({
      ai_match_id: aiMatchId,
      user_id: userId,
      difficulty,
      started_at: new Date(),
      finished_at: null,
      won: null,
    });
    res.json({ success: true, aiMatchId, difficulty });
  } catch (error) {
    console.error('ai/start failed:', error.message);
    res.json({ success: false, error: error.message });
  }
});

app.post('/api/ai/result', async (req, res) => {
  const userId = req.authUser.id;
  const { aiMatchId, won } = req.body || {};
  try {
    if (!db) return res.status(503).json({ success: false, error: 'Database unavailable' });
    if (typeof aiMatchId !== 'string' || !aiMatchId) return res.json({ success: false, error: 'Missing match id' });

    // Validation order matters: a REJECTED result must never burn the match.
    // 1) ownership + existence (read-only),
    // 2) duration (read-only — a too-short match stays reportable later),
    // 3) atomic exactly-once claim,
    // 4) rewards.
    const match = await db.collection('ai_matches').findOne({ ai_match_id: aiMatchId, user_id: userId });
    if (!match) return res.json({ success: false, error: 'Match not found' });
    if (match.finished_at) return res.json({ success: false, error: 'Match result already submitted' });

    const elapsed = Date.now() - new Date(match.started_at).getTime();
    if (elapsed < AI_MIN_DURATION_MS) {
      return res.json({ success: false, error: 'Match too short to count' });
    }

    // Atomic claim: only one report per match can ever pass this line.
    const claimed = await db.collection('ai_matches').updateOne(
      { ai_match_id: aiMatchId, user_id: userId, finished_at: null },
      { $set: { finished_at: new Date(), won: won === true } }
    );
    if (claimed.modifiedCount === 0) return res.json({ success: false, error: 'Match result already submitted' });

    if (won !== true) {
      // A loss records stats but grants nothing — still counts as a played match.
      await db.collection('player_progression').updateOne(
        { user_id: userId },
        { $inc: { matches_played: 1 } }
      );
      return res.json({ success: true, rewards: null });
    }

    // Daily anti-farm cap.
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const todayWins = await db.collection('currency_transactions').countDocuments({
      user_id: userId,
      reason: 'ai_win',
      created_at: { $gte: dayStart },
    });
    if (todayWins >= AI_DAILY_REWARD_CAP) {
      return res.json({ success: true, rewards: null, capped: true, message: 'Daily AI reward limit reached' });
    }

    const granted = await grantMatchRewards(userId, { mode: 'ai', won: true, matchId: aiMatchId });
    if (!granted.granted) {
      return res.json({ success: true, rewards: null, duplicate: true });
    }
    console.log(`AI reward granted to ${userId}: +${granted.rewards.xp} XP, +${granted.rewards.coins} coins (levels: ${granted.levelsGained.join(',') || 'none'})`);
    res.json({ success: true, rewards: granted.rewards, levelsGained: granted.levelsGained });
  } catch (error) {
    console.error('ai/result failed:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Static serving
// ---------------------------------------------------------------------------

app.use('/assets', express.static(path.join(ROOT, 'assets'), { maxAge: '1h' }));
app.use('/game', express.static(GAME_DIR, { index: 'index.html', maxAge: '15m' }));
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));

// Legacy stubs kept for compatibility.
app.get('/api/player-hand', (req, res) => res.json([]));
app.get('/api/battlefield', (req, res) => res.json([]));

// ---------------------------------------------------------------------------
// Background maintenance
// ---------------------------------------------------------------------------

setInterval(() => {
  cleanLobby();
  const now = Date.now();
  for (const [id, g] of games) {
    if (g.status !== 'active') continue;
    // Authoritative phase clock: advance expired phases of connected players.
    enforcePhaseTimeout(g);
    const p0 = g.players[0].lastSeen || 0;
    const p1 = g.players[1].lastSeen || 0;
    const gone0 = now - p0 > GAME_ABANDON_MS;
    const gone1 = now - p1 > GAME_ABANDON_MS;
    if (gone0 && gone1) {
      // Both players gone: abandon without rewards.
      g.status = 'completed';
      g.result = 'abandoned';
      g.winner = null;
      console.log(`Match ${id} abandoned (both players inactive)`);
      finalizeMatch(g);
      if (db) {
        db.collection('game_matches').updateOne(
          { game_id: id },
          { $set: { status: 'abandoned', result: 'abandoned', completed_at: new Date() } }
        ).catch(() => {});
      }
    }
  }
}, 60_000).unref();

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`K&D unified production server listening on port ${PORT}`);
  await connectToMongoDB();
});

module.exports = { app, server, games, lobbyPlayers, buildDeck, engine };

/**
 * Test-only: swap the MongoDB handle for an in-memory fake.
 * Used exclusively by the automated test suite (KD_TEST_AUTH=1); never used
 * in production. Defined last so nothing else can call it accidentally.
 */
if (TEST_AUTH) {
  module.exports.__setDbForTests = function __setDbForTests(fakeDb) {
    db = fakeDb;
  };
}
