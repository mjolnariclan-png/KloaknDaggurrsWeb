// Initialize Supabase immediately
window.supabase = window.supabase.createClient(
    window.KD_CONFIG.supabaseUrl,
    window.KD_CONFIG.supabasePublishableKey,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

// Use current server for API calls
const API_BASE = `${window.location.protocol}//${window.location.hostname}${window.location.port ? ':' + window.location.port : ''}/api`;
let playerId = null;
let gameId = null;
let playerIndex = 0;
let gameState = null;
let isHandExpanded = false;
let selectedCreature = null;
let pollInterval = null;
let lobbyPollInterval = null;
let isInLobby = false;
let phaseTimerInterval = null;
let phaseTimeRemaining = 60;

// DOM Elements
const lobby = document.getElementById('lobby');
const gameContainer = document.getElementById('game-container');
const playerNameInput = document.getElementById('player-name');
const joinLobbyBtn = document.getElementById('join-lobby-btn');
const lobbyStatus = document.getElementById('lobby-status');
const lobbyPlayers = document.getElementById('lobby-players');
const playersList = document.getElementById('players-list');

const myName = document.getElementById('my-name');
const opponentName = document.getElementById('opponent-name');
const myScallous = document.getElementById('my-scallous');
const myVigor = document.getElementById('my-vigor');
const opponentScallous = document.getElementById('opponent-scallous');
const opponentVigor = document.getElementById('opponent-vigor');
const turnIndicator = document.getElementById('turn-indicator');
const turnNumber = document.getElementById('turn-number');
const currentPhase = document.getElementById('current-phase');
const phaseIndicator = document.getElementById('phase-indicator');

const playerBattlefield = document.getElementById('player-battlefield');
const opponentBattlefield = document.getElementById('opponent-battlefield');
const handOverlay = document.getElementById('hand-overlay');
const handOverlayCards = document.getElementById('hand-overlay-cards');
const handToggleBtn = document.getElementById('hand-toggle-btn');
const handToggleOverlay = document.getElementById('hand-toggle-overlay');
const clickOutsideDetector = document.getElementById('click-outside-detector');

const drawCardBtnSide = document.getElementById('draw-card-btn-side');
const autoPlayVigorBtnSide = document.getElementById('auto-play-vigor-btn-side');
const endPhaseBtnSide = document.getElementById('end-phase-btn-side');
const menuToggleBtn = document.getElementById('menu-toggle-btn');
const sideMenu = document.getElementById('side-menu');
const quitBtnSide = document.getElementById('quit-btn-side');
const menuBtnSide = document.getElementById('menu-btn-side');
const leftButtons = document.getElementById('left-buttons');
const rightButtons = document.getElementById('right-buttons');
const leaveGameX = document.getElementById('leave-game-x');

// Join lobby
joinLobbyBtn.addEventListener('click', async () => {
    try {
        const authSession = await window.GameAuth.getSession();
        if (!authSession || !authSession.user) {
            lobbyStatus.textContent = 'Please log in first';
            lobbyStatus.style.color = 'red';
            return;
        }
        
        playerId = authSession.user.id;
        const defaultName = authSession.user.user_metadata?.display_name || authSession.user.email?.split('@')[0] || 'Player';
        const playerName = playerNameInput.value || defaultName;
        lobbyStatus.textContent = 'Joining lobby...';
        
        const response = await fetch(`${API_BASE}/join-lobby`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerId, playerName })
        });
        
        const data = await response.json();
        
        if (data.success) {
            isInLobby = true;
            joinLobbyBtn.style.display = 'none';
            playerNameInput.disabled = true;
            lobbyPlayers.style.display = 'block';
            lobbyStatus.textContent = 'Waiting in lobby...';
            startLobbyPolling();
        }
    } catch (error) {
        console.error('Error joining lobby:', error);
        lobbyStatus.textContent = 'Error connecting to server';
    }
});

// Start lobby polling to see available players
function startLobbyPolling() {
    lobbyPollInterval = setInterval(async () => {
        try {
            const response = await fetch(`${API_BASE}/lobby-players?playerId=${playerId}`);
            const data = await response.json();
            
            if (data.success) {
                updateLobbyPlayers(data.players);
                checkForGameInvitation(data);
            }
        } catch (error) {
            console.error('Error polling lobby:', error);
        }
    }, 2000);
}

// Update lobby players list
function updateLobbyPlayers(players) {
    playersList.innerHTML = '';
    
    const otherPlayers = players.filter(p => p.id !== playerId);
    
    if (otherPlayers.length === 0) {
        playersList.innerHTML = '<div class="no-players">No other players in lobby</div>';
        return;
    }
    
    otherPlayers.forEach(player => {
        const playerItem = document.createElement('div');
        playerItem.className = 'lobby-player-item';
        playerItem.innerHTML = `
            <span class="lobby-player-name">${player.name}</span>
            <button class="lobby-player-challenge" data-player-id="${player.id}">Challenge</button>
        `;
        
        playerItem.querySelector('.lobby-player-challenge').addEventListener('click', () => {
            challengePlayer(player.id);
        });
        
        playersList.appendChild(playerItem);
    });
}

// Check for game invitation in lobby polling response
function checkForGameInvitation(data) {
    if (data.gameInvitation && data.gameInvitation.gameId) {
        // Player has been invited to a game
        const invitation = data.gameInvitation;
        
        // Stop lobby polling
        if (lobbyPollInterval) clearInterval(lobbyPollInterval);
        
        // Show acceptance dialog
        showNotification(`${invitation.opponentName} has challenged you!`, true);
        
        // Create accept/decline buttons
        const notificationEl = document.getElementById('game-notification');
        notificationEl.innerHTML = `
            <div>${invitation.opponentName} has challenged you!</div>
            <div style="margin-top: 10px; display: flex; gap: 10px; justify-content: center;">
                <button id="accept-challenge" style="padding: 8px 16px; background: #4ecdc4; border: none; border-radius: 5px; cursor: pointer;">Accept</button>
                <button id="decline-challenge" style="padding: 8px 16px; background: #e74c3c; border: none; border-radius: 5px; cursor: pointer;">Decline</button>
            </div>
        `;
        notificationEl.classList.add('show');
        
        // Add event listeners
        document.getElementById('accept-challenge').addEventListener('click', () => {
            gameId = invitation.gameId;
            playerIndex = invitation.playerIndex;
            gameState = invitation.gameState;
            isInLobby = false;
            notificationEl.classList.remove('show');
            startGame();
        });
        
        document.getElementById('decline-challenge').addEventListener('click', () => {
            fetch(`${API_BASE}/decline-game`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gameId, playerId })
            });
            notificationEl.classList.remove('show');
            startLobbyPolling();
        });
    }
}

// Show in-game notification
function showNotification(message, withButtons = false) {
    const notificationEl = document.getElementById('game-notification');
    notificationEl.textContent = message;
    notificationEl.classList.add('show');
    
    setTimeout(() => {
        notificationEl.classList.remove('show');
    }, 3000);
}

// Challenge a player
async function challengePlayer(opponentId) {
    try {
        const cardSet = sessionStorage.getItem('cardSet') || 'Ash Cycle';
        const vigorType = sessionStorage.getItem('vigorType') || null;

        const response = await fetch(`${API_BASE}/challenge-player`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerId, opponentId, cardSet, vigorType })
        });
        
        const data = await response.json();
        
        if (data.success) {
            gameId = data.gameId;
            playerIndex = data.playerIndex;
            gameState = data.gameState;
            isInLobby = false;
            if (lobbyPollInterval) clearInterval(lobbyPollInterval);
            startGame();
        } else {
            alert(data.error || 'Could not challenge player');
        }
    } catch (error) {
        console.error('Error challenging player:', error);
        alert('Error challenging player');
    }
}

// Start game
function startGame() {
    lobby.style.display = 'none';
    gameContainer.style.display = 'flex';
    
    console.log('Starting game with player index:', playerIndex);
    console.log('Game state:', gameState);
    
    if (gameState && gameState.players) {
        myName.textContent = gameState.players[playerIndex].name || 'Player';
        opponentName.textContent = gameState.players[1 - playerIndex].name || 'Opponent';
        console.log('My name:', myName.textContent);
        console.log('Opponent name:', opponentName.textContent);
        
        // Show D20 roll result
        if (gameState.d20Roll !== undefined) {
            const challengerRoll = gameState.d20Roll.challenger;
            const opponentRoll = gameState.d20Roll.opponent;
            const goesFirst = gameState.currentTurn === playerIndex;
            console.log(`D20 Roll: You ${challengerRoll}, Opponent ${opponentRoll}, ${goesFirst ? 'You go first!' : 'Opponent goes first!'}`);
            
            // Show in-game notification
            setTimeout(() => {
                showNotification(`D20 Roll: You ${challengerRoll}, Opponent ${opponentRoll} - ${goesFirst ? 'You go first!' : 'Opponent goes first!'}`);
            }, 500);
        }
    }
    
    render();
    startPolling();
}

// Start polling for game state updates
function startPolling() {
    pollInterval = setInterval(async () => {
        if (gameId) {
            try {
                const response = await fetch(`${API_BASE}/game-state/${gameId}`);
                const data = await response.json();
                
                if (data.success && data.gameState) {
                    gameState = data.gameState;
                    render();
                }
            } catch (error) {
                console.error('Error polling game state:', error);
            }
        }
    }, 1000);
}

// Render game state
function render() {
    if (!gameState) return;
    
    const myPlayer = gameState.players[playerIndex];
    const opponentPlayer = gameState.players[1 - playerIndex];
    
    console.log('Rendering for player index:', playerIndex);
    console.log('My player:', myPlayer);
    console.log('Opponent player:', opponentPlayer);
    
    // Update info
    myName.textContent = myPlayer.name || 'Player';
    myScallous.textContent = `Scallous: ${myPlayer.life}`;
    const totalVigor = myPlayer.battlefield.filter(c => c.type === 'vigor').length;
    const usedVigor = myPlayer.vigorUsedThisTurn || 0;
    const availableVigor = totalVigor - usedVigor;
    myVigor.textContent = `Vigor: ${availableVigor}/${totalVigor}`;

    opponentName.textContent = opponentPlayer.name || 'Opponent';
    opponentScallous.textContent = `Scallous: ${opponentPlayer.life}`;
    const opponentTotalVigor = opponentPlayer.battlefield.filter(c => c.type === 'vigor').length;
    const opponentUsedVigor = opponentPlayer.vigorUsedThisTurn || 0;
    const opponentAvailableVigor = opponentTotalVigor - opponentUsedVigor;
    opponentVigor.textContent = `Vigor: ${opponentAvailableVigor}/${opponentTotalVigor}`;

    turnIndicator.textContent = gameState.currentTurn === playerIndex ? 'Your Turn' : "Opponent's Turn";
    turnNumber.textContent = `Turn: ${Math.floor(gameState.currentTurn / 2) + 1}`;
    
    // Update button states (only show on player's turn)
    const isMyTurn = gameState.currentTurn === playerIndex;
    drawCardBtnSide.disabled = !isMyTurn || gameState.phase !== 'draw';
    autoPlayVigorBtnSide.disabled = !isMyTurn || gameState.phase !== 'vigor';
    endPhaseBtnSide.disabled = !isMyTurn;
    
    leftButtons.style.display = isMyTurn ? 'flex' : 'none';
    rightButtons.style.display = isMyTurn ? 'flex' : 'none';
    
    // Update phase indicator
    if (gameState.phase) {
        currentPhase.textContent = gameState.phase.charAt(0).toUpperCase() + gameState.phase.slice(1) + ' Phase';
    }
    
    // Start/stop phase timer (timer runs but is hidden)
    if (isMyTurn) {
        startPhaseTimer();
    } else {
        stopPhaseTimer();
    }
    
    // Render cards (hide vigor on battlefield, only show in info)
    renderCards(myPlayer.hand, handOverlayCards, true, false);
    renderCards(myPlayer.battlefield.filter(c => c.type !== 'vigor'), playerBattlefield, false, false);
    // Opponent cards on battlefield are face-up (NOT face-down)
    renderCards(opponentPlayer.battlefield.filter(c => c.type !== 'vigor'), opponentBattlefield, false, false);
    
    // Make opponent cards clickable during attack phase
    if (gameState.currentTurn === playerIndex && gameState.phase === 'attack') {
        opponentBattlefield.querySelectorAll('.card').forEach((card, index) => {
            card.classList.add('attackable');
            card.addEventListener('click', (e) => {
                e.stopPropagation();
                const opponent = gameState.players[1 - playerIndex];
                const opponentBattlefield = opponent.battlefield.filter(c => c.type !== 'vigor');
                const cardData = opponentBattlefield[index];
                const fullTargetIndex = opponent.battlefield.indexOf(cardData);
                handleAttackTarget(fullTargetIndex, false);
            });
        });
    }
    
    // Add attack player button if no primordial and no creatures
    const opponentPrimordial = opponentPlayer.battlefield.find(c => c.type === 'primordial');
    const opponentCreatures = opponentPlayer.battlefield.filter(c => c.type === 'creature');
    
    // Remove existing button
    const existingBtn = document.getElementById('attack-player-btn');
    if (existingBtn) existingBtn.remove();
    
    if (!opponentPrimordial && opponentCreatures.length === 0 && gameState.currentTurn === playerIndex && gameState.phase === 'attack') {
        addAttackPlayerButton();
    }
}

function addAttackPlayerButton() {
    const btn = document.createElement('button');
    btn.id = 'attack-player-btn';
    btn.className = 'attack-player-btn';
    btn.textContent = 'Attack Player';
    btn.addEventListener('click', () => {
        selectAttackerForPlayerAttack();
    });
    
    opponentBattlefield.appendChild(btn);
}

let selectedAttacker = null;

function selectAttackerForPlayerAttack() {
    // Clear previous selections
    selectedAttacker = null;
    document.querySelectorAll('.card').forEach(c => {
        c.classList.remove('selected');
        c.classList.remove('selectable');
    });
    
    // Check if player has attackable creatures
    const myBattlefield = gameState.players[playerIndex].battlefield.filter(c => c.type !== 'vigor');
    const myCreatures = myBattlefield.filter(c => 
        (c.type === 'creature' || c.type === 'primordial') && 
        (c.canAttack || c.hasHaste)
    );
    
    if (myCreatures.length === 0) {
        alert('No creatures available to attack');
        return;
    }
    
    // Mark player's attackable creatures as selectable
    document.querySelectorAll('#player-battlefield .card').forEach((card, index) => {
        const cardData = myBattlefield[index];
        if (cardData && (cardData.type === 'creature' || cardData.type === 'primordial') && (cardData.canAttack || cardData.hasHaste)) {
            card.classList.add('selectable');
            card.addEventListener('click', () => {
                selectedAttacker = index;
                document.querySelectorAll('.card').forEach(c => {
                    c.classList.remove('selected');
                    c.classList.remove('selectable');
                });
                card.classList.add('selected');
                // Get the actual index in the full battlefield array
                const fullIndex = gameState.players[playerIndex].battlefield.indexOf(cardData);
                attackTarget(fullIndex, null, true);
            });
        }
    });
}

function handleAttackTarget(fullTargetIndex, isPlayer = false) {
    // Clear previous selections
    selectedAttacker = null;
    document.querySelectorAll('.card').forEach(c => {
        c.classList.remove('selected');
        c.classList.remove('selectable');
    });
    
    // Check if player has attackable creatures
    const myBattlefield = gameState.players[playerIndex].battlefield.filter(c => c.type !== 'vigor');
    const myCreatures = myBattlefield.filter(c => 
        (c.type === 'creature' || c.type === 'primordial') && 
        (c.canAttack || c.hasHaste)
    );
    
    if (myCreatures.length === 0) {
        alert('No creatures available to attack');
        return;
    }
    
    // Mark player's attackable creatures as selectable
    document.querySelectorAll('#player-battlefield .card').forEach((card, index) => {
        const cardData = myBattlefield[index];
        if (cardData && (cardData.type === 'creature' || cardData.type === 'primordial') && (cardData.canAttack || cardData.hasHaste)) {
            card.classList.add('selectable');
            card.addEventListener('click', () => {
                selectedAttacker = index;
                document.querySelectorAll('.card').forEach(c => {
                    c.classList.remove('selected');
                    c.classList.remove('selectable');
                });
                card.classList.add('selected');
                // Get the actual index in the full battlefield array
                const fullIndex = gameState.players[playerIndex].battlefield.indexOf(cardData);
                attackTarget(fullIndex, fullTargetIndex, isPlayer);
            });
        }
    });
}

async function attackTarget(attackerIndex, targetIndex, targetPlayer) {
    console.log('Attack attempt:', { attackerIndex, targetIndex, targetPlayer });
    try {
        const response = await fetch(`${API_BASE}/attack`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId, playerId, attackerIndex, targetIndex, targetPlayer })
        });
        
        const data = await response.json();
        console.log('Attack response:', data);
        if (data.success) {
            gameState = data.gameState;
            render();
        } else {
            alert(data.error || 'Could not attack');
        }
    } catch (error) {
        console.error('Error attacking:', error);
        alert('Error attacking');
    }
}

function startPhaseTimer() {
    stopPhaseTimer();
    phaseTimeRemaining = 60;
    // Timer runs but is hidden (no DOM updates)
    
    phaseTimerInterval = setInterval(() => {
        phaseTimeRemaining--;
        
        if (phaseTimeRemaining <= 0) {
            stopPhaseTimer();
            // Auto-advance phase when timer runs out
            endPhaseBtnSide.click();
        }
    }, 1000);
}

function stopPhaseTimer() {
    if (phaseTimerInterval) {
        clearInterval(phaseTimerInterval);
        phaseTimerInterval = null;
    }
}

function renderCards(cards, container, isDraggable = false, isFaceDown = false, isOpponent = false) {
    container.innerHTML = '';
    cards.forEach((card, index) => {
        // Opponent battlefield cards are face-up, opponent hand cards are face-down
        // We only render battlefield here, so always face-up
        const showFaceDown = false;
        const cardEl = createCardElement(card, showFaceDown, isDraggable, index, isOpponent);
        container.appendChild(cardEl);
    });
}

function createCardElement(card, isFaceDown, isDraggable, index, isOpponent = false) {
    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    cardEl.dataset.index = index;
    
    if (card.type) {
        cardEl.classList.add(`card-${card.type}`);
    }
    
    // Check if creature/primordial can attack
    if ((card.type === 'creature' || card.type === 'primordial') && !isOpponent) {
        if (!card.canAttack && !card.hasHaste) {
            cardEl.classList.add('cannot-attack');
        }
    }
    
    if (isFaceDown) {
        cardEl.classList.add('face-down');
    } else {
        if (isDraggable) {
            cardEl.addEventListener('click', () => handleCardClick(index));
        }
        
        // If opponent card and in attack phase, make it attackable
        if (isOpponent && gameState && gameState.phase === 'attack' && gameState.currentTurn === playerIndex) {
            cardEl.classList.add('attackable');
            cardEl.addEventListener('click', (e) => {
                e.stopPropagation();
                // Get the actual index in the full battlefield array
                const opponent = gameState.players[1 - playerIndex];
                const opponentBattlefield = opponent.battlefield.filter(c => c.type !== 'vigor');
                const cardData = opponentBattlefield[index];
                const fullTargetIndex = opponent.battlefield.indexOf(cardData);
                handleAttackTarget(fullTargetIndex, false);
            });
        }
        
        let cardContent = '';

        if (card.type === 'vigor') {
            cardContent = `
                <div class="card-cost">0</div>
                <div class="card-name">${card.name}</div>
                <div class="card-image vigor-icon">
                    <span style="font-size: 3em;">💎</span>
                </div>
                <div class="card-description">+1 Vigor per round</div>
            `;
        } else if (card.type === 'primordial') {
            cardContent = `
                <div class="card-cost">${card.cost}</div>
                <div class="card-name primordial-name">${card.name}</div>
                <div class="card-image">
                    <span style="font-size: 3em;">👑</span>
                </div>
                <div class="card-stats">
                    <span class="card-attack">⚔${card.attack}${card.equipment ? `+${card.equipment.attack}` : ''}</span>
                    <span class="card-defense">🛡${card.defense}${card.equipment ? `+${card.equipment.defense}` : ''}</span>
                </div>
                <div class="card-primordial-indicator">👑 KING</div>
                ${card.equipment ? `<div class="equipment-indicator">⚔️ ${card.equipment.name}</div>` : ''}
            `;
        } else if (card.type === 'rune') {
            cardContent = `
                <div class="card-cost">${card.cost}</div>
                <div class="card-name">${card.name}</div>
                <div class="card-image rune-icon">
                    <span style="font-size: 3em;">✨</span>
                </div>
                <div class="card-description">One-time use</div>
            `;
        } else if (card.type === 'equipment') {
            cardContent = `
                <div class="card-cost">${card.cost}</div>
                <div class="card-name">${card.name}</div>
                <div class="card-image equipment-icon">
                    <span style="font-size: 3em;">⚔️</span>
                </div>
                <div class="card-stats">
                    <span class="card-attack">+${card.attack}</span>
                    <span class="card-defense">+${card.defense}</span>
                </div>
                <div class="card-description">Attach to creature</div>
            `;
        } else {
            cardContent = `
                <div class="card-cost">${card.cost}</div>
                <div class="card-name">${card.name}</div>
                <div class="card-image">
                    <span style="font-size: 3em;">⚔️</span>
                </div>
                <div class="card-stats">
                    <span class="card-attack">⚔${card.attack}${card.equipment ? `+${card.equipment.attack}` : ''}</span>
                    <span class="card-defense">🛡${card.defense}${card.equipment ? `+${card.equipment.defense}` : ''}</span>
                </div>
                ${card.equipment ? `<div class="equipment-indicator">⚔️ ${card.equipment.name}</div>` : ''}
            `;
        }
        
        cardEl.innerHTML = cardContent;
    }
    
    return cardEl;
}

// Handle card click - show play options
async function handleCardClick(index) {
    if (gameState.currentTurn !== playerIndex) return;
    
    const card = gameState.players[playerIndex].hand[index];
    
    if (card.type === 'rune') {
        // Runes don't need placement - play immediately
        await playCard(index);
    } else if (card.type === 'vigor') {
        // Vigor cards are auto-played
        await playCard(index);
    } else if (card.type === 'equipment') {
        // Equipment needs to be attached to a creature
        showEquipmentAttachmentOptions(index, card);
    } else {
        // Creature or primordial - ask where to play
        showPlayOptions(index, card);
    }
}

function showEquipmentAttachmentOptions(equipmentIndex, equipment) {
    const myBattlefield = gameState.players[playerIndex].battlefield.filter(c => c.type !== 'vigor');
    const creatures = myBattlefield.filter(c => c.type === 'creature' || c.type === 'primordial');
    
    if (creatures.length === 0) {
        alert('No creatures to attach equipment to');
        return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'play-options-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Attach ${equipment.name}</h3>
            <p>Select a creature to attach this equipment to:</p>
            <div class="creature-selection"></div>
            <button id="cancel-attach">Cancel</button>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const container = modal.querySelector('.creature-selection');
    creatures.forEach((creature, index) => {
        const btn = document.createElement('button');
        btn.className = 'creature-select-btn';
        btn.textContent = `${creature.name} (⚔${creature.attack} 🛡${creature.defense})`;
        btn.addEventListener('click', async () => {
            // Get the actual index in the full battlefield array at the time of click
            const currentBattlefield = gameState.players[playerIndex].battlefield;
            const fullCreatureIndex = currentBattlefield.findIndex(c => 
                c.name === creature.name && 
                c.attack === creature.attack && 
                c.defense === creature.defense &&
                c.type === creature.type
            );
            
            if (fullCreatureIndex === -1) {
                alert('Creature not found on battlefield');
                modal.remove();
                return;
            }
            
            await attachEquipment(equipmentIndex, fullCreatureIndex);
            modal.remove();
        });
        container.appendChild(btn);
    });
    
    modal.querySelector('#cancel-attach').addEventListener('click', () => {
        modal.remove();
    });
}

async function attachEquipment(equipmentIndex, targetCreatureIndex) {
    try {
        const response = await fetch(`${API_BASE}/attach-equipment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId, playerId, equipmentIndex, targetCreatureIndex })
        });
        
        const data = await response.json();
        if (data.success) {
            gameState = data.gameState;
            render();
        } else {
            alert(data.error || 'Could not attach equipment');
        }
    } catch (error) {
        console.error('Error attaching equipment:', error);
        alert('Error attaching equipment');
    }
}

function showDrawNotification(card) {
    if (!card) return;
    
    const notification = document.createElement('div');
    notification.className = 'draw-notification';
    notification.innerHTML = `
        <div class="notification-content">
            <h3>Drew a card!</h3>
            <div class="drawn-card-preview">
                <div class="card-cost">${card.cost}</div>
                <div class="card-name">${card.name}</div>
                <div class="card-type">${card.type.toUpperCase()}</div>
                ${card.attack !== undefined ? `<div class="card-stats-preview">⚔${card.attack} 🛡${card.defense}</div>` : ''}
            </div>
            <button id="close-notification">Close</button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.querySelector('#close-notification').addEventListener('click', () => {
            notification.remove();
        });
    }, 100);
    
    // Auto-close after 3 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 3000);
}

function showPlayOptions(cardIndex, card) {
    const modal = document.createElement('div');
    modal.className = 'play-options-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <h3>Play ${card.name}</h3>
            <p>Where do you want to play this card?</p>
            <button id="play-to-battlefield">Play to Battlefield</button>
            <button id="cancel-play">Cancel</button>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    modal.querySelector('#play-to-battlefield').addEventListener('click', async () => {
        modal.remove();
        await playCard(cardIndex);
    });
    
    modal.querySelector('#cancel-play').addEventListener('click', () => {
        modal.remove();
    });
}

// Play card
async function playCard(cardIndex) {
    try {
        const response = await fetch(`${API_BASE}/play-card`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId, playerId, cardIndex })
        });
        
        const data = await response.json();
        if (data.success) {
            gameState = data.gameState;
            render();
        } else {
            alert(data.error || 'Could not play card');
        }
    } catch (error) {
        console.error('Error playing card:', error);
        alert('Error playing card');
    }
}

// Phase indicator click to advance phase
phaseIndicator.addEventListener('click', async () => {
    if (gameState.currentTurn === playerIndex) {
        try {
            const response = await fetch(`${API_BASE}/advance-phase`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gameId, playerId })
            });
            
            const data = await response.json();
            if (data.success) {
                gameState = data.gameState;
                render();
            }
        } catch (error) {
            console.error('Error advancing phase:', error);
        }
    }
});

// Auto-play vigor
autoPlayVigorBtnSide.addEventListener('click', async () => {
    try {
        const response = await fetch(`${API_BASE}/auto-play-vigor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId, playerId })
        });

        const data = await response.json();
        if (data.success) {
            gameState = data.gameState;
            render();
        }
    } catch (error) {
        console.error('Error auto-playing vigor:', error);
    }
});

// End phase
endPhaseBtnSide.addEventListener('click', async () => {
    try {
        const response = await fetch(`${API_BASE}/advance-phase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId, playerId })
        });
        
        const data = await response.json();
        if (data.success) {
            gameState = data.gameState;
            render();
        }
    } catch (error) {
        console.error('Error advancing phase:', error);
    }
});

// Draw card
drawCardBtnSide.addEventListener('click', async () => {
    try {
        const response = await fetch(`${API_BASE}/draw-card`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId, playerId })
        });
        
        const data = await response.json();
        if (data.success) {
            // Show notification of drawn card
            if (data.drawnCard) {
                showDrawNotification(data.drawnCard);
            }
            gameState = data.gameState;
            render();
        }
    } catch (error) {
        console.error('Error drawing card:', error);
    }
});

// Menu toggle
menuToggleBtn.addEventListener('click', () => {
    sideMenu.classList.toggle('open');
});

// Side menu buttons
quitBtnSide.addEventListener('click', () => {
    window.location.href = 'https://www.kloakndaggurrs.com';
});

menuBtnSide.addEventListener('click', () => {
    if (pollInterval) clearInterval(pollInterval);
    gameId = null;
    gameState = null;
    gameContainer.style.display = 'none';
    lobby.style.display = 'flex';
    lobbyStatus.textContent = '';
    sideMenu.classList.remove('open');
});

// Hand expansion
handToggleBtn.addEventListener('click', toggleHandExpansion);
handToggleOverlay.addEventListener('click', toggleHandExpansion);
clickOutsideDetector.addEventListener('click', toggleHandExpansion);

function toggleHandExpansion() {
    isHandExpanded = !isHandExpanded;
    
    if (isHandExpanded) {
        handOverlay.classList.add('active');
        handToggleBtn.textContent = '−';
        clickOutsideDetector.classList.add('active');
    } else {
        handOverlay.classList.remove('active');
        handToggleBtn.textContent = '+';
        clickOutsideDetector.classList.remove('active');
    }
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'd' || e.key === 'D') {
        drawCardBtnSide.click();
    } else if (e.key === ' ') {
        e.preventDefault();
        endPhaseBtnSide.click();
    } else if (e.key === 'Escape') {
        if (isHandExpanded) {
            toggleHandExpansion();
        } else {
            leaveGameX.click();
        }
    }
});