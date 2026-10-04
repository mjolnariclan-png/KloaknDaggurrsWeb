/**
 * Unified battlefield client â€” AI/local and multiplayer share one DOM.
 * ?mode=multiplayer â†’ lobby + authenticated server APIs; otherwise local AI match.
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

  /** Authenticated JSON fetch. Requires a signed-in session. */
  async function apiFetch(path, options = {}) {
    if (!window.GameAuth) throw new Error('Auth unavailable');
    const session = await window.GameAuth.getSession();
    if (!session || !session.user) {
      const err = new Error('Please log in first');
      err.auth = true;
      throw err;
    }
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...(options.headers || {}),
    };
    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    if (response.status === 401) {
      const err = new Error('Your session expired. Please log in again.');
      err.auth = true;
      throw err;
    }
    return response.json();
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

  function textNode(el, text) {
    if (el) el.textContent = text;
  }

  /** Full-screen result overlay used by both multiplayer and AI modes. */
  function showResultOverlay({ title, subtitle, details, buttons }) {
    document.querySelectorAll('.kd-result-overlay').forEach((el) => el.remove());
    const overlay = document.createElement('div');
    overlay.className = 'kd-result-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-live', 'assertive');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '9999',
      background: 'rgba(10, 8, 14, 0.92)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'inherit',
    });
    const box = document.createElement('div');
    Object.assign(box.style, {
      background: '#1d1826', color: '#f0e6d2',
      border: '2px solid #c9a86a', borderRadius: '12px',
      padding: '32px 40px', textAlign: 'center', maxWidth: '440px',
      boxShadow: '0 0 60px rgba(0,0,0,0.8)',
    });
    const h2 = document.createElement('h2');
    h2.textContent = title;
    h2.style.fontSize = '2.2em';
    h2.style.margin = '0 0 8px 0';
    box.appendChild(h2);
    if (subtitle) {
      const sub = document.createElement('div');
      sub.textContent = subtitle;
      sub.style.marginBottom = '12px';
      sub.style.color = '#c9a86a';
      box.appendChild(sub);
    }
    (details || []).forEach((line) => {
      const d = document.createElement('div');
      d.textContent = line;
      d.style.margin = '4px 0';
      box.appendChild(d);
    });
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:12px;justify-content:center;margin-top:20px;flex-wrap:wrap';
    (buttons || []).forEach((b) => {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      btn.style.cssText = 'padding:10px 18px;border-radius:6px;border:1px solid #c9a86a;background:#2a2338;color:#f0e6d2;cursor:pointer;font-size:1em';
      btn.addEventListener('click', () => { overlay.remove(); b.onClick && b.onClick(); });
      btnRow.appendChild(btn);
    });
    box.appendChild(btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
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

  /* =====================================================================
   * MULTIPLAYER â€” server-authoritative match via authenticated APIs
   * ===================================================================== */
  function initMultiplayer() {
    let playerId = null;
    let gameId = null;
    let playerIndex = 0;
    let gameState = null;
    let lastRenderedVersion = -1;
    let pollInterval = null;
    let lobbyPollInterval = null;
    let phaseTimerInterval = null;
    let phaseTimerKey = null;
    let phaseTimeRemaining = 60;
    let selectionActive = false; // an attack/target selection is in progress
    let selectionTimer = null;
    let isHandExpanded = false;
    let gameOverHandled = false;
    let surrendering = false;

    const SAVE_KEY = 'kd-mp-game';

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
    const surrenderBtnSide = $('surrender-btn-side') || null;
    const menuBtnSide = $('menu-btn-side');
    const leftButtons = $('left-buttons');
    const rightButtons = $('right-buttons');
    const leaveGameX = $('leave-game-x');

    function stopAllPolling() {
      if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
      if (lobbyPollInterval) { clearInterval(lobbyPollInterval); lobbyPollInterval = null; }
      if (phaseTimerInterval) { clearInterval(phaseTimerInterval); phaseTimerInterval = null; }
    }

    function saveGameRef() {
      try {
        sessionStorage.setItem(SAVE_KEY, JSON.stringify({ gameId, playerIndex }));
      } catch (e) { /* storage unavailable */ }
    }

    function clearGameRef() {
      try { sessionStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    }

    function readGameRef() {
      try { return JSON.parse(sessionStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { return null; }
    }

    // ---- lobby ----------------------------------------------------------

    async function joinLobby() {
      const session = await window.GameAuth.getSession();
      if (!session || !session.user) {
        lobbyStatus.textContent = 'Please log in on the main website first, then return.';
        lobbyStatus.style.color = 'red';
        return;
      }
      playerId = session.user.id;
      const defaultName = session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || 'Player';
      const playerName = playerNameInput.value || defaultName;
      lobbyStatus.textContent = 'Joining lobby...';
      lobbyStatus.style.color = '';
      const data = await apiFetch('/join-lobby', {
        method: 'POST',
        body: JSON.stringify({ playerName }),
      }).catch((err) => ({ success: false, error: err.message }));
      if (data && data.success && data.activeGameId) {
        // Live match found (e.g. after a refresh) â€” rejoin it.
        gameId = data.activeGameId;
        return rejoinGame();
      }
      if (!data || !data.success) {
        lobbyStatus.textContent = (data && data.error) || 'Failed to join lobby';
        lobbyStatus.style.color = 'red';
        return;
      }
      joinLobbyBtn.style.display = 'none';
      playerNameInput.disabled = true;
      lobbyPlayers.style.display = 'block';
      lobbyStatus.textContent = 'Waiting in lobby...';
      startLobbyPolling();
    }

    function startLobbyPolling() {
      if (lobbyPollInterval) clearInterval(lobbyPollInterval);
      lobbyPollInterval = setInterval(async () => {
        try {
          const data = await apiFetch('/lobby-players');
          if (data.success) {
            updateLobbyPlayers(data.players);
            checkForGameInvitation(data);
          }
        } catch (error) {
          if (error.auth) {
            clearInterval(lobbyPollInterval);
            lobbyStatus.textContent = 'Session expired â€” please log in again.';
            lobbyStatus.style.color = 'red';
          }
        }
      }, 2000);
    }

    function updateLobbyPlayers(players) {
      playersList.innerHTML = '';
      const otherPlayers = (players || []).filter((p) => p.id !== playerId);
      if (otherPlayers.length === 0) {
        const none = document.createElement('div');
        none.className = 'no-players';
        none.textContent = 'No other players in lobby';
        playersList.appendChild(none);
        return;
      }
      otherPlayers.forEach((player) => {
        const item = document.createElement('div');
        item.className = 'lobby-player-item';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'lobby-player-name';
        nameSpan.textContent = player.name; // textContent â€” never inject user HTML
        const btn = document.createElement('button');
        btn.className = 'lobby-player-challenge';
        btn.textContent = 'Challenge';
        btn.addEventListener('click', () => challengePlayer(player.id));
        item.appendChild(nameSpan);
        item.appendChild(btn);
        playersList.appendChild(item);
      });
    }

    function checkForGameInvitation(data) {
      if (!(data.gameInvitation && data.gameInvitation.gameId)) return;
      const invitation = data.gameInvitation;
      if (gameOverHandled || gameId === invitation.gameId) return;
      if (lobbyPollInterval) { clearInterval(lobbyPollInterval); lobbyPollInterval = null; }

      const notificationEl = document.getElementById('game-notification');
      notificationEl.innerHTML = '';
      const text = document.createElement('div');
      text.textContent = `${invitation.opponentName} has challenged you!`;
      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'margin-top:10px;display:flex;gap:10px;justify-content:center';
      const acceptBtn = document.createElement('button');
      acceptBtn.textContent = 'Accept';
      acceptBtn.style.cssText = 'padding:8px 16px;background:#4ecdc4;border:none;border-radius:5px;cursor:pointer';
      const declineBtn = document.createElement('button');
      declineBtn.textContent = 'Decline';
      declineBtn.style.cssText = 'padding:8px 16px;background:#e74c3c;border:none;border-radius:5px;cursor:pointer';
      btnRow.appendChild(acceptBtn);
      btnRow.appendChild(declineBtn);
      notificationEl.appendChild(text);
      notificationEl.appendChild(btnRow);
      notificationEl.classList.add('show');

      acceptBtn.addEventListener('click', async () => {
        notificationEl.classList.remove('show');
        let accepted;
        try {
          accepted = await apiFetch('/accept-game', {
            method: 'POST',
            body: JSON.stringify({ gameId: invitation.gameId }),
          });
        } catch (error) {
          lobbyStatus.textContent = error.message || 'Could not accept the match. Please try again.';
          lobbyStatus.style.color = 'red';
          startLobbyPolling();
          return;
        }
        if (!accepted?.success || !accepted.gameState) {
          lobbyStatus.textContent = accepted?.error || 'The match could not be accepted. Please try again.';
          lobbyStatus.style.color = 'red';
          startLobbyPolling();
          return;
        }
        enterGame({
          gameId: invitation.gameId,
          playerIndex: invitation.playerIndex,
          gameState: accepted.gameState,
        });
      });

      declineBtn.addEventListener('click', async () => {
        notificationEl.classList.remove('show');
        await apiFetch('/decline-game', {
          method: 'POST',
          body: JSON.stringify({ gameId: invitation.gameId }),
        }).catch(() => {});
        startLobbyPolling();
      });
    }

    async function challengePlayer(opponentId) {
      const cardSet = sessionStorage.getItem('cardSet') || 'Ash Cycle';
      const vigorType = sessionStorage.getItem('vigorType') || null;
      let data;
      try {
        data = await apiFetch('/challenge-player', {
          method: 'POST',
          body: JSON.stringify({ opponentId, cardSet, vigorType }),
        });
      } catch (error) {
        alert(error.auth ? error.message : 'Error challenging player');
        return;
      }
      if (data.success) {
        enterGame({ gameId: data.gameId, playerIndex: data.playerIndex, gameState: data.gameState });
      } else {
        alert(data.error || 'Could not challenge player');
      }
    }

    // ---- game lifecycle --------------------------------------------------

    function enterGame({ gameId: gid, playerIndex: pidx, gameState: gs }) {
      gameId = gid;
      playerIndex = pidx;
      gameState = gs;
      gameOverHandled = false;
      saveGameRef();
      if (lobbyPollInterval) { clearInterval(lobbyPollInterval); lobbyPollInterval = null; }
      showBoard();
      if (gameState && gameState.players) {
        setPlayerLabels(
          gameState.players[playerIndex]?.name || 'Player',
          `Scallous: ${gameState.players[playerIndex]?.life ?? 30}`,
          'Vigor: 0/0'
        );
        textNode(opponentName, gameState.players[1 - playerIndex]?.name || 'Opponent');
      }
      forceRender();
      startPolling();
    }

    function returnToLobby(message) {
      stopAllPolling();
      clearGameRef();
      gameId = null;
      gameState = null;
      gameOverHandled = false;
      showLobby();
      joinLobbyBtn.style.display = '';
      playerNameInput.disabled = false;
      lobbyStatus.textContent = message;
      lobbyStatus.style.color = 'red';
    }

    /** Rejoin a saved match after refresh/reconnect. */
    async function rejoinGame() {
      let data;
      try {
        data = await apiFetch(`/game-state/${gameId}`);
      } catch (error) {
        clearGameRef();
        gameId = null;
        alert(error.auth ? error.message : 'Could not rejoin the match.');
        return;
      }
      if (!data.success) {
        returnToLobby('That match is no longer available. Join the lobby to start another match.');
        return;
      }
      const idx = data.gameState.players.findIndex((p) => p.id === playerId);
      if (idx === -1) {
        returnToLobby('You are no longer part of that match. Join the lobby to start another match.');
        return;
      }
      if (data.gameState.status === 'completed') {
        handleGameOver(data);
        return;
      }
      enterGame({ gameId, playerIndex: idx, gameState: data.gameState });
    }

    function startPolling() {
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(async () => {
        if (!gameId || gameOverHandled) return;
        if (selectionActive) return; // don't clobber an in-progress selection
        try {
          const data = await apiFetch(`/game-state/${gameId}`);
          if (!data.success) {
            returnToLobby(data.error || 'The match is no longer available. Join the lobby to start another match.');
            return;
          }
          if (data.gameState.status === 'completed') {
            gameState = data.gameState;
            handleGameOver(data);
            return;
          }
          if (data.gameState.version !== (lastRenderedVersion === -1 ? -2 : lastRenderedVersion) || data.gameState.version !== gameState?.version) {
            gameState = data.gameState;
            render();
          }
        } catch (error) {
          if (error.auth) {
            stopAllPolling();
            alert('Your session expired. Log in and return to rejoin the match.');
          }
        }
      }, 1500);
    }

    function forceRender() {
      lastRenderedVersion = -1;
      render();
    }

    // ---- actions ----------------------------------------------------------

    function newActionId() {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
      return `act-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    async function doAction(path, body, { silent } = {}) {
      if (!gameId || gameOverHandled) return;
      // Optimistic concurrency: act on the version we are looking at. The
      // server rejects stale/duplicate requests and returns the authoritative
      // state, which we adopt immediately.
      const payload = {
        gameId,
        expectedVersion: gameState ? gameState.version : undefined,
        actionId: newActionId(),
        ...body,
      };
      try {
        const data = await apiFetch(path, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (data.success) {
          gameState = data.gameState;
          if (gameState.status === 'completed') {
            const final = await apiFetch(`/game-state/${gameId}`).catch(() => data);
            handleGameOver(final.success ? final : data);
            return;
          }
          forceRender();
        } else if (data.stale || data.duplicate || data.invalidRequest) {
          // The authoritative state moved (opponent action, our own double
          // click, a network retry, or a phase timeout). Adopt it silently.
          if (data.gameState) {
            gameState = data.gameState;
            if (gameState.status === 'completed') {
              handleGameOver(data);
              return;
            }
            forceRender();
          } else {
            await refreshAuthoritativeState();
          }
        } else if (!silent) {
          showGameNotification(data.error || 'Action failed');
        }
      } catch (error) {
        console.error(`${path} failed:`, error);
        showGameNotification(error.auth ? error.message : 'Connection error');
      }
    }

    /** Re-fetch the authoritative game state (used after stale rejections). */
    async function refreshAuthoritativeState() {
      if (!gameId || gameOverHandled) return;
      try {
        const data = await apiFetch(`/game-state/${gameId}`);
        if (data.success) {
          gameState = data.gameState;
          if (gameState.status === 'completed') { handleGameOver(data); return; }
          forceRender();
        }
      } catch (e) { /* polling will retry */ }
    }

    function showGameNotification(message) {
      const notificationEl = document.getElementById('game-notification');
      if (!notificationEl) { alert(message); return; }
      notificationEl.textContent = message;
      notificationEl.classList.add('show');
      setTimeout(() => notificationEl.classList.remove('show'), 2500);
    }

    // ---- rendering ---------------------------------------------------------

    function render() {
      if (!gameState) return;
      if (gameState.version === lastRenderedVersion) return;
      lastRenderedVersion = gameState.version;

      const myPlayer = gameState.players[playerIndex];
      const opponentPlayer = gameState.players[1 - playerIndex];
      if (!myPlayer || !opponentPlayer) return;

      const totalVigor = myPlayer.battlefield.filter((c) => c.type === 'vigor').length;
      const usedVigor = myPlayer.vigorUsedThisTurn || 0;
      const availableVigor = Math.min(20, totalVigor) - usedVigor;
      setPlayerLabels(
        myPlayer.name || 'Player',
        `Scallous: ${myPlayer.life}`,
        `Vigor: ${availableVigor}/${Math.min(20, totalVigor)}`
      );

      textNode(opponentName, opponentPlayer.name || 'Opponent');
      textNode(opponentScallous, `Scallous: ${opponentPlayer.life}`);
      const oppTotalVigor = opponentPlayer.battlefield.filter((c) => c.type === 'vigor').length;
      const oppUsedVigor = opponentPlayer.vigorUsedThisTurn || 0;
      textNode(opponentVigor, `Vigor: ${Math.min(20, oppTotalVigor) - oppUsedVigor}/${Math.min(20, oppTotalVigor)}`);

      const isMyTurn = gameState.currentTurn === playerIndex;
      textNode(turnIndicator, isMyTurn ? 'Your Turn' : "Opponent's Turn");
      textNode(turnNumber, `Turn: ${gameState.turnNumber || 1}`);

      drawCardBtnSide.disabled = !isMyTurn || gameState.phase !== 'draw';
      autoPlayVigorBtnSide.disabled = !isMyTurn || gameState.phase !== 'vigor';
      endPhaseBtnSide.disabled = !isMyTurn;
      if (surrenderBtnSide) surrenderBtnSide.disabled = false;

      leftButtons.style.display = isMyTurn ? 'flex' : 'none';
      rightButtons.style.display = isMyTurn ? 'flex' : 'none';

      if (gameState.phase) {
        textNode(currentPhase, gameState.phase.charAt(0).toUpperCase() + gameState.phase.slice(1) + ' Phase');
      }

      updatePhaseTimer(isMyTurn);

      renderCards(myPlayer.hand, handOverlayCards, true);
      renderCards(myPlayer.battlefield.filter((c) => c.type !== 'vigor'), playerBattlefield, false, false, false);
      renderCards(opponentPlayer.battlefield.filter((c) => c.type !== 'vigor'), opponentBattlefield, false, false, true);

      // Attackable opponents during my attack phase
      if (isMyTurn && gameState.phase === 'attack') {
        opponentBattlefield.querySelectorAll('.card').forEach((card, index) => {
          card.classList.add('attackable');
          card.addEventListener('click', (e) => {
            e.stopPropagation();
            const opp = gameState.players[1 - playerIndex];
            const oppVisible = opp.battlefield.filter((c) => c.type !== 'vigor');
            const cardData = oppVisible[index];
            const fullTargetIndex = opp.battlefield.indexOf(cardData);
            beginSelection(() => handleAttackTarget(fullTargetIndex, false));
          });
        });

        const oppPrimordial = opponentPlayer.battlefield.find((c) => c.type === 'primordial');
        const oppCreatures = opponentPlayer.battlefield.filter((c) => c.type === 'creature');
        const existingBtn = document.getElementById('attack-player-btn');
        if (existingBtn) existingBtn.remove();
        if (!oppPrimordial && oppCreatures.length === 0) addAttackPlayerButton();
      }
    }

    /**
     * Selections survive polling: while a selection is active, polled updates
     * are deferred (startPolling skips). A safety timeout ends the deferral.
     */
    function beginSelection(fn) {
      selectionActive = true;
      if (selectionTimer) clearTimeout(selectionTimer);
      selectionTimer = setTimeout(() => { selectionActive = false; }, 15000);
      fn();
      // If the selection UI was fully consumed synchronously (no async work),
      // leave selectionActive true only while awaiting user clicks; the
      // timeout above is the fallback that restores polling.
    }

    function endSelection() {
      selectionActive = false;
      if (selectionTimer) { clearTimeout(selectionTimer); selectionTimer = null; }
    }

    function updatePhaseTimer(isMyTurn) {
      const key = `${gameState.turnNumber || 1}-${gameState.currentTurn}-${gameState.phase}`;
      if (!isMyTurn) {
        if (phaseTimerInterval) { clearInterval(phaseTimerInterval); phaseTimerInterval = null; }
        phaseTimerKey = null;
        return;
      }
      if (phaseTimerKey === key) return;
      phaseTimerKey = key;
      phaseTimeRemaining = 60;
      if (phaseTimerInterval) clearInterval(phaseTimerInterval);
      phaseTimerInterval = setInterval(() => {
        phaseTimeRemaining--;
        if (phaseTimeRemaining <= 0) {
          clearInterval(phaseTimerInterval);
          phaseTimerInterval = null;
          if (!endPhaseBtnSide.disabled) endPhaseBtnSide.click();
        }
      }, 1000);
    }

    function addAttackPlayerButton() {
      const btn = document.createElement('button');
      btn.id = 'attack-player-btn';
      btn.className = 'attack-player-btn';
      btn.textContent = 'Attack Player';
      btn.addEventListener('click', () => {
        beginSelection(() => selectAttackerForPlayerAttack());
      });
      opponentBattlefield.appendChild(btn);
    }

    function markAttackableCreatures(onClick) {
      const myBattlefield = gameState.players[playerIndex].battlefield.filter((c) => c.type !== 'vigor');
      document.querySelectorAll('#player-battlefield .card').forEach((card, index) => {
        const cardData = myBattlefield[index];
        if (cardData && (cardData.type === 'creature' || cardData.type === 'primordial') && (cardData.canAttack || cardData.hasHaste)) {
          card.classList.add('selectable');
          card.addEventListener('click', () => {
            document.querySelectorAll('.card').forEach((c) => {
              c.classList.remove('selected');
              c.classList.remove('selectable');
            });
            card.classList.add('selected');
            const fullIndex = gameState.players[playerIndex].battlefield.indexOf(cardData);
            endSelection();
            onClick(fullIndex);
          });
        }
      });
    }

    function clearSelectionClasses() {
      document.querySelectorAll('.card').forEach((c) => {
        c.classList.remove('selected');
        c.classList.remove('selectable');
      });
    }

    function selectAttackerForPlayerAttack() {
      clearSelectionClasses();
      const myBattlefield = gameState.players[playerIndex].battlefield.filter((c) => c.type !== 'vigor');
      const myCreatures = myBattlefield.filter((c) =>
        (c.type === 'creature' || c.type === 'primordial') && (c.canAttack || c.hasHaste)
      );
      if (myCreatures.length === 0) {
        endSelection();
        showGameNotification('No creatures available to attack â€” press End Phase');
        return;
      }
      markAttackableCreatures((fullIndex) => {
        attackTarget(fullIndex, null, true);
      });
    }

    function handleAttackTarget(fullTargetIndex, isPlayer = false) {
      clearSelectionClasses();
      const myBattlefield = gameState.players[playerIndex].battlefield.filter((c) => c.type !== 'vigor');
      const myCreatures = myBattlefield.filter((c) =>
        (c.type === 'creature' || c.type === 'primordial') && (c.canAttack || c.hasHaste)
      );
      if (myCreatures.length === 0) {
        endSelection();
        showGameNotification('No creatures available to attack â€” press End Phase');
        return;
      }
      markAttackableCreatures((fullIndex) => {
        attackTarget(fullIndex, fullTargetIndex, isPlayer);
      });
    }

    async function attackTarget(attackerIndex, targetIndex, targetPlayer) {
      await doAction('/attack', { attackerIndex, targetIndex, targetPlayer: targetPlayer === true });
    }

    function renderCards(cards, container, isDraggable = false, isFaceDown = false, isOpponent = false) {
      container.innerHTML = '';
      cards.forEach((card, index) => {
        container.appendChild(createCardElement(card, false, isDraggable, index, isOpponent));
      });
    }

    function createCardElement(card, isFaceDown, isDraggable, index, isOpponent = false) {
      const cardEl = document.createElement('div');
      cardEl.className = 'card';
      cardEl.dataset.index = index;
      if (card.type) cardEl.classList.add(`card-${card.type}`);

      if ((card.type === 'creature' || card.type === 'primordial') && !isOpponent) {
        if (!card.canAttack && !card.hasHaste) cardEl.classList.add('cannot-attack');
      }

      if (isFaceDown) {
        cardEl.classList.add('face-down');
        return cardEl;
      }

      if (isDraggable) cardEl.addEventListener('click', () => handleCardClick(index));

      if (isOpponent && gameState && gameState.phase === 'attack' && gameState.currentTurn === playerIndex) {
        cardEl.classList.add('attackable');
        cardEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const opp = gameState.players[1 - playerIndex];
          const oppVisible = opp.battlefield.filter((c) => c.type !== 'vigor');
          const cardData = oppVisible[index];
          const fullTargetIndex = opp.battlefield.indexOf(cardData);
          beginSelection(() => handleAttackTarget(fullTargetIndex, false));
        });
      }

      const esc = (s) => String(s ?? '');
      let cardContent = '';

      if (card.type === 'vigor') {
        cardContent = `
          <div class="card-cost">0</div>
          <div class="card-name">${esc(card.name)}</div>
          <div class="card-image vigor-icon"><span style="font-size: 3em;">ðŸ’Ž</span></div>
          <div class="card-description">+1 Vigor per round</div>`;
      } else if (card.type === 'primordial') {
        cardContent = `
          <div class="card-cost">${esc(card.cost)}</div>
          <div class="card-name primordial-name">${esc(card.name)}</div>
          <div class="card-image"><span style="font-size: 3em;">ðŸ‘‘</span></div>
          <div class="card-stats">
            <span class="card-attack">âš”${esc(card.attack)}</span>
            <span class="card-defense">ðŸ›¡${esc(card.defense)}</span>
          </div>
          <div class="card-primordial-indicator">ðŸ‘‘ KING</div>`;
      } else if (card.type === 'rune') {
        cardContent = `
          <div class="card-cost">${esc(card.cost)}</div>
          <div class="card-name">${esc(card.name)}</div>
          <div class="card-image rune-icon"><span style="font-size: 3em;">âœ¨</span></div>
          <div class="card-description">One-time use</div>`;
      } else if (card.type === 'equipment') {
        cardContent = `
          <div class="card-cost">${esc(card.cost)}</div>
          <div class="card-name">${esc(card.name)}</div>
          <div class="card-image equipment-icon"><span style="font-size: 3em;">âš”ï¸</span></div>
          <div class="card-stats">
            <span class="card-attack">+${esc(card.attack)}</span>
            <span class="card-defense">+${esc(card.defense)}</span>
          </div>
          <div class="card-description">Attach to creature</div>`;
      } else {
        cardContent = `
          <div class="card-cost">${esc(card.cost)}</div>
          <div class="card-name">${esc(card.name)}</div>
          <div class="card-image"><span style="font-size: 3em;">âš”ï¸</span></div>
          <div class="card-stats">
            <span class="card-attack">âš”${esc(card.attack)}</span>
            <span class="card-defense">ðŸ›¡${esc(card.defense)}</span>
          </div>`;
      }

      cardEl.innerHTML = cardContent;
      return cardEl;
    }

    // ---- card interactions ------------------------------------------------

    async function handleCardClick(index) {
      if (!gameState || gameState.currentTurn !== playerIndex || gameState.status === 'completed') return;
      const card = gameState.players[playerIndex].hand[index];
      if (!card) return;
      if (card.type === 'rune' || card.type === 'vigor') {
        await playCard(index);
      } else if (card.type === 'equipment') {
        showEquipmentAttachmentOptions(index, card);
      } else {
        showPlayOptions(index, card);
      }
    }

    function showEquipmentAttachmentOptions(equipmentIndex, equipment) {
      const myBattlefield = gameState.players[playerIndex].battlefield.filter((c) => c.type !== 'vigor');
      const creatures = myBattlefield.filter((c) => c.type === 'creature' || c.type === 'primordial');
      if (creatures.length === 0) {
        showGameNotification('No creatures to attach equipment to');
        return;
      }
      const modal = document.createElement('div');
      modal.className = 'play-options-modal';
      const content = document.createElement('div');
      content.className = 'modal-content';
      const h3 = document.createElement('h3');
      h3.textContent = `Attach ${equipment.name}`;
      const p = document.createElement('p');
      p.textContent = 'Select a creature to attach this equipment to:';
      const sel = document.createElement('div');
      sel.className = 'creature-selection';
      const cancel = document.createElement('button');
      cancel.id = 'cancel-attach';
      cancel.textContent = 'Cancel';
      content.appendChild(h3); content.appendChild(p); content.appendChild(sel); content.appendChild(cancel);
      modal.appendChild(content);
      document.body.appendChild(modal);

      creatures.forEach((creature) => {
        const btn = document.createElement('button');
        btn.className = 'creature-select-btn';
        btn.textContent = `${creature.name} (âš”${creature.attack} ðŸ›¡${creature.defense})`;
        btn.addEventListener('click', async () => {
          const currentBattlefield = gameState.players[playerIndex].battlefield;
          const fullCreatureIndex = currentBattlefield.indexOf(creature);
          modal.remove();
          if (fullCreatureIndex === -1) {
            showGameNotification('Creature not found on battlefield');
            return;
          }
          await doAction('/attach-equipment', {
            equipmentIndex,
            targetCreatureIndex: fullCreatureIndex,
          });
        });
        sel.appendChild(btn);
      });

      cancel.addEventListener('click', () => modal.remove());
    }

    function showPlayOptions(cardIndex, card) {
      const modal = document.createElement('div');
      modal.className = 'play-options-modal';
      const content = document.createElement('div');
      content.className = 'modal-content';
      const h3 = document.createElement('h3');
      h3.textContent = `Play ${card.name}`;
      const p = document.createElement('p');
      p.textContent = 'Where do you want to play this card?';
      const playBtn = document.createElement('button');
      playBtn.id = 'play-to-battlefield';
      playBtn.textContent = 'Play to Battlefield';
      const cancel = document.createElement('button');
      cancel.id = 'cancel-play';
      cancel.textContent = 'Cancel';
      content.appendChild(h3); content.appendChild(p); content.appendChild(playBtn); content.appendChild(cancel);
      modal.appendChild(content);
      document.body.appendChild(modal);
      playBtn.addEventListener('click', async () => {
        modal.remove();
        await playCard(cardIndex);
      });
      cancel.addEventListener('click', () => modal.remove());
    }

    async function playCard(cardIndex) {
      await doAction('/play-card', { cardIndex });
    }

    // ---- game over -----------------------------------------------------------

    function handleGameOver(data) {
      if (gameOverHandled) return;
      gameOverHandled = true;
      stopAllPolling();
      endSelection();
      clearGameRef();

      const gs = data.gameState || gameState;
      const won = gs && gs.winner === playerId;
      const resultText = gs && gs.result ? String(gs.result).replace(/_/g, ' ') : 'match over';
      const rewards = data.rewards || null;
      const levelsGained = data.levelsGained || [];

      const details = [];
      if (rewards) {
        details.push(`XP earned: +${rewards.xp}`);
        details.push(`Coins earned: +${rewards.coins}`);
        if (levelsGained.length) details.push(`Level up! You are now level ${levelsGained[levelsGained.length - 1]}`);
      } else if (gs && gs.winner) {
        details.push('No rewards recorded for this match.');
      }

      showResultOverlay({
        title: won ? 'Victory!' : (gs && gs.winner ? 'Defeat' : 'Match Over'),
        subtitle: `Result: ${resultText}`,
        details,
        buttons: [
          {
            label: 'Return to Lobby',
            onClick: () => {
              gameId = null;
              gameState = null;
              gameOverHandled = false;
              showLobby();
              lobbyStatus.textContent = '';
              joinLobbyBtn.style.display = '';
              playerNameInput.disabled = false;
              joinLobby();
            },
          },
          {
            label: 'Main Menu',
            onClick: () => { window.location.href = 'index.html'; },
          },
        ],
      });
    }

    async function surrender() {
      if (surrendering || !gameId || gameOverHandled) return;
      surrendering = true;
      await doAction('/surrender', {}, { silent: true });
      surrendering = false;
      if (!gameOverHandled) {
        // Server refused (maybe already finished) â€” refresh authoritative state.
        try {
          const data = await apiFetch(`/game-state/${gameId}`);
          if (data.success && data.gameState.status === 'completed') handleGameOver(data);
        } catch (e) { /* ignore */ }
      }
    }

    function confirmLeaveMidMatch() {
      if (!gameId || gameOverHandled) return true;
      // eslint-disable-next-line no-alert
      return window.confirm('Leave the match? Leaving counts as a surrender.');
    }

    // ---- event wiring ---------------------------------------------------------

    if (joinLobbyBtn) joinLobbyBtn.addEventListener('click', () => joinLobby().catch((e) => {
      lobbyStatus.textContent = e.message || 'Error connecting to server';
      lobbyStatus.style.color = 'red';
    }));

    phaseIndicator.addEventListener('click', () => {
      if (gameState && gameState.currentTurn === playerIndex && !endPhaseBtnSide.disabled) {
        doAction('/advance-phase', {});
      }
    });

    autoPlayVigorBtnSide.addEventListener('click', () => {
      if (autoPlayVigorBtnSide.disabled) return;
      doAction('/auto-play-vigor', {});
    });

    endPhaseBtnSide.addEventListener('click', () => {
      if (endPhaseBtnSide.disabled) return;
      doAction('/advance-phase', {});
    });

    drawCardBtnSide.addEventListener('click', () => {
      if (drawCardBtnSide.disabled) return;
      doAction('/draw-card', {});
    });

    if (surrenderBtnSide) surrenderBtnSide.addEventListener('click', () => {
      if (window.confirm('Surrender this match?')) surrender();
    });

    menuToggleBtn.addEventListener('click', () => sideMenu.classList.toggle('open'));

    quitBtnSide.addEventListener('click', () => {
      if (confirmLeaveMidMatch()) {
        const go = () => { window.location.href = 'https://www.kloakndaggurrs.com'; };
        if (gameId && !gameOverHandled) { surrender().then(go).catch(go); } else { go(); }
      }
    });

    menuBtnSide.addEventListener('click', () => {
      if (confirmLeaveMidMatch()) {
        const go = () => { window.location.href = 'index.html'; };
        if (gameId && !gameOverHandled) { surrender().then(go).catch(go); } else { go(); }
      }
    });

    leaveGameX.addEventListener('click', () => {
      if (confirmLeaveMidMatch()) {
        const go = () => {
          stopAllPolling();
          clearGameRef();
          gameId = null;
          gameState = null;
          gameOverHandled = false;
          showLobby();
          lobbyStatus.textContent = '';
          joinLobbyBtn.style.display = '';
          playerNameInput.disabled = false;
        };
        if (gameId && !gameOverHandled) { surrender().then(go).catch(go); } else { go(); }
      }
    });

    handToggleBtn.addEventListener('click', toggleHandExpansion);
    handToggleOverlay.addEventListener('click', toggleHandExpansion);
    clickOutsideDetector.addEventListener('click', toggleHandExpansion);

    function toggleHandExpansion() {
      isHandExpanded = !isHandExpanded;
      if (isHandExpanded) {
        handOverlay.classList.add('active');
        handToggleBtn.textContent = 'âˆ’';
        clickOutsideDetector.classList.add('active');
      } else {
        handOverlay.classList.remove('active');
        handToggleBtn.textContent = 'Hand';
        clickOutsideDetector.classList.remove('active');
      }
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'd' || e.key === 'D') {
        if (!drawCardBtnSide.disabled) drawCardBtnSide.click();
      } else if (e.key === ' ') {
        e.preventDefault();
        if (!endPhaseBtnSide.disabled) endPhaseBtnSide.click();
      } else if (e.key === 'Escape') {
        if (isHandExpanded) toggleHandExpansion();
        // Escape no longer abandons the match â€” use the menu's Surrender button.
      }
    });

    // ---- boot: refresh/reconnect rejoin --------------------------------------

    (async function boot() {
      const session = await window.GameAuth.getSession().catch(() => null);
      if (!session || !session.user) {
        lobbyStatus.textContent = 'Please log in on the main website first, then return.';
        lobbyStatus.style.color = 'red';
        return;
      }
      playerId = session.user.id;
      const saved = readGameRef();
      if (saved && saved.gameId) {
        gameId = saved.gameId;
        playerIndex = saved.playerIndex;
        await rejoinGame();
        if (gameId) return;
      }
      // No match to rejoin â€” prefill the name and wait for the player.
      const defaultName = session.user.user_metadata?.display_name || session.user.email?.split('@')[0] || 'Player';
      if (playerNameInput && !playerNameInput.value) playerNameInput.value = defaultName;
    })();
  }

  /* =====================================================================
   * Local AI mode
   * ===================================================================== */
  window.handleCardImageError = function (img, color, emoji, centered) {
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

  function handleCardImageError(img, color, emoji, centered) {
    window.handleCardImageError(img, color, emoji, centered);
  }

  function normalizeCardType(rawType) {
    if (!rawType) return rawType;
    const lower = rawType.toLowerCase();
    const knownTypes = ['primordial', 'vigor', 'rune', 'equipment', 'creature'];
    const match = knownTypes.find((type) => lower.includes(type));
    return match || lower.replace(/\s+/g, '-');
  }

  /** Map every stored difficulty label to one of the three real profiles. */
  function normalizeDifficulty(raw) {
    const d = String(raw || '').toLowerCase();
    if (d === 'easy') return 'easy';
    if (d === 'medium' || d === 'normal') return 'medium';
    if (d === 'hard' || d === 'expert') return 'hard';
    return 'medium';
  }

  // Local AI-mode game rules live in ai-game.js (shared with the Node test
  // suite). Combat mirrors the authoritative multiplayer engine.
  const { GameState, CardGenerator } = window.KDAiGame;

  function initAI() {
    const isTestMode = MODE === 'test';
    const gameState = new GameState();
    const difficulty = isTestMode ? 'easy' : normalizeDifficulty(sessionStorage.getItem('aiDifficulty'));
    gameState.setDifficulty(difficulty);

    // Server deck cards use `cost`; the local engine uses `manaCost`.
    const storedDeck = sessionStorage.getItem('selectedDeck');
    if (storedDeck) {
      try {
        const deckData = JSON.parse(storedDeck);
        gameState.player.deck = deckData.cards.map((card) => ({
          ...card,
          type: normalizeCardType(card.type),
          manaCost: Math.min(15, parseInt(card.manaCost ?? card.cost ?? 0, 10) || 0),
        }));
        if (!gameState.player.deck.some((c) => c.type === 'primordial')) {
          gameState.player.deck.push(CardGenerator.generateCard('primordial'));
        }
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

    // AI result reporting (server-validated rewards).
    let aiMatchId = null;
    let rewardsEnabled = false;

    async function startAiMatch() {
      if (isTestMode) return; // test mode: no rewards
      try {
        const session = await window.GameAuth.getSession();
        if (!session || !session.user) return; // not logged in: play for fun
        const data = await apiFetch('/ai/start', {
          method: 'POST',
          body: JSON.stringify({ difficulty }),
        });
        if (data.success) {
          aiMatchId = data.aiMatchId;
          rewardsEnabled = true;
        } else {
          console.warn('AI match not started:', data.error);
          window.kdAiGateMessage = data.error || 'AI rewards unavailable';
        }
      } catch (e) {
        window.kdAiGateMessage = 'Sign in to earn XP and coins from AI battles.';
      }
    }

    async function reportAiResult(won) {
      if (!aiMatchId || !rewardsEnabled) {
        if (won && window.kdAiGateMessage && !isTestMode) {
          showResultNote(window.kdAiGateMessage);
        }
        return;
      }
      try {
        const data = await apiFetch('/ai/result', {
          method: 'POST',
          body: JSON.stringify({ aiMatchId, won }),
        });
        if (data.success && data.rewards) {
          showResultNote(`Rewards: +${data.rewards.xp} XP, +${data.rewards.coins} coins${data.levelsGained && data.levelsGained.length ? ` â€” Level ${data.levelsGained[data.levelsGained.length - 1]}!` : ''}`);
        } else if (data.success && data.capped) {
          showResultNote('Daily AI reward limit reached â€” no rewards for this match.');
        } else if (!data.success) {
          console.warn('AI result rejected:', data.error);
        }
      } catch (e) {
        console.warn('AI result report failed:', e);
      }
    }

    function showResultNote(note) {
      const noteEl = document.createElement('div');
      noteEl.textContent = note;
      noteEl.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#2a2338;color:#f0e6d2;border:1px solid #c9a86a;border-radius:8px;padding:10px 18px;z-index:9998';
      document.body.appendChild(noteEl);
      setTimeout(() => noteEl.remove(), 6000);
    }

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
    let resultShown = false;
    let selectedAttacker = null; // active attacker during the player's attack phase

    function toggleHand() {
      isHandExpanded = !isHandExpanded;
      if (isHandExpanded) {
        els.handOverlay.classList.add('active');
        els.handToggleBtn.textContent = 'âˆ’';
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
        html = `<div class="card-cost">0</div><div class="card-name">${card.name}</div><div class="card-image vigor-icon"><span style="font-size:3em">ðŸ’Ž</span></div><div class="card-description">+1 Vigor per round</div>`;
      } else if (card.type === 'primordial') {
        html = `<div class="card-cost">${cost}</div><div class="card-name primordial-name">${card.name}</div><div class="card-image"><span style="font-size:3em">ðŸ‘‘</span></div><div class="card-stats"><span class="card-attack">âš”${attack}</span><span class="card-defense">ðŸ›¡${defense}</span></div><div class="card-primordial-indicator">ðŸ‘‘</div>`;
      } else if (card.type === 'rune') {
        html = `<div class="card-cost">${cost}</div><div class="card-name">${card.name}</div><div class="card-image rune-icon"><span style="font-size:3em">âœ¨</span></div><div class="card-description">One-time use</div>`;
      } else if (card.type === 'equipment') {
        html = `<div class="card-cost">${cost}</div><div class="card-name">${card.name}</div><div class="card-image equipment-icon"><span style="font-size:3em">âš”ï¸</span></div><div class="card-stats"><span class="card-attack">+${attack}</span><span class="card-defense">+${defense}</span></div><div class="card-description">Attach to creature</div>`;
      } else {
        html = `<div class="card-cost">${cost}</div><div class="card-name">${card.name}</div><div class="card-image"><span style="font-size:3em">âš”ï¸</span></div><div class="card-stats"><span class="card-attack">âš”${attack}</span><span class="card-defense">ðŸ›¡${defense}</span></div>`;
      }
      cardEl.innerHTML = html;

      if (isDraggable) {
        cardEl.addEventListener('click', () => {
          if (!gameState.isPlayerTurn || gameState.gameOver) return;
          if (card.type === 'vigor' || card.type === 'rune') {
            if (gameState.playCard(gameState.player, card)) render();
            else showResultNote('Cannot play that card (not enough Vigor)');
          } else if (card.type === 'creature' || card.type === 'primordial') {
            if (gameState.playCard(gameState.player, card)) render();
            else showResultNote('Cannot play that card (Vigor or space)');
          } else if (card.type === 'equipment') {
            const target = gameState.player.battlefield.find((c) => c.type === 'creature' || c.type === 'primordial');
            if (!target) { showResultNote('No creature to equip'); return; }
            if (gameState.playCard(gameState.player, card, null, target)) render();
            else showResultNote('Cannot attach equipment');
          }
          checkAIOver();
        });
      }
      return cardEl;
    }

    function handleAiGameOver() {
      if (resultShown) return;
      resultShown = true;
      const won = gameState.winner === gameState.player.name;
      reportAiResult(won);
      showResultOverlay({
        title: won ? 'Victory!' : 'Defeat',
        subtitle: `vs ${gameState.opponent.name} (${gameState.endReason || 'match over'})`,
        details: won
          ? ['Rewards will be added to your account.']
          : ['No rewards for a loss. Try again!'],
        buttons: [
          { label: 'Play Again', onClick: () => { window.location.reload(); } },
          { label: 'Main Menu', onClick: () => { window.location.href = 'index.html'; } },
        ],
      });
    }

    function checkAIOver() {
      if (gameState.gameOver) handleAiGameOver();
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
      els.turnIndicator.textContent = gameState.isPlayerTurn ? 'Your Turn' : `${gameState.opponent.name}'s Turn`;
      els.turnNumber.textContent = `Turn: ${gameState.turnNumber}`;
      els.currentPhase.textContent = (gameState.currentPhase || 'play').replace(/_/g, ' ');

      const myTurn = gameState.isPlayerTurn && !gameState.gameOver;
      els.drawCardBtnSide.disabled = !myTurn;
      els.autoPlayVigorBtnSide.disabled = !myTurn;
      els.endPhaseBtnSide.disabled = !myTurn;
      els.leftButtons.style.display = myTurn ? 'flex' : 'none';
      els.rightButtons.style.display = myTurn ? 'flex' : 'none';

      els.handOverlayCards.innerHTML = '';
      gameState.player.hand.forEach((card) => {
        els.handOverlayCards.appendChild(createCardElement(card, myTurn));
      });

      els.playerBattlefield.innerHTML = '';
      gameState.player.battlefield.filter((c) => c.type !== 'vigor').forEach((card) => {
        els.playerBattlefield.appendChild(createCardElement(card, false));
      });

      els.opponentBattlefield.innerHTML = '';
      gameState.opponent.battlefield.filter((c) => c.type !== 'vigor').forEach((card) => {
        els.opponentBattlefield.appendChild(createCardElement(card, false));
      });

      // Player attack phase: select an attacker, then a legal target.
      wirePlayerAttackPhase();

      if (gameState.gameOver) {
        els.gameNotification.textContent = `${gameState.winner} wins!`;
        els.gameNotification.classList.add('show');
      }
    }

    function endPlayerActions() {
      if (!gameState.isPlayerTurn || gameState.gameOver) return;
      if (gameState.currentPhase === 'play_cards') {
        // Play phase over -> the human player's attack phase (was missing:
        // End Phase used to skip the player's attacks entirely).
        gameState.currentPhase = 'attack';
        gameState.beginPlayerAttackPhase();
        selectedAttacker = null;
        render();
        return;
      }
      selectedAttacker = null;
      gameState.endTurn();
      render();
      checkAIOver();
      if (!gameState.isPlayerTurn && !gameState.gameOver) {
        setTimeout(() => {
          render();
          const check = setInterval(() => {
            render();
            checkAIOver();
            if (gameState.isPlayerTurn || gameState.gameOver) clearInterval(check);
          }, 500);
        }, 200);
      }
    }

    /** Attack-phase UI: pick one of your units, then pick a legal target. */
    function wirePlayerAttackPhase() {
      if (gameState.currentPhase !== 'attack' || !gameState.isPlayerTurn || gameState.gameOver) return;
      const myVisible = gameState.player.battlefield.filter((c) => c.type !== 'vigor');
      els.playerBattlefield.querySelectorAll('.card').forEach((el, index) => {
        const card = myVisible[index];
        if (!card || (card.type !== 'creature' && card.type !== 'primordial')) return;
        if (!gameState.canPlayerAttackWith(card)) {
          el.classList.add('cannot-attack');
          return;
        }
        el.classList.add('selectable');
        if (card === selectedAttacker) el.classList.add('selected');
        el.addEventListener('click', () => { selectedAttacker = card; render(); });
      });
      if (!selectedAttacker) return;

      const targets = gameState.legalPlayerTargets(gameState.opponent);
      if (targets.creatures.length > 0) {
        const oppVisible = gameState.opponent.battlefield.filter((c) => c.type !== 'vigor');
        els.opponentBattlefield.querySelectorAll('.card').forEach((el, index) => {
          const card = oppVisible[index];
          if (!card || !targets.creatures.includes(card)) return;
          el.classList.add('attackable');
          el.addEventListener('click', () => resolvePlayerAttack(card));
        });
      } else if (targets.canAttackPlayer) {
        addAiAttackPlayerButton();
      }
    }

    function addAiAttackPlayerButton() {
      const existing = document.getElementById('ai-attack-player-btn');
      if (existing) return;
      const btn = document.createElement('button');
      btn.id = 'ai-attack-player-btn';
      btn.className = 'attack-player-btn';
      btn.textContent = 'Attack Player';
      btn.addEventListener('click', () => resolvePlayerAttack(null));
      els.opponentBattlefield.appendChild(btn);
    }

    function resolvePlayerAttack(targetCard) {
      const attacker = selectedAttacker;
      selectedAttacker = null;
      if (!attacker || gameState.gameOver) { render(); return; }
      // Combat rules + resolution live in ai-game.js (unit-tested); the UI
      // only forwards the intent.
      const ok = gameState.playerAttack(attacker, targetCard);
      if (!ok) showResultNote('That attack is not allowed');
      render();
      checkAIOver();
    }

    gameState.onTurnEnd = () => { render(); checkAIOver(); };

    els.drawCardBtnSide.addEventListener('click', () => {
      if (!gameState.isPlayerTurn || gameState.gameOver) return;
      gameState.drawCard(gameState.player);
      render();
      checkAIOver();
    });
    els.autoPlayVigorBtnSide.addEventListener('click', () => {
      if (!gameState.isPlayerTurn || gameState.gameOver) return;
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
      if (e.key === 'd' || e.key === 'D') { if (!els.drawCardBtnSide.disabled) els.drawCardBtnSide.click(); }
      else if (e.key === ' ') { e.preventDefault(); if (!els.endPhaseBtnSide.disabled) els.endPhaseBtnSide.click(); }
      else if (e.key === 'Escape') { if (isHandExpanded) toggleHand(); }
    });

    startAiMatch();
    gameState.runPlayerTurn(gameState.player, gameState.opponent);
    render();
    console.log(`AI battlefield ready â€” difficulty: ${difficulty}`);
  }

})();
