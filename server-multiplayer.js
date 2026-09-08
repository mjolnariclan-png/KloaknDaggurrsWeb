const express = require('express');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');
const { v2: cloudinary } = require('cloudinary');
const app = express();
const PORT = process.env.PORT || 3005;

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://mjolnariclan17:JuPiTeR2015!@tcg-game-db.ak26dwh.mongodb.net/?appName=tcg-game-db&retryWrites=true&w=majority&tls=true&tlsAllowInvalidCertificates=true&serverSelectionTimeoutMS=5000';
const DB_NAME = 'tcg-game-db';

// Cloudinary Configuration
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'sywzs1w9',
    api_key: process.env.CLOUDINARY_API_KEY || '387367841542543',
    api_secret: process.env.CLOUDINARY_API_SECRET || 'Ths41qxona37vsd6-VC6meebtTk'
});

let db = null;
let client = null;

// Game state management
let games = {};
let lobbyPlayers = [];

// Card manifests cache (will be loaded from MongoDB)
let cardManifests = {};
let availableSets = [];

// XP Table (XP needed to go from level to next level)
const XP_TABLE = {
    prestige0: {
        1: 100, 2: 105, 3: 110, 4: 116, 5: 122, 6: 128, 7: 134, 8: 141, 9: 148, 10: 155,
        11: 163, 12: 171, 13: 179, 14: 188, 15: 197, 16: 207, 17: 217, 18: 228, 19: 239, 20: 251,
        21: 263, 22: 276, 23: 290, 24: 305, 25: 320, 26: 336, 27: 353, 28: 371, 29: 390, 30: 410,
        31: 431, 32: 452, 33: 475, 34: 499, 35: 524, 36: 550, 37: 578, 38: 607, 39: 637, 40: 669,
        41: 702, 42: 737, 43: 774, 44: 813, 45: 853, 46: 896, 47: 941, 48: 988, 49: 1037, 50: 0
    },
    prestige1: {
        1: 110, 2: 116, 3: 121, 4: 128, 5: 134, 6: 141, 7: 147, 8: 155, 9: 163, 10: 171,
        11: 179, 12: 188, 13: 197, 14: 207, 15: 217, 16: 228, 17: 239, 18: 251, 19: 263, 20: 276,
        21: 290, 22: 305, 23: 320, 24: 336, 25: 353, 26: 371, 27: 390, 28: 410, 29: 431, 30: 452,
        31: 475, 32: 499, 33: 524, 34: 550, 35: 578, 36: 607, 37: 637, 38: 669, 39: 702, 40: 737,
        41: 774, 42: 813, 43: 853, 44: 896, 45: 941, 46: 988, 47: 1037, 48: 1089, 49: 1141, 50: 0
    },
    prestige2: {
        1: 120, 2: 126, 3: 132, 4: 139, 5: 146, 6: 154, 7: 161, 8: 169, 9: 178, 10: 186,
        11: 196, 12: 205, 13: 215, 14: 226, 15: 236, 16: 248, 17: 260, 18: 274, 19: 287, 20: 301,
        21: 316, 22: 331, 23: 348, 24: 366, 25: 384, 26: 403, 27: 424, 28: 445, 29: 468, 30: 492,
        31: 517, 32: 542, 33: 570, 34: 599, 35: 629, 36: 660, 37: 694, 38: 728, 39: 764, 40: 803,
        41: 842, 42: 884, 43: 929, 44: 976, 45: 1024, 46: 1075, 47: 1129, 48: 1186, 49: 1244, 50: 0
    },
    prestige3: {
        1: 135, 2: 142, 3: 149, 4: 157, 5: 165, 6: 173, 7: 181, 8: 190, 9: 200, 10: 209,
        11: 220, 12: 231, 13: 242, 14: 254, 15: 266, 16: 280, 17: 293, 18: 308, 19: 323, 20: 339,
        21: 355, 22: 373, 23: 392, 24: 412, 25: 432, 26: 454, 27: 477, 28: 501, 29: 527, 30: 554,
        31: 582, 32: 610, 33: 641, 34: 674, 35: 707, 36: 743, 37: 780, 38: 819, 39: 860, 40: 903,
        41: 948, 42: 995, 43: 1045, 44: 1098, 45: 1152, 46: 1210, 47: 1270, 48: 1333, 49: 1400, 50: 0
    },
    prestige4: {
        1: 150, 2: 158, 3: 165, 4: 174, 5: 183, 6: 192, 7: 201, 8: 212, 9: 222, 10: 233,
        11: 245, 12: 257, 13: 269, 14: 282, 15: 296, 16: 311, 17: 326, 18: 342, 19: 359, 20: 377,
        21: 395, 22: 414, 23: 435, 24: 458, 25: 480, 26: 504, 27: 530, 28: 557, 29: 585, 30: 615,
        31: 647, 32: 678, 33: 713, 34: 749, 35: 786, 36: 825, 37: 867, 38: 911, 39: 956, 40: 1004,
        41: 1053, 42: 1106, 43: 1161, 44: 1220, 45: 1280, 46: 1344, 47: 1412, 48: 1482, 49: 1556, 50: 0
    }
};

// Get bracket for a given level and prestige
function getBracket(level, prestige) {
    if (prestige === 0) {
        // Prestige 0: 5-level brackets
        return Math.ceil(level / 5);
    } else {
        // Prestige 1-4: 10-level brackets
        return Math.ceil(level / 10);
    }
}

// Check if two levels are in the same bracket
function isSameBracket(level1, level2, prestige) {
    return getBracket(level1, prestige) === getBracket(level2, prestige);
}

// Check if two levels are in adjacent brackets (1-level difference)
function isAdjacentBracket(level1, level2, prestige) {
    const bracket1 = getBracket(level1, prestige);
    const bracket2 = getBracket(level2, prestige);
    return Math.abs(bracket1 - bracket2) === 1;
}

// Connect to MongoDB
async function connectToMongoDB() {
    try {
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('Connected to MongoDB Atlas');
        db = client.db(DB_NAME);

        // Load card sets from database
        await loadCardSetsFromDB();
        
        // Create indexes for progression collections
        await createProgressionIndexes();
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        console.log('Falling back to local file system');
        loadCardManifests(); // Fallback to local files
    }
}

// Create indexes for progression collections
async function createProgressionIndexes() {
    try {
        // Player progression collection
        const players = db.collection('players');
        await players.createIndex({ user_id: 1 }, { unique: true });
        await players.createIndex({ level: 1, prestige: 1 });
        
        // Queue penalties collection
        const penalties = db.collection('queue_penalties');
        await penalties.createIndex({ user_id: 1, date: 1 });
        
        // Game matches collection
        const matches = db.collection('game_matches');
        await matches.createIndex({ player1_id: 1 });
        await matches.createIndex({ player2_id: 1 });
        await matches.createIndex({ status: 1, created_at: 1 });
        
        console.log('Progression indexes created successfully');
    } catch (error) {
        console.error('Error creating indexes:', error);
    }
}

// Load card sets from MongoDB
async function loadCardSetsFromDB() {
    try {
        const setsCollection = db.collection('card_sets');
        const sets = await setsCollection.find({}, { projection: { set_name: 1, base_total: 1, type_distribution: 1 } }).toArray();

        availableSets = sets.map(set => set.set_name);
        console.log(`Found ${sets.length} card sets in MongoDB: ${availableSets.join(', ')}`);

        // Load each set's cards
        for (const set of sets) {
            const cardsCollection = db.collection(`cards_${set.set_name.replace(/\s+/g, '_')}`);
            const cards = await cardsCollection.find({}).toArray();
            cardManifests[set.set_name] = {
                set_name: set.set_name,
                base_total: set.base_total,
                type_distribution: set.type_distribution,
                cards: cards
            };
            console.log(`Loaded ${cards.length} cards for ${set.set_name}`);
        }
    } catch (error) {
        console.error('Error loading card sets from MongoDB:', error);
        // Fallback to local files
        loadCardManifests();
    }
}

// Fallback: Load card manifests from local files
function loadCardManifests() {
    const setsPath = 'B:\\Sets';
    if (!fs.existsSync(setsPath)) {
        console.log('Sets directory not found at B:\\Sets');
        return;
    }

    const sets = fs.readdirSync(setsPath).filter(dir => {
        const dirPath = path.join(setsPath, dir);
        return fs.statSync(dirPath).isDirectory();
    });

    availableSets = sets;
    console.log(`Found ${sets.length} card sets: ${sets.join(', ')}`);

    sets.forEach(setName => {
        const manifestPath = path.join(setsPath, setName, `${setName}_manifest.json`);
        if (fs.existsSync(manifestPath)) {
            try {
                const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                cardManifests[setName] = manifestData;
                console.log(`Loaded manifest for ${setName}: ${manifestData.cards.length} cards`);
            } catch (error) {
                console.error(`Error loading manifest for ${setName}:`, error.message);
            }
        }
    });
}

// CORS middleware to allow cross-origin requests
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Middleware to parse JSON
app.use(express.json());

// Serve static files from test game directory
app.use(express.static(__dirname));

// Serve card images from B:\Sets location
app.use('/cards', express.static('B:\\Sets'));

// Route for main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Get available card sets
app.get('/api/sets', (req, res) => {
    res.json({
        success: true,
        sets: availableSets.map(setName => ({
            name: setName,
            manifest: cardManifests[setName] ? {
                set_name: cardManifests[setName].set_name,
                base_total: cardManifests[setName].base_total,
                type_distribution: cardManifests[setName].type_distribution
            } : null
        }))
    });
});

// Get available decks
app.get('/api/decks', (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const decksDir = path.join(__dirname, 'decks');
        
        if (!fs.existsSync(decksDir)) {
            return res.json({ success: true, decks: [] });
        }
        
        const deckFiles = fs.readdirSync(decksDir).filter(file => file.endsWith('.json'));
        const decks = [];
        
        deckFiles.forEach(file => {
            try {
                const deckPath = path.join(decksDir, file);
                const deckData = JSON.parse(fs.readFileSync(deckPath, 'utf8'));
                decks.push({
                    name: deckData.deck_name,
                    set: deckData.set,
                    vigor: deckData.vigor,
                    file: file
                });
            } catch (error) {
                console.error(`Error reading deck file ${file}:`, error);
            }
        });
        
        res.json({ success: true, decks });
    } catch (error) {
        console.error('Error loading decks:', error);
        res.json({ success: false, error: error.message, decks: [] });
    }
});

// Get specific deck with full card data from MongoDB
app.get('/api/decks/:deckName', async (req, res) => {
    try {
        const { deckName } = req.params;
        const fs = require('fs');
        const path = require('path');
        const decksDir = path.join(__dirname, 'decks');
        
        // Find the deck file
        const deckFiles = fs.readdirSync(decksDir).filter(file => file.endsWith('.json'));
        let deckData = null;
        let deckFile = null;
        
        for (const file of deckFiles) {
            const deckPath = path.join(decksDir, file);
            const data = JSON.parse(fs.readFileSync(deckPath, 'utf8'));
            if (data.deck_name === deckName) {
                deckData = data;
                deckFile = file;
                break;
            }
        }
        
        if (!deckData) {
            return res.json({ success: false, error: 'Deck not found' });
        }
        
        // Look up full card data from MongoDB
        const cardsCollection = db.collection(`cards_${deckData.set.replace(/\s+/g, '_')}`);
        const fullDeck = [];
        
        for (const cardEntry of deckData.cards) {
            try {
                const card = await cardsCollection.findOne({ name: cardEntry.name });
                if (card) {
                    // Add quantity for this card
                    for (let i = 0; i < cardEntry.quantity; i++) {
                        fullDeck.push(card);
                    }
                } else {
                    console.warn(`Card not found in MongoDB: ${cardEntry.name}`);
                }
            } catch (error) {
                console.error(`Error looking up card ${cardEntry.name}:`, error);
            }
        }
        
        res.json({
            success: true,
            deck: {
                name: deckData.deck_name,
                set: deckData.set,
                vigor: deckData.vigor,
                cards: fullDeck
            }
        });
    } catch (error) {
        console.error('Error loading deck:', error);
        res.json({ success: false, error: error.message });
    }
});

// Get cards from a specific set
app.get('/api/cards/:setName', (req, res) => {
    const { setName } = req.params;
    const { type, vigorType } = req.query;

    if (!cardManifests[setName]) {
        return res.json({ success: false, error: 'Set not found' });
    }

    let cards = cardManifests[setName].cards;

    // Filter by type if specified
    if (type) {
        cards = cards.filter(card => card.type.toLowerCase() === type.toLowerCase());
    }

    // Filter by vigor type if specified
    if (vigorType) {
        cards = cards.filter(card => {
            const cardVigor = card.vigor || card.vigor_type;
            return cardVigor && cardVigor.toLowerCase() === vigorType.toLowerCase();
        });
    }

    res.json({
        success: true,
        cards: cards,
        total: cards.length
    });
});

// Join lobby endpoint
app.post('/api/join-lobby', (req, res) => {
    const { playerId, playerName } = req.body;
    
    console.log(`Player ${playerName} (${playerId}) joining lobby`);
    
    // Check if player is already in lobby
    const existingPlayer = lobbyPlayers.find(p => p.id === playerId);
    if (existingPlayer) {
        existingPlayer.name = playerName || existingPlayer.name;
        existingPlayer.lastSeen = Date.now();
    } else {
        lobbyPlayers.push({
            id: playerId,
            name: playerName || 'Waiting Player',
            lastSeen: Date.now()
        });
    }
    
    res.json({
        success: true,
        message: 'Joined lobby successfully'
    });
    
    console.log(`Lobby players: ${lobbyPlayers.length}`);
});

// Get lobby players endpoint
app.get('/api/lobby-players', (req, res) => {
    // Remove players who haven't been seen in 30 seconds
    const now = Date.now();
    lobbyPlayers = lobbyPlayers.filter(p => now - p.lastSeen < 30000);
    
    // Update last seen for requesting player
    const playerId = req.query.playerId;
    if (playerId) {
        const player = lobbyPlayers.find(p => p.id === playerId);
        if (player) {
            player.lastSeen = now;
            
            // Check if this player has been invited to a game
            if (player.gameId) {
                const game = games[player.gameId];
                if (game) {
                    // Find which player index this is
                    const playerIndex = game.players.findIndex(p => p.id === playerId);
                    res.json({
                        success: true,
                        players: lobbyPlayers,
                        gameInvitation: {
                            gameId: game.id,
                            opponentName: game.players[1 - playerIndex].name,
                            playerIndex: playerIndex,
                            goesFirst: playerIndex === game.currentTurn,
                            coinFlipResult: game.coinFlipResult,
                            gameState: game
                        }
                    });
                    return;
                }
            }
        }
    }
    
    res.json({
        success: true,
        players: lobbyPlayers,
        gameInvitation: null
    });
});

// Challenge player endpoint
app.post('/api/challenge-player', (req, res) => {
    const { playerId, opponentId, cardSet, vigorType } = req.body;

    console.log(`Player ${playerId} challenging ${opponentId}`);
    console.log(`Card set: ${cardSet}, Vigor type: ${vigorType}`);

    const challenger = lobbyPlayers.find(p => p.id === playerId);
    const opponent = lobbyPlayers.find(p => p.id === opponentId);

    if (!challenger || !opponent) {
        return res.json({ success: false, error: 'Player not found in lobby' });
    }

    // Create game
    const gameId = `game_${Date.now()}`;

    // Coin flip to determine who goes first
    const coinFlip = Math.random() < 0.5;
    const firstPlayerIndex = coinFlip ? 0 : 1;

    // Determine which player is which index
    const challengerIndex = challenger.id === playerId ? 0 : 1;
    const opponentIndex = 1 - challengerIndex;

    games[gameId] = {
        id: gameId,
        players: [
            { id: challenger.id, name: challenger.name, life: 30, mana: 0, hand: [], battlefield: [], deck: [], isReady: false, vigorUsedThisTurn: 0 },
            { id: opponent.id, name: opponent.name, life: 30, mana: 0, hand: [], battlefield: [], deck: [], isReady: false, vigorUsedThisTurn: 0 }
        ],
        currentTurn: firstPlayerIndex,
        phase: 'vigor',
        lastUpdate: Date.now(),
        coinFlipResult: coinFlip,
        challengerId: playerId,
        opponentId: opponentId,
        cardSet: cardSet || 'Ash Cycle',
        vigorType: vigorType || null
    };

    // Generate decks for both players using the selected card set and vigor type
    generateDeck(games[gameId].players[0], cardSet || 'Ash Cycle', vigorType || null);
    generateDeck(games[gameId].players[1], cardSet || 'Ash Cycle', vigorType || null);
    generateDeck(games[gameId].players[1]);
    
    // Mark players as being in this game (so they can be found later)
    challenger.gameId = gameId;
    opponent.gameId = gameId;
    
    // Respond to challenger
    res.json({
        success: true,
        gameId: gameId,
        opponentName: games[gameId].players[opponentIndex].name,
        playerIndex: challengerIndex,
        goesFirst: challengerIndex === firstPlayerIndex,
        coinFlipResult: coinFlip,
        gameState: games[gameId]
    });
    
    console.log(`Game created: ${gameId} between ${challenger.name} and ${opponent.name}`);
    console.log(`Coin flip: ${coinFlip ? 'Heads' : 'Tails'}, ${games[gameId].players[firstPlayerIndex].name} goes first`);
    console.log(`Challenger (${challenger.name}) sent to game. Opponent (${opponent.name}) needs to poll for game.`);
});

// Decline game endpoint
app.post('/api/decline-game', (req, res) => {
    const { gameId, playerId } = req.body;
    
    console.log(`Player ${playerId} declining game ${gameId}`);
    
    const game = games[gameId];
    if (game) {
        // Remove the game
        delete games[gameId];
        
        // Return players to lobby
        const player1 = game.players[0];
        const player2 = game.players[1];
        
        if (player1.id !== playerId) {
            // The challenger is still waiting, return them to lobby
            lobbyPlayers.push({
                id: player1.id,
                name: player1.name,
                lastSeen: Date.now()
            });
        }
        
        if (player2.id !== playerId) {
            // The other player is still waiting, return them to lobby
            lobbyPlayers.push({
                id: player2.id,
                name: player2.name,
                lastSeen: Date.now()
            });
        }
    }
    
    res.json({ success: true });
});

// Regular HTTP routes
app.get('/api/player-hand', (req, res) => {
    res.json([]); // Return empty for now
});

app.get('/api/battlefield', (req, res) => {
    res.json([]); // Return empty for now
});

// Get game state endpoint
app.get('/api/game-state/:gameId', (req, res) => {
    const gameId = req.params.gameId;
    const game = games[gameId];
    
    if (game) {
        res.json({
            success: true,
            gameState: game
        });
    } else {
        res.json({
            success: false,
            error: 'Game not found'
        });
    }
});

// Play card endpoint
app.post('/api/play-card', (req, res) => {
    const { gameId, playerId, cardIndex } = req.body;
    const game = games[gameId];
    
    if (!game) {
        return res.json({ success: false, error: 'Game not found' });
    }
    
    const player = game.players.find(p => p.id === playerId);
    if (!player) {
        return res.json({ success: false, error: 'Player not found' });
    }
    
    // Check if it's player's turn
    if (game.players[game.currentTurn].id !== playerId) {
        return res.json({ success: false, error: 'Not your turn' });
    }
    
    // Check if in play phase
    if (game.phase !== 'play') {
        return res.json({ success: false, error: 'Can only play cards during Play Phase' });
    }
    
    const card = player.hand[cardIndex];
    
    if (!card) {
        return res.json({ success: false, error: 'Card not found' });
    }
    
    // Calculate available vigor (total vigor - vigor used this turn)
    const totalVigor = player.battlefield.filter(c => c.type === 'vigor').length;
    const availableVigor = totalVigor - (player.vigorUsedThisTurn || 0);

    console.log(`Player ${player.name} trying to play card: ${card.name}`);
    console.log(`Card cost: ${card.cost}, Total vigor: ${totalVigor}, Available: ${availableVigor}`);

    if (card.cost > availableVigor) {
        console.log(`Not enough vigor. Need ${card.cost}, have ${availableVigor}`);
        return res.json({ success: false, error: `Not enough vigor. Need ${card.cost}, have ${availableVigor}` });
    }
    
    // Check creature limit (max 5, primordial doesn't count)
    if (card.type === 'creature') {
        const creatureCount = player.battlefield.filter(c => c.type === 'creature').length;
        if (creatureCount >= 5) {
            return res.json({ success: false, error: 'Maximum 5 creatures allowed on battlefield' });
        }
    }
    
    // Track vigor used this turn
    player.vigorUsedThisTurn = (player.vigorUsedThisTurn || 0) + card.cost;

    player.hand.splice(cardIndex, 1);

    if (card.type === 'creature' || card.type === 'primordial') {
        // Remove summoning sickness - can attack immediately
        card.canAttack = true;
        if (card.type === 'creature') {
            card.hasHaste = false;
        }
        player.battlefield.push(card);
        console.log(`${card.type} played to battlefield`);
    } else if (card.type === 'equipment') {
        // Equipment needs to be attached to a creature - not allowed here
        return res.json({ success: false, error: 'Equipment must be attached using the equipment endpoint' });
    } else if (card.type === 'vigor') {
        // Vigor cards are played to battlefield
        player.battlefield.push(card);
        console.log(`Vigor played. Total vigor on battlefield: ${player.battlefield.filter(c => c.type === 'vigor').length}`);
    } else if (card.type === 'rune') {
        // Equipment needs to be attached to a creature
        // Return error if no target specified
        return res.json({ success: false, error: 'Equipment must be attached to a creature' });
    } else if (card.type === 'rune') {
        // Handle spell effect
        const opponent = game.players.find(p => p !== player);
        opponent.life -= Math.floor(Math.random() * 5) + 3;
        console.log(`Rune cast, dealt damage to opponent`);
    }
    
    game.lastUpdate = Date.now();
    res.json({ success: true, gameState: game });
});

// Attack endpoint
app.post('/api/attack', (req, res) => {
    const { gameId, playerId, attackerIndex, targetIndex, targetPlayer } = req.body;
    const game = games[gameId];
    
    if (!game) {
        return res.json({ success: false, error: 'Game not found' });
    }
    
    const player = game.players.find(p => p.id === playerId);
    const opponent = game.players.find(p => p !== player);
    
    if (!player || !opponent) {
        return res.json({ success: false, error: 'Player not found' });
    }
    
    // Check if it's player's turn
    if (game.players[game.currentTurn].id !== playerId) {
        return res.json({ success: false, error: 'Not your turn' });
    }
    
    // Check if in attack phase
    if (game.phase !== 'attack') {
        return res.json({ success: false, error: 'Can only attack during Attack Phase' });
    }
    
    const attacker = player.battlefield[attackerIndex];
    
    if (!attacker) {
        return res.json({ success: false, error: 'Attacker not found' });
    }
    
    if (attacker.type !== 'creature' && attacker.type !== 'primordial') {
        return res.json({ success: false, error: 'Only creatures and primordials can attack' });
    }
    
    if (!attacker.canAttack && !attacker.hasHaste) {
        return res.json({ success: false, error: 'Unit has summoning sickness' });
    }
    
    // Check attack priority rules
    const opponentPrimordial = opponent.battlefield.find(c => c.type === 'primordial');
    const opponentCreatures = opponent.battlefield.filter(c => c.type === 'creature');
    
    console.log(`Attack attempt by ${player.name}`);
    console.log(`Opponent has primordial: ${!!opponentPrimordial}`);
    console.log(`Opponent has ${opponentCreatures.length} creatures`);
    console.log(`Target type: ${targetPlayer ? 'player' : 'creature'}`);
    
    // Priority: Primordial > Creatures > Player
    if (opponentPrimordial) {
        // Must attack primordial first
        if (targetPlayer) {
            return res.json({ success: false, error: 'Must attack Primordial first' });
        }
        const target = opponent.battlefield[targetIndex];
        if (target.type !== 'primordial') {
            return res.json({ success: false, error: 'Must attack Primordial first' });
        }
    } else if (opponentCreatures.length > 0) {
        // Must attack creatures first
        if (targetPlayer) {
            return res.json({ success: false, error: 'Must attack creatures first' });
        }
        const target = opponent.battlefield[targetIndex];
        if (target.type !== 'creature') {
            return res.json({ success: false, error: 'Must attack creatures first' });
        }
    }
    
    // Execute attack
    if (targetPlayer) {
        // Attack player directly
        opponent.life -= attacker.attack;
        console.log(`Attacked player directly for ${attacker.attack} damage`);
    } else {
        // Attack creature/primordial
        const target = opponent.battlefield[targetIndex];
        if (target) {
            target.defense -= attacker.attack;
            console.log(`Attacked ${target.name} for ${attacker.attack} damage`);
            
            if (target.defense <= 0) {
                opponent.battlefield.splice(targetIndex, 1);
                console.log(`${target.name} destroyed`);
            }
        }
    }
    
    // Attacker takes damage back (combat damage)
    if (!targetPlayer) {
        const target = opponent.battlefield[targetIndex];
        if (target && target.attack) {
            attacker.defense -= target.attack;
            if (attacker.defense <= 0) {
                player.battlefield.splice(attackerIndex, 1);
                console.log(`${attacker.name} destroyed in combat`);
            }
        }
    }
    
    game.lastUpdate = Date.now();
    res.json({ success: true, gameState: game });
});

// End turn endpoint
app.post('/api/end-turn', (req, res) => {
    const { gameId, playerId } = req.body;
    const game = games[gameId];
    
    if (!game) {
        return res.json({ success: false, error: 'Game not found' });
    }
    
    game.currentTurn = (game.currentTurn + 1) % 2;
    const currentPlayer = game.players[game.currentTurn];
    
    // Start at vigor phase
    game.phase = 'vigor';

    // Reset vigor used this turn
    currentPlayer.vigorUsedThisTurn = 0;

    // Auto-play vigor from hand (stack up vigor)
    const vigorCards = currentPlayer.hand.filter(c => c.type === 'vigor');
    vigorCards.forEach(card => {
        const index = currentPlayer.hand.indexOf(card);
        currentPlayer.hand.splice(index, 1);
        currentPlayer.battlefield.push(card);
    });

    // Calculate vigor (stacks up - count all vigor on battlefield)
    currentPlayer.mana = currentPlayer.battlefield.filter(c => c.type === 'vigor').length;

    // Enable creatures and primordials to attack (they've been on battlefield for a full turn)
    currentPlayer.battlefield.forEach(card => {
        if (card.type === 'creature' || card.type === 'primordial') {
            card.canAttack = true;
        }
    });
    
    // Draw card
    if (currentPlayer.deck.length > 0) {
        const card = currentPlayer.deck.pop();
        if (card.type === 'primordial') {
            // Primordials start with canAttack = false (summoning sickness)
            card.canAttack = false;
            currentPlayer.battlefield.push(card);
        } else {
            currentPlayer.hand.push(card);
        }
    }
    
    game.lastUpdate = Date.now();
    res.json({ success: true, gameState: game });
});

// Advance phase endpoint
app.post('/api/advance-phase', (req, res) => {
    const { gameId, playerId } = req.body;
    const game = games[gameId];
    
    if (!game) {
        return res.json({ success: false, error: 'Game not found' });
    }
    
    const phases = ['vigor', 'draw', 'play', 'attack'];
    const currentPhaseIndex = phases.indexOf(game.phase);
    
    if (currentPhaseIndex === -1) {
        return res.json({ success: false, error: 'Invalid phase' });
    }
    
    const currentPlayer = game.players[game.currentTurn];
    
    if (currentPhaseIndex < phases.length - 1) {
        // Advance to next phase
        game.phase = phases[currentPhaseIndex + 1];
        
        // Phase-specific actions
        if (game.phase === 'vigor') {
            // Vigor Phase: Reset vigor based on vigor cards on battlefield
            currentPlayer.vigorUsedThisTurn = 0;
            // Auto-play vigor from hand
            const vigorCards = currentPlayer.hand.filter(c => c.type === 'vigor');
            vigorCards.forEach(card => {
                const index = currentPlayer.hand.indexOf(card);
                currentPlayer.hand.splice(index, 1);
                currentPlayer.battlefield.push(card);
            });
            const totalVigor = currentPlayer.battlefield.filter(c => c.type === 'vigor').length;
            currentPlayer.mana = totalVigor;
            console.log(`Vigor Phase: ${currentPlayer.name} has ${totalVigor} vigor from battlefield`);
        } else if (game.phase === 'draw') {
            // Draw Phase: Draw 1 card
            if (currentPlayer.deck.length > 0) {
                const card = currentPlayer.deck.pop();
                if (card.type === 'primordial') {
                    card.canAttack = true; // Can attack immediately
                    currentPlayer.battlefield.push(card);
                } else if (card.type === 'vigor') {
                    // Vigor cards go directly to battlefield
                    currentPlayer.battlefield.push(card);
                } else {
                    currentPlayer.hand.push(card);
                }
            }
        } else if (game.phase === 'play') {
            // Play Phase: Nothing automatic, just allow playing cards
        } else if (game.phase === 'attack') {
            // Attack Phase: Enable creatures/primordials to attack
            currentPlayer.battlefield.forEach(card => {
                if (card.type === 'creature' || card.type === 'primordial') {
                    card.canAttack = true;
                }
            });
        }
    } else {
        // End of phases, end turn
        game.currentTurn = (game.currentTurn + 1) % 2;
        const nextPlayer = game.players[game.currentTurn];
        game.phase = 'vigor';
        
        // Reset vigor used this turn for next player
        nextPlayer.vigorUsedThisTurn = 0;

        // Auto-play vigor from hand for next player
        const vigorCards = nextPlayer.hand.filter(c => c.type === 'vigor');
        vigorCards.forEach(card => {
            const index = nextPlayer.hand.indexOf(card);
            nextPlayer.hand.splice(index, 1);
            nextPlayer.battlefield.push(card);
        });
        nextPlayer.mana = nextPlayer.battlefield.filter(c => c.type === 'vigor').length;
    }
    
    game.lastUpdate = Date.now();
    res.json({ success: true, gameState: game });
});

// Draw card endpoint
app.post('/api/draw-card', (req, res) => {
    const { gameId, playerId } = req.body;
    const game = games[gameId];
    
    if (!game) {
        return res.json({ success: false, error: 'Game not found' });
    }
    
    const player = game.players.find(p => p.id === playerId);
    if (!player) {
        return res.json({ success: false, error: 'Player not found' });
    }
    
    if (player.deck.length > 0 && player.hand.length < 10) {
        const card = player.deck.pop();
        if (card.type === 'primordial') {
            player.battlefield.push(card);
        } else if (card.type === 'vigor') {
            // Vigor cards go directly to battlefield
            player.battlefield.push(card);
        } else {
            player.hand.push(card);
        }

        game.lastUpdate = Date.now();
        res.json({ success: true, gameState: game, drawnCard: card });
    } else {
        game.lastUpdate = Date.now();
        res.json({ success: true, gameState: game, drawnCard: null });
    }
});

// Attach equipment endpoint
app.post('/api/attach-equipment', (req, res) => {
    const { gameId, playerId, equipmentIndex, targetCreatureIndex } = req.body;
    const game = games[gameId];
    
    if (!game) {
        return res.json({ success: false, error: 'Game not found' });
    }
    
    const player = game.players.find(p => p.id === playerId);
    if (!player) {
        return res.json({ success: false, error: 'Player not found' });
    }
    
    // Check if it's player's turn
    if (game.players[game.currentTurn].id !== playerId) {
        return res.json({ success: false, error: 'Not your turn' });
    }
    
    // Check if in play phase
    if (game.phase !== 'play') {
        return res.json({ success: false, error: 'Can only attach equipment during Play Phase' });
    }
    
    const equipment = player.hand[equipmentIndex];
    const targetCreature = player.battlefield[targetCreatureIndex];
    
    if (!equipment) {
        return res.json({ success: false, error: 'Equipment not found' });
    }
    
    if (equipment.type !== 'equipment') {
        return res.json({ success: false, error: 'Selected card is not equipment' });
    }
    
    if (!targetCreature) {
        return res.json({ success: false, error: 'Target creature not found' });
    }
    
    if (targetCreature.type !== 'creature' && targetCreature.type !== 'primordial') {
        return res.json({ success: false, error: 'Target must be a creature or primordial' });
    }
    
    // Check if target already has equipment
    if (targetCreature.equipment) {
        return res.json({ success: false, error: 'Target already has equipment' });
    }
    
    // Check if player has enough vigor
    const totalVigor = player.battlefield.filter(c => c.type === 'vigor').length;
    const availableVigor = totalVigor - (player.vigorUsedThisTurn || 0);

    if (equipment.cost > availableVigor) {
        return res.json({ success: false, error: `Not enough vigor. Need ${equipment.cost}, have ${availableVigor}` });
    }
    
    // Deduct equipment cost from vigor
    player.vigorUsedThisTurn = (player.vigorUsedThisTurn || 0) + equipment.cost;
    
    // Attach equipment to creature
    targetCreature.equipment = equipment;
    targetCreature.attack += equipment.attack;
    targetCreature.defense += equipment.defense;
    
    // Remove equipment from hand
    player.hand.splice(equipmentIndex, 1);
    
    console.log(`Equipment ${equipment.name} attached to ${targetCreature.name}`);
    console.log(`New stats: Attack ${targetCreature.attack}, Defense ${targetCreature.defense}`);
    
    game.lastUpdate = Date.now();
    res.json({ success: true, gameState: game });
});

// Auto-play vigor endpoint
app.post('/api/auto-play-vigor', (req, res) => {
    const { gameId, playerId } = req.body;
    const game = games[gameId];

    if (!game) {
        return res.json({ success: false, error: 'Game not found' });
    }

    const player = game.players.find(p => p.id === playerId);
    if (!player) {
        return res.json({ success: false, error: 'Player not found' });
    }

    const vigorCards = player.hand.filter(c => c.type === 'vigor');
    vigorCards.forEach(card => {
        const index = player.hand.indexOf(card);
        player.hand.splice(index, 1);
        player.battlefield.push(card);
    });
    player.mana = player.battlefield.filter(c => c.type === 'vigor').length;

    game.lastUpdate = Date.now();
    res.json({ success: true, gameState: game });
});

function generateDeck(player, setName = 'Ash Cycle', vigorType = null) {
    // Generate deck based on exact rules using manifest data:
    // 1 Primordial (required)
    // Up to 22 Vigor cards
    // Up to 24 Creatures
    // Up to 7 Accoutrements (Equipment)
    // Up to 6 Runes
    const deck = [];

    if (!cardManifests[setName]) {
        console.log(`Set ${setName} not found, using fallback generation`);
        return generateFallbackDeck(player);
    }

    const manifest = cardManifests[setName];
    const cards = manifest.cards;

    // Helper function to convert local paths to Cloudinary URLs
    function convertImagePath(originalPath, setName) {
        if (!originalPath) return null;
        
        // If it's already a Cloudinary URL, return it as-is
        if (originalPath.startsWith('http://') || originalPath.startsWith('https://')) {
            return originalPath;
        }
        
        // Convert from B:\Cards\Chaos\Vigor\Chaos_Warpbinder.png
        // to Cloudinary URL with nested folders
        const relativePath = originalPath.replace('B:\\Cards', `B:\\Sets\\${setName}`);
        const fileName = path.basename(relativePath);
        const folderStructure = path.dirname(relativePath).replace('B:\\Sets\\', '').replace(/\\/g, '/');
        
        // Generate Cloudinary URL with nested folder structure
        const fullFolderPath = `tcg-cards/${folderStructure}`;
        const publicId = fileName.replace(/\.[^/.]+$/, '');
        return cloudinary.url(`${fullFolderPath}/${publicId}`);
    }

    // Helper function to convert manifest card to game card
    const convertCard = (manifestCard) => {
        const baseCard = {
            name: manifestCard.name,
            type: manifestCard.type.toLowerCase(),
            image: convertImagePath(manifestCard.standard_path || manifestCard.image, setName),
            cost: parseInt(manifestCard['Mana Card Cost']) || 0,
            vigor: manifestCard.vigor || manifestCard.vigor_type || null,
            rarity: manifestCard.rarity || null
        };

        // Type-specific conversions
        if (baseCard.type === 'vigor') {
            baseCard.attack = 0;
            baseCard.defense = 0;
        } else if (baseCard.type === 'creature' || baseCard.type === 'primordial') {
            baseCard.attack = parseInt(manifestCard.ap?.replace('AP ', '')) || 1;
            baseCard.defense = parseInt(manifestCard.dp?.replace('DP ', '')) || 1;
            baseCard.className = manifestCard.className || '';
            baseCard.attacks = manifestCard.attacks || [];
            baseCard.strength = manifestCard.strength?.Vigor || null;
            baseCard.weakness = manifestCard.weakness?.Vigor || null;
            baseCard.hasHaste = false; // Will be set randomly
            baseCard.canAttack = false; // Summoning sickness
            if (baseCard.type === 'primordial') {
                baseCard.isPrimordial = true;
            }
        } else if (baseCard.type === 'accoutrements' || baseCard.type === 'equipment') {
            baseCard.attack = 0; // Will be set based on equipment stats
            baseCard.defense = 0; // Will be set based on equipment stats
            baseCard.type = 'equipment'; // Normalize to equipment
        } else if (baseCard.type === 'rune') {
            baseCard.attack = 0;
            baseCard.defense = 0;
        }

        return baseCard;
    };

    // Filter cards by type and vigor type
    const filterCards = (type, vigorFilter = null) => {
        return cards.filter(card => {
            if (card.type.toLowerCase() !== type.toLowerCase()) return false;
            if (vigorFilter) {
                const cardVigor = card.vigor || card.vigor_type;
                if (!cardVigor || cardVigor.toLowerCase() !== vigorFilter.toLowerCase()) return false;
            }
            return true;
        });
    };

    // Get cards for each type
    let vigorCards = filterCards('vigor', vigorType);
    let creatureCards = filterCards('creature', vigorType);
    let primordialCards = filterCards('primordial', vigorType);
    let equipmentCards = filterCards('accoutrements', vigorType).concat(filterCards('equipment', vigorType));
    let runeCards = filterCards('rune', vigorType);

    // If not enough cards with vigor type, get all cards of that type
    if (vigorType) {
        if (vigorCards.length === 0) vigorCards = filterCards('vigor');
        if (creatureCards.length === 0) creatureCards = filterCards('creature');
        if (primordialCards.length === 0) primordialCards = filterCards('primordial');
        if (equipmentCards.length === 0) equipmentCards = filterCards('accoutrements').concat(filterCards('equipment'));
        if (runeCards.length === 0) runeCards = filterCards('rune');
    }

    // Shuffle and select cards
    const shuffleAndSelect = (cardArray, count) => {
        const shuffled = [...cardArray].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, Math.min(count, shuffled.length));
    };

    // 1 Primordial (required)
    const selectedPrimordials = shuffleAndSelect(primordialCards, 1);
    if (selectedPrimordials.length > 0) {
        const primordial = convertCard(selectedPrimordials[0]);
        primordial.canAttack = false; // Summoning sickness
        deck.push(primordial);
    } else {
        // Fallback if no primordials available
        deck.push({ type: 'primordial', name: 'Primordial King', cost: 5, attack: 10, defense: 10, isPrimordial: true, canAttack: false });
    }

    // 22 Vigor cards (maximum)
    const selectedVigor = shuffleAndSelect(vigorCards, 22);
    selectedVigor.forEach(card => deck.push(convertCard(card)));

    // Fill remaining vigor slots if needed
    while (deck.filter(c => c.type === 'vigor').length < 22) {
        deck.push({ type: 'vigor', name: 'Vigor', cost: 0, attack: 0, defense: 0, vigor: vigorType });
    }

    // 24 Creatures (maximum)
    const selectedCreatures = shuffleAndSelect(creatureCards, 24);
    selectedCreatures.forEach(card => {
        const creature = convertCard(card);
        creature.hasHaste = Math.random() < 0.2; // 20% chance of haste
        deck.push(creature);
    });

    // Fill remaining creature slots if needed
    while (deck.filter(c => c.type === 'creature').length < 24) {
        const attack = Math.floor(Math.random() * 5) + 1;
        const defense = Math.floor(Math.random() * 5) + 1;
        deck.push({
            type: 'creature',
            name: `Creature ${deck.filter(c => c.type === 'creature').length + 1}`,
            cost: 1,
            attack: attack,
            defense: defense,
            hasHaste: Math.random() < 0.2,
            vigor: vigorType
        });
    }

    // 7 Accoutrements/Equipment (maximum)
    const selectedEquipment = shuffleAndSelect(equipmentCards, 7);
    selectedEquipment.forEach(card => {
        const equipment = convertCard(card);
        // Set random equipment stats
        equipment.attack = Math.floor(Math.random() * 2);
        equipment.defense = Math.floor(Math.random() * 2);
        deck.push(equipment);
    });

    // Fill remaining equipment slots if needed
    while (deck.filter(c => c.type === 'equipment').length < 7) {
        deck.push({
            type: 'equipment',
            name: `Equipment ${deck.filter(c => c.type === 'equipment').length + 1}`,
            cost: 1,
            attack: Math.floor(Math.random() * 2),
            defense: Math.floor(Math.random() * 2),
            vigor: vigorType
        });
    }

    // 6 Runes (maximum)
    const selectedRunes = shuffleAndSelect(runeCards, 6);
    selectedRunes.forEach(card => deck.push(convertCard(card)));

    // Fill remaining rune slots if needed
    while (deck.filter(c => c.type === 'rune').length < 6) {
        deck.push({
            type: 'rune',
            name: `Rune ${deck.filter(c => c.type === 'rune').length + 1}`,
            cost: Math.floor(Math.random() * 3) + 1,
            attack: 0,
            defense: 0,
            vigor: vigorType
        });
    }

    // Shuffle the final deck
    deck.sort(() => Math.random() - 0.5);

    console.log(`Generated deck for ${setName} with ${vigorType || 'mixed'} vigor: ${deck.length} cards`);
    return deck;
}

function generateFallbackDeck(player) {
    // Fallback deck generation if manifests aren't available
    const deck = [];

    // 1 Primordial (required)
    deck.push({ type: 'primordial', name: 'Primordial King', cost: 5, attack: 10, defense: 10, isPrimordial: true, canAttack: false });

    // 22 Vigor cards (maximum)
    for (let i = 0; i < 22; i++) {
        deck.push({ type: 'vigor', name: 'Vigor', cost: 0, attack: 0, defense: 0 });
    }

    // 24 Creatures (maximum)
    for (let i = 0; i < 24; i++) {
        const attack = Math.floor(Math.random() * 5) + 1;
        const defense = Math.floor(Math.random() * 5) + 1;
        const cost = 1;
        const hasHaste = Math.random() < 0.2;
        deck.push({ type: 'creature', name: `Creature ${i+1}`, cost: cost, attack: attack, defense: defense, hasHaste: hasHaste });
    }

    // 7 Accoutrements/Equipment (maximum)
    for (let i = 0; i < 7; i++) {
        const attack = Math.floor(Math.random() * 2);
        const defense = Math.floor(Math.random() * 2);
        const cost = 1;
        deck.push({ type: 'equipment', name: `Equipment ${i+1}`, cost: cost, attack: attack, defense: defense });
    }

    // 6 Runes (maximum)
    for (let i = 0; i < 6; i++) {
        const cost = Math.floor(Math.random() * 3) + 1;
        deck.push({ type: 'rune', name: `Rune ${i+1}`, cost: cost, attack: 0, defense: 0 });
    }

    deck.sort(() => Math.random() - 0.5);
    return deck;
    
    // Shuffle deck
    deck.sort(() => Math.random() - 0.5);
    player.deck = deck;
    
    // Draw initial hand (7 cards)
    for (let i = 0; i < 7; i++) {
        const card = player.deck.pop();
        if (card.type === 'primordial') {
            // Primordials start with canAttack = false (summoning sickness)
            card.canAttack = false;
            player.battlefield.push(card);
        } else {
            player.hand.push(card);
        }
    }

    // Initial vigor reset (start with 0 vigor)
    player.totalVigor = 0;
    player.mana = 0;
}

// ==================== PROGRESSION SYSTEM ====================

// Get or create player progression
app.get('/api/player/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const players = db.collection('players');
        
        let player = await players.findOne({ user_id: userId });
        
        if (!player) {
            // Create new player progression
            player = {
                user_id: userId,
                level: 1,
                prestige: 0,
                xp: 0,
                xp_to_next: XP_TABLE.prestige0[1],
                total_xp: 0,
                matches_played: 0,
                matches_won: 0,
                created_at: new Date(),
                last_played: new Date()
            };
            await players.insertOne(player);
        }
        
        res.json({ success: true, player });
    } catch (error) {
        console.error('Error getting player progression:', error);
        res.json({ success: false, error: error.message });
    }
});

// Add XP to player
app.post('/api/player/:userId/xp', async (req, res) => {
    try {
        const { userId } = req.params;
        const { xp, mode } = req.body; // mode: 'ai' (50%), 'multiplayer' (100%)
        
        const players = db.collection('players');
        const player = await players.findOne({ user_id: userId });
        
        if (!player) {
            return res.json({ success: false, error: 'Player not found' });
        }
        
        // Calculate XP based on mode
        let xpGained = xp;
        if (mode === 'ai') {
            xpGained = Math.floor(xp * 0.5); // 50% for AI
        }
        
        player.xp += xpGained;
        player.total_xp += xpGained;
        player.last_played = new Date();
        
        // Check for level up
        const xpTable = XP_TABLE[`prestige${player.prestige}`];
        while (player.xp >= xpTable[player.level] && player.level < 50) {
            player.xp -= xpTable[player.level];
            player.level += 1;
            player.xp_to_next = xpTable[player.level] || 0;
        }
        
        await players.updateOne(
            { user_id: userId },
            { $set: { 
                xp: player.xp,
                total_xp: player.total_xp,
                level: player.level,
                xp_to_next: player.xp_to_next,
                last_played: player.last_played
            }}
        );
        
        res.json({ success: true, player, xpGained });
    } catch (error) {
        console.error('Error adding XP:', error);
        res.json({ success: false, error: error.message });
    }
});

// Prestige (reset to level 1, increase prestige tier)
app.post('/api/player/:userId/prestige', async (req, res) => {
    try {
        const { userId } = req.params;
        const players = db.collection('players');
        const player = await players.findOne({ user_id: userId });
        
        if (!player) {
            return res.json({ success: false, error: 'Player not found' });
        }
        
        if (player.level < 50) {
            return res.json({ success: false, error: 'Must be level 50 to prestige' });
        }
        
        if (player.prestige >= 4) {
            return res.json({ success: false, error: 'Already at maximum prestige' });
        }
        
        // Reset level, increase prestige
        player.prestige += 1;
        player.level = 1;
        player.xp = 0;
        player.xp_to_next = XP_TABLE[`prestige${player.prestige}`][1];
        
        await players.updateOne(
            { user_id: userId },
            { $set: { 
                prestige: player.prestige,
                level: player.level,
                xp: player.xp,
                xp_to_next: player.xp_to_next
            }}
        );
        
        res.json({ success: true, player });
    } catch (error) {
        console.error('Error prestiging:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== MATCHMAKING SYSTEM ====================

// Join matchmaking queue
app.post('/api/matchmaking/join', async (req, res) => {
    try {
        const { userId, playerName, deck } = req.body;
        
        // Get player progression
        const players = db.collection('players');
        const player = await players.findOne({ user_id: userId });
        
        if (!player) {
            return res.json({ success: false, error: 'Player not found' });
        }
        
        // Check queue penalty
        const penalty = await getQueuePenalty(userId);
        if (penalty.penaltyMinutes > 0) {
            return res.json({ 
                success: false, 
                error: `Queue penalty active: ${penalty.penaltyMinutes} minute(s)`,
                penalty: penalty.penaltyMinutes
            });
        }
        
        // Add to matchmaking queue
        const matchmakingQueue = db.collection('matchmaking_queue');
        await matchmakingQueue.deleteMany({ user_id: userId }); // Remove existing queue entry
        
        const queueEntry = {
            user_id: userId,
            name: playerName,
            level: player.level,
            prestige: player.prestige,
            deck: deck,
            bracket: getBracket(player.level, player.prestige),
            queue_time: Date.now(),
            status: 'searching'
        };
        
        await matchmakingQueue.insertOne(queueEntry);
        
        res.json({ success: true, message: 'Joined matchmaking queue' });
    } catch (error) {
        console.error('Error joining matchmaking:', error);
        res.json({ success: false, error: error.message });
    }
});

// Check for match
app.get('/api/matchmaking/check/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const matchmakingQueue = db.collection('matchmaking_queue');
        
        // Get current player's queue entry
        const currentPlayer = await matchmakingQueue.findOne({ user_id: userId });
        
        if (!currentPlayer) {
            return res.json({ success: false, error: 'Not in queue' });
        }
        
        const queueTime = currentPlayer.queue_time;
        const elapsed = Date.now() - queue_time;
        
        // Phase 1: Same bracket (0-30 seconds)
        if (elapsed < 30000) {
            const match = await findMatch(currentPlayer, 'same_bracket');
            if (match) {
                return res.json({ success: true, match, crossBracket: false });
            }
            return res.json({ success: false, phase: 'same_bracket', elapsed });
        }
        
        // Phase 2: Adjacent bracket (30-60 seconds)
        if (elapsed < 60000) {
            const match = await findMatch(currentPlayer, 'adjacent_bracket');
            if (match) {
                return res.json({ success: true, match, crossBracket: false });
            }
            return res.json({ success: false, phase: 'adjacent_bracket', elapsed });
        }
        
        // Phase 3: Any match (60+ seconds)
        const match = await findMatch(currentPlayer, 'any');
        if (match) {
            return res.json({ success: true, match, crossBracket: true });
        }
        
        return res.json({ success: false, phase: 'any', elapsed });
    } catch (error) {
        console.error('Error checking matchmaking:', error);
        res.json({ success: false, error: error.message });
    }
});

// Find match based on phase
async function findMatch(player, phase) {
    const matchmakingQueue = db.collection('matchmaking_queue');
    
    let query = {
        user_id: { $ne: player.user_id },
        status: 'searching'
    };
    
    if (phase === 'same_bracket') {
        query.prestige = player.prestige;
        query.bracket = player.bracket;
    } else if (phase === 'adjacent_bracket') {
        query.prestige = player.prestige;
        // Find players in adjacent brackets
        const adjacentBrackets = [player.bracket - 1, player.bracket + 1];
        query.bracket = { $in: adjacentBrackets };
    }
    // 'any' phase has no restrictions
    
    const match = await matchmakingQueue.findOne(query);
    
    if (match) {
        // Remove both from queue
        await matchmakingQueue.deleteMany({ 
            $or: [
                { user_id: player.user_id },
                { user_id: match.user_id }
            ]
        });
        
        // Create game
        const gameId = `game_${Date.now()}`;
        const game = {
            id: gameId,
            players: [
                { id: player.user_id, name: player.name, deck: player.deck, level: player.level, prestige: player.prestige },
                { id: match.user_id, name: match.name, deck: match.deck, level: match.level, prestige: match.prestige }
            ],
            status: 'ready_check',
            created_at: new Date(),
            phase: 'ready_check'
        };
        
        const matches = db.collection('game_matches');
        await matches.insertOne(game);
        games[gameId] = game;
        
        return game;
    }
    
    return null;
}

// Leave matchmaking queue
app.post('/api/matchmaking/leave', async (req, res) => {
    try {
        const { userId } = req.body;
        const matchmakingQueue = db.collection('matchmaking_queue');
        
        await matchmakingQueue.deleteMany({ user_id: userId });
        
        res.json({ success: true, message: 'Left matchmaking queue' });
    } catch (error) {
        console.error('Error leaving matchmaking:', error);
        res.json({ success: false, error: error.message });
    }
});

// Accept ready check
app.post('/api/match/:gameId/ready', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { userId } = req.body;
        
        const matches = db.collection('game_matches');
        const game = await matches.findOne({ id: gameId });
        
        if (!game) {
            return res.json({ success: false, error: 'Game not found' });
        }
        
        // Mark player as ready
        if (!game.ready_players) {
            game.ready_players = [];
        }
        
        if (!game.ready_players.includes(userId)) {
            game.ready_players.push(userId);
        }
        
        // Check if both players are ready
        if (game.ready_players.length === 2) {
            game.status = 'active';
            game.phase = 'turn_order';
            game.turn_order_rolled = false;
        }
        
        await matches.updateOne(
            { id: gameId },
            { $set: { ready_players: game.ready_players, status: game.status, phase: game.phase } }
        );
        
        // Update in-memory game
        games[gameId] = game;
        
        res.json({ success: true, game });
    } catch (error) {
        console.error('Error accepting ready check:', error);
        res.json({ success: false, error: error.message });
    }
});

// Decline ready check
app.post('/api/match/:gameId/decline', async (req, res) => {
    try {
        const { gameId } = req.params;
        const { userId } = req.body;
        
        // Add queue penalty
        await addQueuePenalty(userId);
        
        // Delete the game
        const matches = db.collection('game_matches');
        await matches.deleteOne({ id: gameId });
        delete games[gameId];
        
        res.json({ success: true, message: 'Ready check declined, queue penalty applied' });
    } catch (error) {
        console.error('Error declining ready check:', error);
        res.json({ success: false, error: error.message });
    }
});

// ==================== QUEUE PENALTY SYSTEM ====================

// Get current queue penalty for a user
async function getQueuePenalty(userId) {
    const penalties = db.collection('queue_penalties');
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    const penalty = await penalties.findOne({ user_id: userId, date: today });
    
    if (!penalty) {
        return { penaltyMinutes: 0, declines: 0 };
    }
    
    return { penaltyMinutes: penalty.penalty_minutes, declines: penalty.declines };
}

// Add queue penalty
async function addQueuePenalty(userId) {
    const penalties = db.collection('queue_penalties');
    const today = new Date().toISOString().split('T')[0];
    
    const existing = await penalties.findOne({ user_id: userId, date: today });
    
    if (existing) {
        // Increment penalty
        await penalties.updateOne(
            { user_id: userId, date: today },
            { 
                $inc: { 
                    declines: 1,
                    penalty_minutes: 1
                }
            }
        );
    } else {
        // Create new penalty record
        await penalties.insertOne({
            user_id: userId,
            date: today,
            declines: 1,
            penalty_minutes: 1
        });
    }
    
    // Clean up penalties older than 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    await penalties.deleteMany({ date: { $lt: sevenDaysAgo.toISOString().split('T')[0] } });
}

// ==================== GAME STATE ENDPOINTS ====================

// Get game state
app.get('/api/game/:gameId', (req, res) => {
    const { gameId } = req.params;
    const game = games[gameId];
    
    if (!game) {
        return res.json({ success: false, error: 'Game not found' });
    }
    
    res.json({ success: true, gameState: game });
});

// ==================== TIMER SYSTEM ====================

// Start quit timer (AI mode)
app.post('/api/game/:gameId/quit-timer', (req, res) => {
    const { gameId } = req.params;
    const { userId, mode } = req.body; // mode: 'ai' or 'multiplayer'
    
    const game = games[gameId];
    if (!game) {
        return res.json({ success: false, error: 'Game not found' });
    }
    
    // Set timer based on mode
    if (mode === 'ai') {
        game.quit_timer = 300; // 5 minutes in seconds
        game.quit_timer_start = Date.now();
    } else if (mode === 'multiplayer') {
        game.quit_timer = 60; // 1 minute in seconds
        game.quit_timer_start = Date.now();
    }
    
    game.quit_timer_user = userId;
    
    res.json({ success: true, gameState: game });
});

// Cancel quit timer (player returned)
app.post('/api/game/:gameId/cancel-timer', (req, res) => {
    const { gameId } = req.params;
    
    const game = games[gameId];
    if (!game) {
        return res.json({ success: false, error: 'Game not found' });
    }
    
    game.quit_timer = null;
    game.quit_timer_start = null;
    game.quit_timer_user = null;
    
    res.json({ success: true, gameState: game });
});

// Check timer status
app.get('/api/game/:gameId/timer', (req, res) => {
    const { gameId } = req.params;
    
    const game = games[gameId];
    if (!game) {
        return res.json({ success: false, error: 'Game not found' });
    }
    
    if (!game.quit_timer) {
        return res.json({ success: true, active: false });
    }
    
    const elapsed = Math.floor((Date.now() - game.quit_timer_start) / 1000);
    const remaining = game.quit_timer - elapsed;
    
    if (remaining <= 0) {
        // Timer expired - player loses
        game.quit_timer_expired = true;
        game.winner = game.players.find(p => p.id !== game.quit_timer_user).id;
        game.status = 'completed';
        
        return res.json({ success: true, active: false, expired: true, winner: game.winner });
    }
    
    res.json({ success: true, active: true, remaining });
});

// ==================== RECONNECTION SYSTEM ====================

// Player disconnected
app.post('/api/game/:gameId/disconnect', (req, res) => {
    const { gameId } = req.params;
    const { userId } = req.body;
    
    const game = games[gameId];
    if (!game) {
        return res.json({ success: false, error: 'Game not found' });
    }
    
    if (!game.disconnections) {
        game.disconnections = {};
    }
    
    game.disconnections[userId] = {
        disconnect_time: Date.now(),
        reconnect_deadline: Date.now() + 60000 // 1 minute to reconnect
    };
    
    res.json({ success: true, reconnectDeadline: game.disconnections[userId].reconnect_deadline });
});

// Player reconnected
app.post('/api/game/:gameId/reconnect', (req, res) => {
    const { gameId } = req.params;
    const { userId } = req.body;
    
    const game = games[gameId];
    if (!game) {
        return res.json({ success: false, error: 'Game not found' });
    }
    
    if (game.disconnections && game.disconnections[userId]) {
        delete game.disconnections[userId];
        res.json({ success: true, message: 'Reconnected successfully' });
    } else {
        res.json({ success: false, error: 'No disconnect record found' });
    }
});

// Check disconnection status
app.get('/api/game/:gameId/disconnect-status/:userId', (req, res) => {
    const { gameId, userId } = req.params;
    
    const game = games[gameId];
    if (!game) {
        return res.json({ success: false, error: 'Game not found' });
    }
    
    if (game.disconnections && game.disconnections[userId]) {
        const deadline = game.disconnections[userId].reconnect_deadline;
        const remaining = Math.max(0, deadline - Date.now());
        
        if (remaining === 0) {
            // Reconnect window expired - player loses
            game.disconnection_forfeit = userId;
            game.winner = game.players.find(p => p.id !== userId).id;
            game.status = 'completed';
            
            return res.json({ success: true, expired: true, winner: game.winner });
        }
        
        return res.json({ success: true, disconnected: true, remaining });
    }
    
    res.json({ success: true, disconnected: false });
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`Game server is running on http://localhost:${PORT}`);
    console.log(`Main menu: http://localhost:${PORT}/index.html`);
    console.log(`Multiplayer: http://localhost:${PORT}/multiplayer.html`);
    console.log(`For network testing: http://YOUR_LOCAL_IP:${PORT}`);
    console.log(`To find your IP: run 'ipconfig' (Windows) or 'ifconfig' (Mac/Linux)`);

    // Connect to MongoDB
    await connectToMongoDB();
});