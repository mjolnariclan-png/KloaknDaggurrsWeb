/**
 * Unified battlefield client — AI/local and multiplayer share one DOM.
 * ?mode=multiplayer → lobby + server APIs; otherwise local AI match.
 */
(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const MODE = (params.get('mode') || 'ai').toLowerCase();
  const isMultiplayer = MODE === 'multiplayer';

  const API_BASE = `${window.location.protocol}//${window.location.hostname}${window.location.port ? ':' + window.location.port : ''}/api`;

  function $(id) { return document.getElementById(id); }

  function initSupabase() {
    if (window.supabase && window.KD_CONFIG && typeof window.supabase.createClient === 'function') {
      window.supabase = window.supabase.createClient(
        window.KD_CONFIG.supabaseUrl,
        window.KD_CONFIG.supabasePublishableKey,
        { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
      );
    }
  }

  function showBoard() {
    const lobby = $('lobby');
    const board = $('game-container');
    if (lobby) lobby.style.display = 'none';
    if (board) board.style.display = 'flex';
  }

  function showLobby() {
    const lobby = $('lobby');
    const board = $('game-container');
    if (board) board.style.display = 'none';
    if (lobby) lobby.style.display = 'flex';
  }

  function setPlayerLabels(name, scallous, vigor) {
    const pairs = [
      ['my-name', name], ['my-name-bottom', name],
      ['my-scallous', scallous], ['my-scallous-bottom', scallous],
      ['my-vigor', vigor], ['my-vigor-bottom', vigor],
    ];
    pairs.forEach(([id, text]) => { const el = $(id); if (el) el.textContent = text; });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initSupabase();
    if (isMultiplayer) {
      showLobby();
      initMultiplayer();
    } else {
      showBoard();
      initAI();
    }
  });

  function initMultiplayer() {
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
    

    const lobby = $('lobby');
    const gameContainer = $('game-container');
    const playerNameInput = $('player-name');
    const joinLobbyBtn = $('join-lobby-btn');
    const lobbyStatus = $('lobby-status');
    const lobbyPlayers = $('lobby-players');
    const playersList = $('players-list');

    const opponentName = $('opponent-name');
    const opponentScallous = $('opponent-scallous');
    const opponentVigor = $('opponent-vigor');
    const turnIndicator = $('turn-indicator');
    const turnNumber = $('turn-number');
    const currentPhase = $('current-phase');
    const phaseIndicator = $('phase-indicator');

    const playerBattlefield = $('player-battlefield');
    const opponentBattlefield = $('opponent-battlefield');
    const handOverlay = $('hand-overlay');
    const handOverlayCards = $('hand-overlay-cards');
    const handToggleBtn = $('hand-toggle-btn');
    const handToggleOverlay = $('hand-toggle-overlay');
    const clickOutsideDetector = $('click-outside-detector');

    const drawCardBtnSide = $('draw-card-btn-side');
    const autoPlayVigorBtnSide = $('auto-play-vigor-btn-side');
    const endPhaseBtnSide = $('end-phase-btn-side');
    const menuToggleBtn = $('menu-toggle-btn');
    const sideMenu = $('side-menu');
    const quitBtnSide = $('quit-btn-side');
    const menuBtnSide = $('menu-btn-side');
    const leftButtons = $('left-buttons');
    const rightButtons = $('right-buttons');
    const leaveGameX = $('leave-game-x');

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
            setPlayerLabels(gameState.players[playerIndex].name || 'Player', $('my-scallous').textContent, $('my-vigor').textContent);
            opponentName.textContent = gameState.players[1 - playerIndex].name || 'Opponent';
            console.log('My name:', gameState.players[playerIndex].name);
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
        const totalVigor = myPlayer.battlefield.filter(c => c.type === 'vigor').length;
        const usedVigor = myPlayer.vigorUsedThisTurn || 0;
        const availableVigor = totalVigor - usedVigor;
        setPlayerLabels(myPlayer.name || 'Player', `Scallous: ${myPlayer.life}`, `Vigor: ${availableVigor}/${totalVigor}`);

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
        if (lobbyPollInterval) clearInterval(lobbyPollInterval);
        if (phaseTimerInterval) clearInterval(phaseTimerInterval);
        gameId = null;
        gameState = null;
        showLobby();
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

    leaveGameX.addEventListener('click', () => {
        if (pollInterval) clearInterval(pollInterval);
        if (lobbyPollInterval) clearInterval(lobbyPollInterval);
        window.location.href = 'index.html';
    });

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
  }

  /* ===== Local AI mode ===== */
  window.handleCardImageError = function(img, color, emoji, centered) {
      img.style.display = 'none';
      const parent = img.parentElement;
      parent.style.background = color;
      const span = document.createElement('span');
      span.style.fontSize = '3em';
      if (centered) {
          span.style.position = 'absolute';
          span.style.top = '50%';
          span.style.left = '50%';
          span.style.transform = 'translate(-50%, -50%)';
      }
      span.textContent = emoji;
      parent.appendChild(span);
  };

  // Fallback for card images that fail to load
  function handleCardImageError(img, color, emoji, centered) {
      window.handleCardImageError(img, color, emoji, centered);
  }

  // Normalize raw card "type" values (e.g. "Primordial Being") from MongoDB into the
  // lowercase single-word types ('primordial', 'creature', etc.) used throughout this file
  function normalizeCardType(rawType) {
      if (!rawType) return rawType;
      const lower = rawType.toLowerCase();
      const knownTypes = ['primordial', 'vigor', 'rune', 'equipment', 'creature'];
      const match = knownTypes.find(type => lower.includes(type));
      return match || lower.replace(/\s+/g, '-');
  }

  // Game State Management
  class GameState {
      constructor() {
          this.player = {
              name: 'Player',
              life: 30,
              mana: 0,
              hand: [],
              battlefield: [],
              deck: [],
              primordial: null,
              graveyard: []
          };
          
          this.opponent = {
              name: 'Opponent',
              life: 30,
              mana: 0,
              hand: [],
              battlefield: [],
              deck: [],
              primordial: null,
              graveyard: []
          };
          
          this.turnNumber = 1;
          this.isPlayerTurn = true;
          this.selectedCard = null;
          this.draggedCard = null;
          this.gameOver = false;
          this.winner = null;
          this.selectedCreature = null;
          this.currentPhase = 'vigor_reset'; // vigor_reset, draw, play, attack, end
          this.isTwoPlayer = false; // Add option for 2-player mode
      }
      
      calculateMana(player) {
          // Count Vigor cards on battlefield
          const vigorCards = player.battlefield.filter(card => card.type === 'vigor');
          return vigorCards.length;
      }
      
      vigorReset(player) {
          // Reset mana based on Vigor cards on battlefield
          player.mana = this.calculateMana(player);
          console.log(`${player.name} Vigor Reset - Mana: ${player.mana} (from ${this.calculateMana(player)} Vigor cards)`);
      }
      
      drawCard(player) {
          if (player.deck.length > 0 && player.hand.length < 10) {
              const card = player.deck.pop();
              
              // Handle Primordial (king) cards - they go directly to battlefield
              if (card.type === 'primordial') {
                  player.primordial = card;
                  player.battlefield.push(card);
                  console.log(`${player.name} drew their Primordial King!`);
                  return card;
              }
              
              // All other cards go to hand (including Vigor)
              player.hand.push(card);
              return card;
          }
          return null;
      }
      
      playCard(player, card, targetZone, targetCard = null) {
          if (!player.hand.includes(card)) return false;
          
          // Handle Primordial cards (auto-played when drawn)
          if (card.type === 'primordial') {
              return false; // Already handled in drawCard
          }
          
          // Handle Vigor cards - play to battlefield to increase future mana
          if (card.type === 'vigor') {
              if (player.battlefield.length < 7) {
                  player.hand = player.hand.filter(c => c !== card);
                  player.battlefield.push(card);
                  console.log(`${player.name} played Vigor to battlefield`);
                  return true;
              }
              return false;
          }
          
          // Handle Rune cards (one-time use spells)
          if (card.type === 'rune') {
              if (card.manaCost <= player.mana) {
                  player.mana -= card.manaCost;
                  player.hand = player.hand.filter(c => c !== card);
                  this.castSpell(player, card);
                  player.graveyard.push(card);
                  return true;
              }
              return false;
          }
          
          // Handle Equipment cards (attach to creatures)
          if (card.type === 'equipment') {
              if (card.manaCost <= player.mana && targetCard && (targetCard.type === 'creature' || targetCard.type === 'primordial')) {
                  player.mana -= card.manaCost;
                  player.hand = player.hand.filter(c => c !== card);
                  targetCard.attachedEquipment = card;
                  targetCard.attack += card.attack;
                  targetCard.defense += card.defense;
                  console.log(`${card.name} attached to ${targetCard.name}`);
                  return true;
              }
              return false;
          }
          
          // Handle Creature cards
          if (card.type === 'creature') {
              if (player.battlefield.length < 7 && card.manaCost <= player.mana) {
                  player.mana -= card.manaCost;
                  player.hand = player.hand.filter(c => c !== card);
                  player.battlefield.push(card);
                  return true;
              }
              return false;
          }
          
          return false;
      }
      
      castSpell(player, spell) {
          console.log(`${player.name} cast spell: ${spell.name}`);
          // Implement spell effects here
          // For now, just deal damage to opponent
          const damage = Math.floor(Math.random() * 5) + 3;
          if (player === this.player) {
              this.opponent.life -= damage;
          } else {
              this.player.life -= damage;
          }
          this.checkWinCondition();
      }
      
      attackCreature(attacker, defender, attackerPlayer, defenderPlayer) {
          if (!attacker || !defender || attacker.type !== 'creature' || defender.type !== 'creature') return false;
          
          // Check if attacker has special ability that can be used
          if (attacker.abilities && attacker.abilities.length > 0) {
              // Try to use special ability if enough mana
              const usableAbility = attacker.abilities.find(ability => ability.cost <= attackerPlayer.mana);
              if (usableAbility) {
                  attackerPlayer.mana -= usableAbility.cost;
                  this.executeAbility(usableAbility, attacker, defender, attackerPlayer, defenderPlayer);
                  console.log(`${attacker.name} used ${usableAbility.name}!`);
                  this.checkWinCondition();
                  return true;
              }
          }
          
          // Normal attack
          defender.defense -= attacker.attack;
          attacker.defense -= defender.attack;
          
          console.log(`${attacker.name} attacks ${defender.name} for ${attacker.attack} damage`);
          
          // Check if creatures died
          if (defender.defense <= 0) {
              defenderPlayer.battlefield = defenderPlayer.battlefield.filter(c => c !== defender);
              defenderPlayer.graveyard.push(defender);
              console.log(`${defender.name} was destroyed`);
          }
          
          if (attacker.defense <= 0) {
              attackerPlayer.battlefield = attackerPlayer.battlefield.filter(c => c !== attacker);
              attackerPlayer.graveyard.push(attacker);
              console.log(`${attacker.name} was destroyed`);
          }
          
          this.checkWinCondition();
          return true;
      }
      
      attackPlayer(attacker, defenderPlayer, attackerPlayer) {
          if (!attacker || attacker.type !== 'creature') return false;
          
          // Check if attacker has special ability that can be used
          if (attacker.abilities && attacker.abilities.length > 0) {
              const usableAbility = attacker.abilities.find(ability => ability.cost <= attackerPlayer.mana);
              if (usableAbility) {
                  attackerPlayer.mana -= usableAbility.cost;
                  this.executeAbility(usableAbility, attacker, null, attackerPlayer, defenderPlayer);
                  console.log(`${attacker.name} used ${usableAbility.name}!`);
                  this.checkWinCondition();
                  return true;
              }
          }
          
          // Normal attack
          defenderPlayer.life -= attacker.attack;
          console.log(`${attacker.name} attacks ${defenderPlayer.name} for ${attacker.attack} damage`);
          
          this.checkWinCondition();
          return true;
      }
      
      executeAbility(ability, attacker, target, attackerPlayer, defenderPlayer) {
          // Execute different ability types
          switch(ability.type) {
              case 'damage':
                  if (target) {
                      target.defense -= ability.value;
                      if (target.defense <= 0) {
                          defenderPlayer.battlefield = defenderPlayer.battlefield.filter(c => c !== target);
                          defenderPlayer.graveyard.push(target);
                      }
                  } else {
                      defenderPlayer.life -= ability.value;
                  }
                  break;
              case 'life_gain':
                  attackerPlayer.life += ability.value;
                  break;
              case 'draw':
                  for (let i = 0; i < ability.value; i++) {
                      this.drawCard(attackerPlayer);
                  }
                  break;
              case 'turn_creature':
                  if (target) {
                      // Simple implementation: remove from battlefield temporarily
                      // In a full implementation, you'd track turns and return the creature
                      console.log(`${target.name} turned for ${ability.duration} rounds`);
                  }
                  break;
              case 'summon':
                  // Summon a token creature
                  const token = {
                      id: Date.now() + Math.random(),
                      name: ability.tokenName || 'Token',
                      type: 'creature',
                      manaCost: 0,
                      attack: ability.attack || 3,
                      defense: ability.defense || 3,
                      color: '#a8e6cf',
                      image: 'data:image/svg+xml;base64,' + btoa('<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#a8e6cf"/><text x="50" y="50" font-size="40" text-anchor="middle" fill="white" dy=".3em">👻</text></svg>')
                  };
                  attackerPlayer.battlefield.push(token);
                  break;
              default:
                  console.log(`Unknown ability type: ${ability.type}`);
          }
      }
      
      checkWinCondition() {
          // Check if Primordial died
          if (this.player.primordial && !this.player.battlefield.includes(this.player.primordial)) {
              this.gameOver = true;
              this.winner = this.opponent.name;
              console.log(`${this.player.name}'s Primordial was destroyed! ${this.opponent.name} wins!`);
          }
          
          if (this.opponent.primordial && !this.opponent.battlefield.includes(this.opponent.primordial)) {
              this.gameOver = true;
              this.winner = this.player.name;
              console.log(`${this.opponent.name}'s Primordial was destroyed! ${this.player.name} wins!`);
          }
          
          // Check if life reached 0
          if (this.player.life <= 0) {
              this.gameOver = true;
              this.winner = this.opponent.name;
              console.log(`${this.player.name} lost all life! ${this.opponent.name} wins!`);
          }
          
          if (this.opponent.life <= 0) {
              this.gameOver = true;
              this.winner = this.player.name;
              console.log(`${this.opponent.name} lost all life! ${this.player.name} wins!`);
          }
      }
      
      endTurn() {
          if (this.gameOver) return;
          
          console.log(`Ending turn, current turn: ${this.isPlayerTurn ? 'Player' : 'Opponent'}`);
          
          this.isPlayerTurn = !this.isPlayerTurn;
          
          if (this.isPlayerTurn) {
              this.turnNumber++;
              this.runPlayerTurn(this.player, this.opponent);
          } else {
              this.runOpponentTurn(this.opponent, this.player);
          }
      }
      
      runPlayerTurn(player, opponent) {
          console.log(`--- ${player.name}'s Turn ${this.turnNumber} ---`);
          
          // Phase 1: Vigor Reset
          this.currentPhase = 'vigor_reset';
          this.vigorReset(player);
          
          // Phase 2: Draw
          this.currentPhase = 'draw';
          this.drawCard(player);
          
          // Phase 3: Play Vigor (if able)
          this.currentPhase = 'play_vigor';
          this.autoPlayVigor(player);
          
          // Phase 4: Play other cards (Creatures, Runes, Equipment)
          this.currentPhase = 'play_cards';
          // Player must manually play these
          
          // Phase 5: Attack phase
          this.currentPhase = 'attack';
          // Player must manually attack
          
          this.currentPhase = 'end';
          console.log(`${player.name}'s turn ready for manual actions`);
      }
      
      runOpponentTurn(player, opponent) {
          console.log(`Starting ${player.name}'s turn...`);
          
          // If in 2-player mode, skip AI and let second player play
          if (this.isTwoPlayer) {
              console.log(`${player.name}'s turn (2-player mode)`);
              this.vigorReset(player);
              this.drawCard(player);
              this.autoPlayVigor(player);
              this.currentPhase = 'play_cards';
              // Second player must manually play cards and attack
              console.log(`${player.name} can now play cards and attack`);
              return;
          }
          
          console.log(`--- ${player.name}'s Turn ${this.turnNumber} (AI) ---`);
          
          // Phase 1: Vigor Reset
          this.currentPhase = 'vigor_reset';
          this.vigorReset(player);
          
          // Phase 2: Draw
          this.currentPhase = 'draw';
          this.drawCard(player);
          
          // Phase 3: Play Vigor (if able)
          this.currentPhase = 'play_vigor';
          this.autoPlayVigor(player);
          
          // Phase 4: Play other cards
          this.currentPhase = 'play_cards';
          this.aiPlayCards(player);
          
          // Phase 5: Attack
          this.currentPhase = 'attack';
          this.aiAttack(player, opponent);
          
          // End turn after delay
          this.currentPhase = 'end';
          console.log(`${player.name} ending turn...`);
          setTimeout(() => {
              console.log('Timeout reached, ending opponent turn');
              this.endTurn();
          }, 2000);
      }
      
      autoPlayVigor(player) {
          // Automatically play Vigor cards if able
          const vigorCards = player.hand.filter(card => card.type === 'vigor');
          vigorCards.forEach(card => {
              if (player.battlefield.length < 7) {
                  this.playCard(player, card);
              }
          });
      }
      
      aiPlayCards(player) {
          // Try to play creatures first
          const creatures = player.hand.filter(card => 
              card.type === 'creature' && card.manaCost <= player.mana
          );
          
          if (creatures.length > 0 && player.battlefield.length < 7) {
              const cardToPlay = creatures[Math.floor(Math.random() * creatures.length)];
              this.playCard(player, cardToPlay);
          }
          
          // Try to play equipment
          const equipment = player.hand.filter(card => 
              card.type === 'equipment' && card.manaCost <= player.mana
          );
          
          if (equipment.length > 0) {
              const equipToPlay = equipment[Math.floor(Math.random() * equipment.length)];
              const targetCreature = player.battlefield.find(c => c.type === 'creature' || c.type === 'primordial');
              if (targetCreature) {
                  this.playCard(player, equipToPlay, null, targetCreature);
              }
          }
          
          // Try to cast spells
          const spells = player.hand.filter(card => 
              card.type === 'rune' && card.manaCost <= player.mana
          );
          
          if (spells.length > 0) {
              const spellToCast = spells[Math.floor(Math.random() * spells.length)];
              this.playCard(player, spellToCast);
          }
      }
      
      aiAttack(attackerPlayer, defenderPlayer) {
          const creatures = attackerPlayer.battlefield.filter(c => c.type === 'creature');
          
          creatures.forEach(creature => {
              if (Math.random() > 0.3) { // 70% chance to attack
                  const targetCreatures = defenderPlayer.battlefield.filter(c => c.type === 'creature');
                  
                  if (targetCreatures.length > 0 && Math.random() > 0.5) {
                      // Attack creature
                      const target = targetCreatures[Math.floor(Math.random() * targetCreatures.length)];
                      this.attackCreature(creature, target, attackerPlayer, defenderPlayer);
                  } else {
                      // Attack player directly
                      this.attackPlayer(creature, defenderPlayer, attackerPlayer);
                  }
              }
          });
      }
  }

  // Card Generator
  class CardGenerator {
      static cardImages = [
          'Alarion.png', 'Aldariel.png', 'Anda.png', 'Brozurk.png', 'Brugoth.png',
          'Brukarr.png', 'Burr.png', 'Carirol.png', 'Chran.png', 'Chrevarr.png',
          'Cyrel.png', 'Darian.png', 'Dasrin.png', 'Elara.png', 'Lysandria.png',
          'Meidas.png', 'Miranni.png', 'Nalsi.png', 'Nigrock.png', 'Noggrurr.png',
          'Orananni.png', 'Perkin.png', 'Serahel.png', 'Seraphim.png', 'Seraphyne.png',
          'Shava.png', 'Stirralk.png', 'Stotrirk.png', 'Stuvrith.png', 'Tador.png',
          'Thetorr.png', 'Tirk.png', 'Zhaddimkk.png', 'Zhiddalk.png', 'Zhork.png', 'Zoran.png'
      ];
      
      static cardNames = [
          'Alarion', 'Aldariel', 'Anda', 'Brozurk', 'Brugoth',
          'Brukarr', 'Burr', 'Carirol', 'Chran', 'Chrevarr',
          'Cyrel', 'Darian', 'Dasrin', 'Elara', 'Lysandria',
          'Meidas', 'Miranni', 'Nalsi', 'Nigrock', 'Noggrurr',
          'Orananni', 'Perkin', 'Serahel', 'Seraphim', 'Seraphyne',
          'Shava', 'Stirralk', 'Stotrirk', 'Stuvrith', 'Tador',
          'Thetorr', 'Tirk', 'Zhaddimkk', 'Zhiddalk', 'Zhork', 'Zoran'
      ];
      
      static vigorNames = ['Duskbeast', 'Dawnfire', 'Moonlit', 'Sunrise', 'Starlight', 'Shadow', 'Light', 'Nature'];
      
      static primordialNames = ['Aelarion', 'Stotrirk', 'Thetorr', 'Zoran', 'Adna', 'Elara', 'Seraphyne', 'Lysandria'];
      
      static runeAbilities = [
          { name: 'Fungal Bloom', cost: 14, description: 'Deal 10-15 damage and spread disease', effect: 'damage', value: 15 },
          { name: 'Acid Rainfall', cost: 12, description: 'Corrosive rain, damages all 2 rounds', effect: 'damage', value: 12 },
          { name: 'Blizzard Barrage', cost: 15, description: 'No attacks 5 turns', effect: 'damage', value: 8 },
          { name: 'Celestial Judgment', cost: 16, description: 'Force opponent skip next turn', effect: 'damage', value: 10 },
          { name: 'Doomsday Prophecy', cost: 18, description: 'Deals 5 damage', effect: 'damage', value: 5 },
          { name: 'Flameburst', cost: 8, description: 'Attacks opponent 2 damage', effect: 'damage', value: 2 },
          { name: 'Lightning Bolt', cost: 10, description: 'Attacks opponent 2 damage', effect: 'damage', value: 2 },
          { name: 'Tidal Wave', cost: 16, description: 'Attacks all 5 damage', effect: 'damage', value: 5 }
      ];
      
      static equipmentAbilities = [
          { name: 'Acrobatic Flourish', cost: 11, attack: 0, defense: 0, description: 'Precise dagger strike, 25 damage' },
          { name: 'Deadly Dagger', cost: 8, attack: 5, defense: 0, description: 'Quick strike, 15 damage' },
          { name: 'Shadow Cloak', cost: 6, attack: 0, defense: 3, description: 'Dodge attacks for 3 turns' },
          { name: 'Divine Shield', cost: 10, attack: 0, defense: 5, description: 'Block all damage for 1 turn' },
          { name: 'Vampiric Blade', cost: 12, attack: 3, defense: 0, description: 'Lifesteal on attack' },
          { name: 'Flame Shield', cost: 8, attack: 2, defense: 2, description: 'Fire damage to attackers' },
          { name: 'Frost Armor', cost: 9, attack: 0, defense: 4, description: 'Freeze attackers' }
      ];
      
      static creatureAbilities = [
          { name: 'Rapid Venom', cost: 10, type: 'damage', value: 2, description: 'Deals 2 damage to opponent' },
          { name: 'Temporal Warp', cost: 2, type: 'turn_creature', duration: 4, description: 'Turn opponent creatures for 4 rounds' },
          { name: 'Soul Drain', cost: 8, type: 'life_gain', value: 5, description: 'Drain life, restore 5 HP' },
          { name: 'Fire Strike', cost: 6, type: 'damage', value: 4, description: 'Fire attack, 4 damage' },
          { name: 'Ice Shield', cost: 4, type: 'damage', value: 3, description: 'Ice attack, 3 damage' },
          { name: 'Lightning Dash', cost: 7, type: 'damage', value: 5, description: 'Lightning attack, 5 damage' }
      ];
      
      static primordialAbilities = [
          { name: 'Twilight Offering', cost: 16, type: 'summon', tokenName: 'Shadow Wraith', attack: 5, defense: 5, description: 'Summon 5/5 Shadow Wraith with Lifesteal' },
          { name: 'Soul Reclaim', cost: 16, type: 'draw', value: 1, description: 'Draw 1 card from graveyard' },
          { name: 'Divine Wrath', cost: 20, type: 'damage', value: 10, description: 'Deal 10 damage to all enemies' },
          { name: 'Eternal Guard', cost: 12, type: 'life_gain', value: 10, description: 'Restore 10 life' }
      ];
      
      static generateCard(type) {
          const randomIndex = Math.floor(Math.random() * this.cardImages.length);
          const cardImage = this.cardImages[randomIndex];
          let cardName;
          
          if (type === 'primordial') {
              cardName = this.primordialNames[Math.floor(Math.random() * this.primordialNames.length)];
          } else if (type === 'vigor') {
              cardName = this.vigorNames[Math.floor(Math.random() * this.vigorNames.length)];
          } else {
              cardName = this.cardNames[randomIndex];
          }
          
          const colors = {
              'primordial': '#ffd700',
              'vigor': '#4ecdc4',
              'creature': '#ff6b6b',
              'rune': '#a8e6cf',
              'equipment': '#c7ceea'
          };
          
          const color = colors[type] || '#ff6b6b';
          
          let card = {
              id: Date.now() + Math.random(),
              name: cardName,
              type: type,
              color: color,
              image: `/cards/${cardImage}`,
              isPrimordial: type === 'primordial',
              attachedEquipment: null,
              abilities: []
          };
          
          // Set stats based on card type
          switch(type) {
              case 'primordial':
                  card.manaCost = 0;
                  card.attack = Math.floor(Math.random() * 5) + 10;
                  card.defense = Math.floor(Math.random() * 5) + 10;
                  card.abilities = [this.primordialAbilities[Math.floor(Math.random() * this.primordialAbilities.length)]];
                  card.description = 'Your GOD. If this dies, game over.';
                  break;
              case 'vigor':
                  card.manaCost = 0;
                  card.attack = 0;
                  card.defense = 0;
                  card.description = '+1 Vigor per round when on battlefield';
                  break;
              case 'creature':
                  card.manaCost = Math.floor(Math.random() * 5) + 1;
                  card.attack = Math.floor(Math.random() * 8) + 1;
                  card.defense = Math.floor(Math.random() * 8) + 1;
                  // 50% chance to have an ability
                  if (Math.random() > 0.5) {
                      card.abilities = [this.creatureAbilities[Math.floor(Math.random() * this.creatureAbilities.length)]];
                  }
                  card.description = card.abilities.length > 0 ? card.abilities[0].description : `Creature - ${card.attack}/${card.defense}`;
                  break;
              case 'rune':
                  const runeAbility = this.runeAbilities[Math.floor(Math.random() * this.runeAbilities.length)];
                  card.manaCost = runeAbility.cost;
                  card.attack = 0;
                  card.defense = 0;
                  card.abilities = [runeAbility];
                  card.description = runeAbility.description;
                  card.isOneTimeUse = true;
                  break;
              case 'equipment':
                  const equipAbility = this.equipmentAbilities[Math.floor(Math.random() * this.equipmentAbilities.length)];
                  card.manaCost = equipAbility.cost;
                  card.attack = equipAbility.attack;
                  card.defense = equipAbility.defense;
                  card.abilities = [equipAbility];
                  card.description = equipAbility.description;
                  break;
          }
          
          return card;
      }
      
      static generateDeck() {
          const deck = [];
          
          // 1 Primordial (King) - NEVER CHANGES
          deck.push(this.generateCard('primordial'));
          
          // 20 Vigor (Mana) - 33%
          for (let i = 0; i < 20; i++) {
              deck.push(this.generateCard('vigor'));
          }
          
          // 24 Creatures - 40%
          for (let i = 0; i < 24; i++) {
              deck.push(this.generateCard('creature'));
          }
          
          // 8 Runes (Spells) - 1-time use
          for (let i = 0; i < 8; i++) {
              deck.push(this.generateCard('rune'));
          }
          
          // 7 Accoutrements (Equipment) - attach to creatures
          for (let i = 0; i < 7; i++) {
              deck.push(this.generateCard('equipment'));
          }
          
          // Shuffle deck
          deck.sort(() => Math.random() - 0.5);
          
          return deck;
      }
  }

  function initAI() {
    const gameState = new GameState();

    const storedDeck = sessionStorage.getItem('selectedDeck');
    if (storedDeck) {
      try {
        const deckData = JSON.parse(storedDeck);
        gameState.player.deck = deckData.cards.map(card => ({ ...card, type: normalizeCardType(card.type) }));
      } catch (error) {
        console.error('Error loading stored deck:', error);
        gameState.player.deck = CardGenerator.generateDeck();
      }
    } else {
      gameState.player.deck = CardGenerator.generateDeck();
    }

    gameState.opponent.deck = CardGenerator.generateDeck();
    gameState.player.deck.sort(() => Math.random() - 0.5);
    gameState.opponent.deck.sort(() => Math.random() - 0.5);

    for (let i = 0; i < 7; i++) {
      gameState.drawCard(gameState.player);
      gameState.drawCard(gameState.opponent);
    }
    gameState.vigorReset(gameState.player);
    gameState.vigorReset(gameState.opponent);

    const els = {
      playerBattlefield: $('player-battlefield'),
      opponentBattlefield: $('opponent-battlefield'),
      handOverlayCards: $('hand-overlay-cards'),
      handOverlay: $('hand-overlay'),
      handToggleBtn: $('hand-toggle-btn'),
      handToggleOverlay: $('hand-toggle-overlay'),
      clickOutsideDetector: $('click-outside-detector'),
      opponentName: $('opponent-name'),
      opponentScallous: $('opponent-scallous'),
      opponentVigor: $('opponent-vigor'),
      turnIndicator: $('turn-indicator'),
      turnNumber: $('turn-number'),
      currentPhase: $('current-phase'),
      phaseIndicator: $('phase-indicator'),
      drawCardBtnSide: $('draw-card-btn-side'),
      autoPlayVigorBtnSide: $('auto-play-vigor-btn-side'),
      endPhaseBtnSide: $('end-phase-btn-side'),
      menuToggleBtn: $('menu-toggle-btn'),
      sideMenu: $('side-menu'),
      quitBtnSide: $('quit-btn-side'),
      menuBtnSide: $('menu-btn-side'),
      leftButtons: $('left-buttons'),
      rightButtons: $('right-buttons'),
      leaveGameX: $('leave-game-x'),
      gameNotification: $('game-notification'),
    };

    let isHandExpanded = false;

    function toggleHand() {
      isHandExpanded = !isHandExpanded;
      if (isHandExpanded) {
        els.handOverlay.classList.add('active');
        els.handToggleBtn.textContent = '−';
        els.clickOutsideDetector.classList.add('active');
      } else {
        els.handOverlay.classList.remove('active');
        els.handToggleBtn.textContent = 'Hand';
        els.clickOutsideDetector.classList.remove('active');
      }
    }

    function createCardElement(card, isDraggable) {
      const cardEl = document.createElement('div');
      cardEl.className = 'card';
      if (card.type) cardEl.classList.add(`card-${card.type}`);

      const cost = card.manaCost ?? card.cost ?? 0;
      const attack = card.attack ?? 0;
      const defense = card.defense ?? 0;
      let html = '';
      if (card.type === 'vigor') {
        html = `<div class="card-cost">0</div><div class="card-name">${card.name}</div><div class="card-image vigor-icon"><span style="font-size:3em">💎</span></div><div class="card-description">+1 Vigor per round</div>`;
      } else if (card.type === 'primordial') {
        html = `<div class="card-cost">${cost}</div><div class="card-name primordial-name">${card.name}</div><div class="card-image"><span style="font-size:3em">👑</span></div><div class="card-stats"><span class="card-attack">⚔${attack}</span><span class="card-defense">🛡${defense}</span></div><div class="card-primordial-indicator">👑</div>`;
      } else if (card.type === 'rune') {
        html = `<div class="card-cost">${cost}</div><div class="card-name">${card.name}</div><div class="card-image rune-icon"><span style="font-size:3em">✨</span></div><div class="card-description">One-time use</div>`;
      } else if (card.type === 'equipment') {
        html = `<div class="card-cost">${cost}</div><div class="card-name">${card.name}</div><div class="card-image equipment-icon"><span style="font-size:3em">⚔️</span></div><div class="card-stats"><span class="card-attack">+${attack}</span><span class="card-defense">+${defense}</span></div><div class="card-description">Attach to creature</div>`;
      } else {
        html = `<div class="card-cost">${cost}</div><div class="card-name">${card.name}</div><div class="card-image"><span style="font-size:3em">⚔️</span></div><div class="card-stats"><span class="card-attack">⚔${attack}</span><span class="card-defense">🛡${defense}</span></div>`;
      }
      cardEl.innerHTML = html;

      if (isDraggable) {
        cardEl.addEventListener('click', () => {
          if (!gameState.isPlayerTurn) return;
          if (card.type === 'vigor' || card.type === 'rune') {
            gameState.playCard(gameState.player, card);
            render();
          } else if (card.type === 'creature' || card.type === 'primordial') {
            if (gameState.playCard(gameState.player, card)) render();
            else alert('Cannot play that card (mana or space)');
          } else if (card.type === 'equipment') {
            const target = gameState.player.battlefield.find(c => c.type === 'creature' || c.type === 'primordial');
            if (!target) { alert('No creature to equip'); return; }
            if (gameState.playCard(gameState.player, card, null, target)) render();
            else alert('Cannot attach equipment');
          }
        });
      }
      return cardEl;
    }

    function render() {
      setPlayerLabels(
        gameState.player.name,
        `Scallous: ${gameState.player.life}`,
        `Vigor: ${gameState.calculateMana(gameState.player)}`
      );
      els.opponentName.textContent = gameState.opponent.name;
      els.opponentScallous.textContent = `Scallous: ${gameState.opponent.life}`;
      els.opponentVigor.textContent = `Vigor: ${gameState.calculateMana(gameState.opponent)}`;
      els.turnIndicator.textContent = gameState.isPlayerTurn ? 'Your Turn' : "Opponent's Turn";
      els.turnNumber.textContent = `Turn: ${gameState.turnNumber}`;
      els.currentPhase.textContent = (gameState.currentPhase || 'play').replace(/_/g, ' ');

      const myTurn = gameState.isPlayerTurn && !gameState.gameOver;
      els.drawCardBtnSide.disabled = !myTurn;
      els.autoPlayVigorBtnSide.disabled = !myTurn;
      els.endPhaseBtnSide.disabled = !myTurn;
      els.leftButtons.style.display = myTurn ? 'flex' : 'none';
      els.rightButtons.style.display = myTurn ? 'flex' : 'none';

      els.handOverlayCards.innerHTML = '';
      gameState.player.hand.forEach(card => {
        els.handOverlayCards.appendChild(createCardElement(card, myTurn));
      });

      els.playerBattlefield.innerHTML = '';
      gameState.player.battlefield.filter(c => c.type !== 'vigor').forEach(card => {
        els.playerBattlefield.appendChild(createCardElement(card, false));
      });

      els.opponentBattlefield.innerHTML = '';
      gameState.opponent.battlefield.filter(c => c.type !== 'vigor').forEach(card => {
        els.opponentBattlefield.appendChild(createCardElement(card, false));
      });

      if (gameState.gameOver) {
        els.gameNotification.textContent = `${gameState.winner} wins!`;
        els.gameNotification.classList.add('show');
      }
    }

    function endPlayerActions() {
      if (!gameState.isPlayerTurn || gameState.gameOver) return;
      gameState.endTurn();
      render();
      if (!gameState.isPlayerTurn && !gameState.gameOver) {
        setTimeout(() => {
          // AI turn already scheduled inside endTurn/runOpponentTurn
          render();
          const check = setInterval(() => {
            render();
            if (gameState.isPlayerTurn || gameState.gameOver) clearInterval(check);
          }, 500);
        }, 200);
      }
    }

    els.drawCardBtnSide.addEventListener('click', () => {
      if (!gameState.isPlayerTurn) return;
      gameState.drawCard(gameState.player);
      render();
    });
    els.autoPlayVigorBtnSide.addEventListener('click', () => {
      if (!gameState.isPlayerTurn) return;
      gameState.autoPlayVigor(gameState.player);
      render();
    });
    els.endPhaseBtnSide.addEventListener('click', endPlayerActions);
    els.phaseIndicator.addEventListener('click', endPlayerActions);

    els.menuToggleBtn.addEventListener('click', () => els.sideMenu.classList.toggle('open'));
    els.quitBtnSide.addEventListener('click', () => { window.location.href = 'https://www.kloakndaggurrs.com'; });
    els.menuBtnSide.addEventListener('click', () => { window.location.href = 'index.html'; });
    els.leaveGameX.addEventListener('click', () => { window.location.href = 'index.html'; });
    els.handToggleBtn.addEventListener('click', toggleHand);
    els.handToggleOverlay.addEventListener('click', toggleHand);
    els.clickOutsideDetector.addEventListener('click', toggleHand);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'd' || e.key === 'D') els.drawCardBtnSide.click();
      else if (e.key === ' ') { e.preventDefault(); els.endPhaseBtnSide.click(); }
      else if (e.key === 'Escape') {
        if (isHandExpanded) toggleHand();
        else els.leaveGameX.click();
      }
    });

    // Kick off first player turn phases
    gameState.runPlayerTurn(gameState.player, gameState.opponent);
    render();
    console.log('AI battlefield ready');
  }

})();
