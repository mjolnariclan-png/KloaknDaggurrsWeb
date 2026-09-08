const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3003;

// Game state management
let games = {};
let waitingPlayers = [];

// WebSocket server for real-time multiplayer
const wss = new WebSocket.Server({ server });

// Handle WebSocket connections
wss.on('connection', (ws) => {
    console.log('New player connected');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleGameMessage(ws, data);
        } catch (error) {
            console.error('Error handling message:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('Player disconnected');
        handlePlayerDisconnect(ws);
    });
});

function handleGameMessage(ws, data) {
    switch(data.type) {
        case 'join_game':
            handleJoinGame(ws, data);
            break;
        case 'play_card':
            handlePlayCard(ws, data);
            break;
        case 'attack':
            handleAttack(ws, data);
            break;
        case 'end_turn':
            handleEndTurn(ws, data);
            break;
        case 'draw_card':
            handleDrawCard(ws, data);
            break;
        default:
            console.log('Unknown message type:', data.type);
    }
}

function handleJoinGame(ws, data) {
    const playerId = data.playerId || `player_${Date.now()}`;
    
    // Check if there's a waiting player
    if (waitingPlayers.length > 0) {
        const opponent = waitingPlayers.pop();
        const gameId = `game_${Date.now()}`;
        
        // Create new game
        games[gameId] = {
            id: gameId,
            players: [
                { id: playerId, ws: ws, name: data.playerName || 'Player 1', life: 30, mana: 0, hand: [], battlefield: [], deck: [], isReady: false },
                { id: opponent.id, ws: opponent.ws, name: opponent.name || 'Player 2', life: 30, mana: 0, hand: [], battlefield: [], deck: [], isReady: false }
            ],
            currentTurn: 0,
            phase: 'lobby'
        };
        
        // Generate decks for both players
        generateDeck(games[gameId].players[0]);
        generateDeck(games[gameId].players[1]);
        
        // Notify both players
        games[gameId].players.forEach((player, index) => {
            player.ws.send(JSON.stringify({
                type: 'game_found',
                gameId: gameId,
                opponentName: games[gameId].players[1 - index].name,
                playerIndex: index
            }));
        });
        
        console.log(`Game created: ${gameId} between ${playerId} and ${opponent.id}`);
    } else {
        // Add to waiting list
        waitingPlayers.push({
            id: playerId,
            ws: ws,
            name: data.playerName || 'Waiting Player'
        });
        
        ws.send(JSON.stringify({
            type: 'waiting',
            message: 'Waiting for opponent...'
        }));
        
        console.log(`Player ${playerId} added to waiting list`);
    }
}

function generateDeck(player) {
    // Generate 60-card deck with proper ratios
    const deck = [];
    
    // 1 Primordial
    deck.push({ type: 'primordial', name: 'Primordial King', cost: 0, attack: 10, defense: 10, isPrimordial: true });
    
    // 20 Vigor
    for (let i = 0; i < 20; i++) {
        deck.push({ type: 'vigor', name: 'Vigor', cost: 0, attack: 0, defense: 0 });
    }
    
    // 24 Creatures
    for (let i = 0; i < 24; i++) {
        deck.push({ type: 'creature', name: `Creature ${i+1}`, cost: Math.floor(Math.random() * 5) + 1, attack: Math.floor(Math.random() * 8) + 1, defense: Math.floor(Math.random() * 8) + 1 });
    }
    
    // 8 Runes
    for (let i = 0; i < 8; i++) {
        deck.push({ type: 'rune', name: `Rune ${i+1}`, cost: Math.floor(Math.random() * 4) + 1, attack: 0, defense: 0 });
    }
    
    // 7 Equipment
    for (let i = 0; i < 7; i++) {
        deck.push({ type: 'equipment', name: `Equipment ${i+1}`, cost: Math.floor(Math.random() * 3) + 1, attack: Math.floor(Math.random() * 3), defense: Math.floor(Math.random() * 3) });
    }
    
    // Shuffle deck
    deck.sort(() => Math.random() - 0.5);
    player.deck = deck;
    
    // Draw initial hand (7 cards)
    for (let i = 0; i < 7; i++) {
        const card = player.deck.pop();
        if (card.type === 'primordial') {
            player.battlefield.push(card);
        } else {
            player.hand.push(card);
        }
    }
    
    // Initial vigor reset
    player.mana = player.battlefield.filter(c => c.type === 'vigor').length;
}

function handlePlayCard(ws, data) {
    const game = findGameByPlayer(ws);
    if (!game) return;
    
    const player = game.players.find(p => p.ws === ws);
    if (!player) return;
    
    const cardIndex = data.cardIndex;
    const card = player.hand[cardIndex];
    
    if (card && card.cost <= player.mana) {
        player.mana -= card.cost;
        player.hand.splice(cardIndex, 1);
        
        if (card.type === 'vigor') {
            player.battlefield.push(card);
            player.mana = player.battlefield.filter(c => c.type === 'vigor').length;
        } else if (card.type === 'creature' || card.type === 'equipment') {
            player.battlefield.push(card);
        } else if (card.type === 'rune') {
            // Handle spell effect
            const opponent = game.players.find(p => p !== player);
            opponent.life -= Math.floor(Math.random() * 5) + 3;
        }
        
        broadcastGameState(game);
    }
}

function handleAttack(ws, data) {
    const game = findGameByPlayer(ws);
    if (!game) return;
    
    const player = game.players.find(p => p.ws === ws);
    const opponent = game.players.find(p => p !== player);
    
    if (!player || !opponent) return;
    
    const attacker = player.battlefield[data.attackerIndex];
    const target = opponent.battlefield[data.targetIndex];
    
    if (attacker && target) {
        target.defense -= attacker.attack;
        if (target.defense <= 0) {
            opponent.battlefield.splice(data.targetIndex, 1);
        }
        
        broadcastGameState(game);
    }
}

function handleEndTurn(ws, data) {
    const game = findGameByPlayer(ws);
    if (!game) return;
    
    game.currentTurn = (game.currentTurn + 1) % 2;
    const currentPlayer = game.players[game.currentTurn];
    
    // Start new turn
    currentPlayer.mana = currentPlayer.battlefield.filter(c => c.type === 'vigor').length;
    
    // Draw card
    if (currentPlayer.deck.length > 0) {
        const card = currentPlayer.deck.pop();
        if (card.type === 'primordial') {
            currentPlayer.battlefield.push(card);
        } else {
            currentPlayer.hand.push(card);
        }
    }
    
    // Auto-play vigor
    const vigorCards = currentPlayer.hand.filter(c => c.type === 'vigor');
    vigorCards.forEach(card => {
        const index = currentPlayer.hand.indexOf(card);
        currentPlayer.hand.splice(index, 1);
        currentPlayer.battlefield.push(card);
    });
    currentPlayer.mana = currentPlayer.battlefield.filter(c => c.type === 'vigor').length;
    
    broadcastGameState(game);
}

function handleDrawCard(ws, data) {
    const game = findGameByPlayer(ws);
    if (!game) return;
    
    const player = game.players.find(p => p.ws === ws);
    if (!player) return;
    
    if (player.deck.length > 0 && player.hand.length < 10) {
        const card = player.deck.pop();
        if (card.type === 'primordial') {
            player.battlefield.push(card);
        } else {
            player.hand.push(card);
        }
    }
    
    broadcastGameState(game);
}

function broadcastGameState(game) {
    const gameState = {
        type: 'game_state',
        gameId: game.id,
        currentTurn: game.currentTurn,
        players: game.players.map(p => ({
            id: p.id,
            name: p.name,
            life: p.life,
            mana: p.mana,
            hand: p.hand,
            battlefield: p.battlefield,
            deckSize: p.deck.length
        }))
    };
    
    game.players.forEach(player => {
        if (player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify(gameState));
        }
    });
}

function findGameByPlayer(ws) {
    for (const gameId in games) {
        const game = games[gameId];
        const player = game.players.find(p => p.ws === ws);
        if (player) return game;
    }
    return null;
}

function handlePlayerDisconnect(ws) {
    // Remove from waiting list
    waitingPlayers = waitingPlayers.filter(p => p.ws !== ws);
    
    // Handle disconnection from active game
    for (const gameId in games) {
        const game = games[gameId];
        const playerIndex = game.players.findIndex(p => p.ws === ws);
        
        if (playerIndex !== -1) {
            // Notify opponent
            const opponent = game.players[1 - playerIndex];
            if (opponent && opponent.ws.readyState === WebSocket.OPEN) {
                opponent.ws.send(JSON.stringify({
                    type: 'opponent_disconnected',
                    message: 'Opponent has disconnected'
                }));
            }
            
            // Clean up game
            delete games[gameId];
            console.log(`Game ${gameId} ended due to disconnection`);
            break;
        }
    }
}

// Regular HTTP routes
app.get('/api/player-hand', (req, res) => {
    res.json([]); // Return empty for now
});

app.get('/api/battlefield', (req, res) => {
    res.json([]); // Return empty for now
});

// Serve static files
app.use(express.static(__dirname));

// Serve card images
app.use('/cards', express.static(path.join(__dirname, '..', 'All Cards', 'Fehu White Deck')));

// Start server
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`WebSocket server ready for multiplayer`);
});