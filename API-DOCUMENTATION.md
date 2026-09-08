# Kloak & Daggurrs Game Server API Documentation

## Base URL
Development: `http://localhost:3005`
Production: `https://api.kloakndaggurrs.com` (to be configured)

## Authentication

Most endpoints require Supabase authentication. Include the access token in the Authorization header:

```
Authorization: Bearer <supabase_access_token>
```

To get the token, use the `GameAuth.getAuthToken()` function from `game/game-auth.js`.

---

## Endpoints

### Public Endpoints (No Auth Required)

#### GET /api/decks
Get list of all prebuilt decks.

**Response:**
```json
{
  "success": true,
  "decks": [
    {
      "name": "Abyssbrand Legion",
      "set": "Crimson Oath",
      "vigor": "Sorcery"
    }
  ]
}
```

#### GET /api/decks/:deckName
Get specific deck with full card data from MongoDB.

**Response:**
```json
{
  "success": true,
  "deck": {
    "name": "Abyssbrand Legion",
    "set": "Crimson Oath",
    "vigor": "Sorcery",
    "cards": [...] // Full card objects from MongoDB
  }
}
```

#### GET /api/cards/:setName
Get cards from a specific card set.

**Query Parameters:**
- `type` (optional): Filter by card type (creature, vigor, rune, etc.)
- `vigorType` (optional): Filter by vigor type

**Response:**
```json
{
  "success": true,
  "cards": [...],
  "total": 168
}
```

#### GET /api/cards-public
Public endpoint for website/Supabase to query MongoDB cards.

**Query Parameters:**
- `set` (optional): Filter by card set
- `type` (optional): Filter by card type
- `vigorType` (optional): Filter by vigor type

**Response:**
```json
{
  "success": true,
  "cards": [
    {
      "_id": "Ash_Cycle_Hexhorror",
      "name": "Hexhorror",
      "type": "creature",
      "vigor": "Sorcery",
      "rarity": "Rare",
      "set": "Ash Cycle",
      "description": "...",
      "image": "..."
    }
  ],
  "total": 168
}
```

---

### Authenticated Endpoints (Require Supabase Token)

#### POST /api/decks/custom
Create a custom deck (with prestige limits).

**Request Body:**
```json
{
  "deckName": "My Custom Deck",
  "set": "Ash Cycle",
  "vigor": "Sorcery",
  "cards": [
    { "name": "Hexhorror", "quantity": 22 },
    { "name": "Medic", "quantity": 6 }
  ]
}
```

**Prestige Limits:**
- Prestige 0: 1 custom deck
- Prestige 2: 2 custom decks
- Prestige 4: 3 custom decks

**Response:**
```json
{
  "success": true,
  "deck": {
    "user_id": "...",
    "deck_name": "My Custom Deck",
    "set": "Ash Cycle",
    "vigor": "Sorcery",
    "cards": [...],
    "is_custom": true,
    "created_at": "...",
    "updated_at": "..."
  }
}
```

#### GET /api/player/:userId/decks
Get all decks owned by a player (prebuilt + custom).

**Response:**
```json
{
  "success": true,
  "decks": [...]
}
```

#### GET /api/player/:userId
Get player progression data.

**Response:**
```json
{
  "success": true,
  "player": {
    "user_id": "...",
    "level": 25,
    "prestige": 1,
    "xp": 500,
    "xp_to_next": 320,
    "total_xp": 864,
    "matches_played": 50,
    "matches_won": 30,
    "created_at": "...",
    "updated_at": "..."
  }
}
```

#### POST /api/player/:userId/xp
Add XP to a player.

**Request Body:**
```json
{
  "xp": 100,
  "mode": "multiplayer" // or "ai" (50% XP)
}
```

**Response:**
```json
{
  "success": true,
  "player": {...},
  "xpGained": 100
}
```

#### POST /api/player/:userId/prestige
Reset to level 1 and increase prestige tier.

**Requirements:**
- Must be level 50
- Must be below prestige 4

**Response:**
```json
{
  "success": true,
  "player": {
    "prestige": 2,
    "level": 1,
    "xp": 0,
    "xp_to_next": 120
  }
}
```

---

### Matchmaking Endpoints

#### POST /api/matchmaking/join
Join the matchmaking queue.

**Request Body:**
```json
{
  "userId": "...",
  "playerName": "PlayerName",
  "deck": {...}
}
```

**Response:**
```json
{
  "success": true,
  "message": "Joined matchmaking queue"
}
```

#### GET /api/matchmaking/check/:userId
Check for a match.

**Response:**
```json
{
  "success": true,
  "found": true,
  "game": {
    "id": "...",
    "players": [...]
  }
}
```

#### POST /api/matchmaking/leave
Leave the matchmaking queue.

**Request Body:**
```json
{
  "userId": "..."
}
```

---

### Game Match Endpoints

#### POST /api/match/:gameId/ready
Accept ready check for a match.

#### POST /api/match/:gameId/decline
Decline ready check (applies queue penalty).

---

## MongoDB Collections

### prebuilt_decks
Stores all prebuilt deck configurations.

**Schema:**
```javascript
{
  deck_name: String,
  set: String,
  vigor: String,
  cards: [{ name: String, quantity: Number }]
}
```

### player_decks
Stores player-owned decks (including custom decks).

**Schema:**
```javascript
{
  user_id: String,
  deck_name: String,
  set: String,
  vigor: String,
  cards: [{ name: String, quantity: Number }],
  is_custom: Boolean,
  created_at: Date,
  updated_at: Date
}
```

### player_progression
Stores player XP, level, and prestige.

**Schema:**
```javascript
{
  user_id: String,
  level: Number,
  prestige: Number,
  xp: Number,
  xp_to_next: Number,
  total_xp: Number,
  matches_played: Number,
  matches_won: Number,
  created_at: Date,
  updated_at: Date
}
```

### queue_penalties
Stores matchmaking penalty tracking.

**Schema:**
```javascript
{
  user_id: String,
  date: Date, // YYYY-MM-DD
  declines: Number,
  penalty_minutes: Number
}
```

### matchmaking_queue
Stores current matchmaking state.

**Schema:**
```javascript
{
  user_id: String,
  name: String,
  level: Number,
  prestige: Number,
  bracket: Number,
  deck: Object,
  queue_time: Date,
  status: String
}
```

### cards_<set_name>
Stores card gameplay data for each set.

**Schema:**
```javascript
{
  _id: String, // format: "set_name_card_name"
  name: String,
  type: String,
  vigor: String,
  rarity: String,
  attacks: [...],
  abilities: [...],
  health: Number,
  defense: Number,
  vigorCost: Number,
  // ... other gameplay fields
  standard_path: String, // Cloudinary image path
}
```

---

## XP Table (Configuration)

XP required to level up for each prestige tier:

**Prestige 0:** Levels 1-50 (5-level brackets)
**Prestige 1:** Levels 1-50 (10-level brackets)
**Prestige 2:** Levels 1-50 (10-level brackets)
**Prestige 3:** Levels 1-50 (10-level brackets)
**Prestige 4:** Levels 1-50 (10-level brackets)

See `server-multiplayer.js` lines 32-68 for full XP table.

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "success": false,
  "error": "Error message here"
}
```

Common HTTP status codes:
- 200: Success
- 401: Unauthorized (missing/invalid token)
- 404: Not found
- 500: Server error

---

## Frontend Integration

Use the `GameAuth` module from `game/game-auth.js`:

```javascript
// Get auth token
const token = await GameAuth.getAuthToken();

// Make authenticated request
const response = await GameAuth.authenticatedFetch('/api/decks/custom', {
  method: 'POST',
  body: JSON.stringify({ deckName: 'My Deck', ... })
});

const data = await response.json();
```

---

## NPM Scripts

```bash
# Start game server
npm run start-game

# Migrate MongoDB collections
npm run migrate-mongodb

# Migrate decks to MongoDB
npm run migrate-decks
```