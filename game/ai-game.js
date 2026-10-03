/**
 * Kloak 'n' Daggurrs — local AI-battle game rules (shared by the browser
 * battlefield and the Node test suite).
 *
 * Extracted verbatim from battlefield.js so the human player's combat rules
 * are unit-testable outside the DOM. The combat math (simultaneous damage,
 * deaths applied after both sides, primordial-death defeat) mirrors the
 * authoritative multiplayer engine in lib/game-engine.js.
 *
 * Loaded in the browser via <script> before battlefield.js; in Node it is
 * required directly by the automated regression tests.
 */
(function (global) {
  'use strict';

  // Difficulty actually changes AI behavior:
  //   easy   — misses attacks, plays at most one card, picks random targets
  //   medium — usually attacks, plays a creature/equipment/rune, random targets
  //   hard   — attacks whenever legal, plays every affordable card, makes
  //            favorable trades (kills the most dangerous creature it can)
  const AI_PROFILES = {
    easy: { attackChance: 0.35, playAll: false, smart: false },
    medium: { attackChance: 0.7, playAll: false, smart: false },
    hard: { attackChance: 0.95, playAll: true, smart: true },
  };

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
        graveyard: [],
      };

      this.opponent = {
        name: 'Opponent',
        life: 30,
        mana: 0,
        hand: [],
        battlefield: [],
        deck: [],
        primordial: null,
        graveyard: [],
      };

      this.turnNumber = 1;
      this.isPlayerTurn = true;
      this.selectedCard = null;
      this.draggedCard = null;
      this.gameOver = false;
      this.winner = null;
      this.selectedCreature = null;
      this.currentPhase = 'vigor_reset';
      this.isTwoPlayer = false;
      this.difficulty = 'medium';
      this.profile = AI_PROFILES.medium;
      this.player.attacked = new Set();
    }

    setDifficulty(d) {
      this.difficulty = d;
      this.profile = AI_PROFILES[d] || AI_PROFILES.medium;
      this.opponent.name = `${d.charAt(0).toUpperCase()}${d.slice(1)} AI`;
    }

    calculateMana(player) {
      const vigorCards = player.battlefield.filter((card) => card.type === 'vigor');
      return Math.min(20, vigorCards.length); // max Vigor/mana is 20
    }

    vigorReset(player) {
      player.mana = this.calculateMana(player);
    }

    drawCard(player) {
      if (player.hand.length < 10) {
        if (player.deck.length === 0) {
          // Deck-out: cannot draw = loss (established rule)
          this.gameOver = true;
          this.winner = player === this.player ? this.opponent.name : this.player.name;
          this.endReason = 'deckout';
          return null;
        }
        const card = player.deck.pop();

        if (card.type === 'primordial') {
          player.primordial = card;
          player.battlefield.push(card);
          return card;
        }

        player.hand.push(card);
        return card;
      }
      return null;
    }

    playCard(player, card, targetZone, targetCard = null) {
      if (!player.hand.includes(card)) return false;

      if (card.type === 'primordial') return false;

      if (card.type === 'vigor') {
        if (player.battlefield.length < 7) {
          player.hand = player.hand.filter((c) => c !== card);
          player.battlefield.push(card);
          return true;
        }
        return false;
      }

      if (card.type === 'rune') {
        if (card.manaCost <= player.mana) {
          player.mana -= card.manaCost;
          player.hand = player.hand.filter((c) => c !== card);
          this.castSpell(player, card);
          player.graveyard.push(card);
          return true;
        }
        return false;
      }

      if (card.type === 'equipment') {
        if (card.manaCost <= player.mana && targetCard && (targetCard.type === 'creature' || targetCard.type === 'primordial')) {
          player.mana -= card.manaCost;
          player.hand = player.hand.filter((c) => c !== card);
          targetCard.attachedEquipment = card;
          targetCard.attack += card.attack || 0;
          targetCard.defense += card.defense || 0;
          return true;
        }
        return false;
      }

      if (card.type === 'creature') {
        const creatures = player.battlefield.filter((c) => c.type === 'creature').length;
        if (creatures < 5 && card.manaCost <= player.mana) {
          player.mana -= card.manaCost;
          player.hand = player.hand.filter((c) => c !== card);
          player.battlefield.push(card);
          return true;
        }
        return false;
      }

      return false;
    }

    castSpell(player, spell) {
      const damage = Math.floor(Math.random() * 5) + 3;
      if (player === this.player) {
        this.opponent.life -= damage;
      } else {
        this.player.life -= damage;
      }
      this.checkWinCondition();
    }

    attackCreature(attacker, defender, attackerPlayer, defenderPlayer) {
      if (!attacker || !defender || (attacker.type !== 'creature' && attacker.type !== 'primordial')) return false;
      if (!attackerPlayer.battlefield.includes(attacker)) return false; // attacker died earlier this phase

      // Simultaneous combat damage from pre-combat values; resolution always
      // completes even if one or both units die.
      const attackerAttack = attacker.attack || 0;
      const defenderAttack = defender.attack || 0;
      defender.defense -= attackerAttack;
      attacker.defense -= defenderAttack;

      if (defender.defense <= 0) {
        defenderPlayer.battlefield = defenderPlayer.battlefield.filter((c) => c !== defender);
        defenderPlayer.graveyard.push(defender);
      }

      if (attacker.defense <= 0) {
        attackerPlayer.battlefield = attackerPlayer.battlefield.filter((c) => c !== attacker);
        attackerPlayer.graveyard.push(attacker);
      }

      this.checkWinCondition();
      return true;
    }

    attackPlayer(attacker, defenderPlayer, attackerPlayer) {
      if (!attacker || (attacker.type !== 'creature' && attacker.type !== 'primordial')) return false;
      if (!attackerPlayer.battlefield.includes(attacker)) return false;

      defenderPlayer.life -= attacker.attack || 0;
      this.checkWinCondition();
      return true;
    }

    /**
     * Human player's attack phase: reset the per-phase "already attacked"
     * tracking (each unit attacks at most once per attack phase, mirroring
     * the authoritative multiplayer engine).
     */
    beginPlayerAttackPhase() {
      this.player.attacked = new Set();
    }

    /** True when the human player may attack with this unit this phase. */
    canPlayerAttackWith(card) {
      return !!card
        && (card.type === 'creature' || card.type === 'primordial')
        && this.player.battlefield.includes(card)
        && !this.player.attacked.has(card);
    }

    /**
     * Legal player targets per the established combat rules (identical to the
     * authoritative engine): Primordial first, then creatures, then the
     * player directly.
     */
    legalPlayerTargets(defenderPlayer) {
      const primordial = defenderPlayer.battlefield.find((c) => c.type === 'primordial');
      if (primordial) return { creatures: [primordial], canAttackPlayer: false };
      const creatures = defenderPlayer.battlefield.filter((c) => c.type === 'creature');
      if (creatures.length) return { creatures, canAttackPlayer: false };
      return { creatures: [], canAttackPlayer: true };
    }

    /** Resolve one human attack. target=null means a direct player attack. */
    playerAttack(attacker, target) {
      if (!this.canPlayerAttackWith(attacker)) return false;
      if (this.gameOver) return false;
      const targets = this.legalPlayerTargets(this.opponent);
      if (target) {
        if (!targets.creatures.includes(target)) return false; // priority rules
        this.player.attacked.add(attacker);
        return this.attackCreature(attacker, target, this.player, this.opponent);
      }
      if (!targets.canAttackPlayer) return false; // blockers must be cleared first
      this.player.attacked.add(attacker);
      return this.attackPlayer(attacker, this.opponent, this.player);
    }

    checkWinCondition() {
      if (this.gameOver) return;
      if (this.player.primordial && !this.player.battlefield.includes(this.player.primordial)) {
        this.gameOver = true;
        this.winner = this.opponent.name;
        this.endReason = 'primordial';
      }
      if (this.opponent.primordial && !this.opponent.battlefield.includes(this.opponent.primordial)) {
        this.gameOver = true;
        this.winner = this.player.name;
        this.endReason = 'primordial';
      }
      if (this.player.life <= 0) {
        this.gameOver = true;
        this.winner = this.opponent.name;
        this.endReason = 'lifeloss';
      }
      if (this.opponent.life <= 0) {
        this.gameOver = true;
        this.winner = this.player.name;
        this.endReason = 'lifeloss';
      }
    }

    endTurn() {
      if (this.gameOver) return;

      this.isPlayerTurn = !this.isPlayerTurn;

      if (this.isPlayerTurn) {
        this.turnNumber++;
        this.runPlayerTurn(this.player, this.opponent);
      } else {
        this.runOpponentTurn(this.opponent, this.player);
      }
    }

    runPlayerTurn(player, opponent) {
      this.currentPhase = 'vigor_reset';
      this.vigorReset(player);

      this.currentPhase = 'draw';
      this.drawCard(player);

      this.currentPhase = 'play_vigor';
      this.autoPlayVigor(player);

      this.currentPhase = 'play_cards';
      this.checkWinCondition();
      if (this.gameOver) this.onGameOver && this.onGameOver();
    }

    runOpponentTurn(player, opponent) {
      if (this.isTwoPlayer) {
        this.vigorReset(player);
        this.drawCard(player);
        this.autoPlayVigor(player);
        this.currentPhase = 'play_cards';
        return;
      }

      this.currentPhase = 'vigor_reset';
      this.vigorReset(player);

      this.currentPhase = 'draw';
      this.drawCard(player);
      if (this.gameOver) { this.onGameOver && this.onGameOver(); return; }

      this.currentPhase = 'play_vigor';
      this.autoPlayVigor(player);

      this.currentPhase = 'play_cards';
      this.aiPlayCards(player);

      this.currentPhase = 'attack';
      this.aiAttack(player, opponent);

      this.currentPhase = 'end';
      setTimeout(() => {
        this.endTurn();
        this.onTurnEnd && this.onTurnEnd();
      }, 1200);
    }

    autoPlayVigor(player) {
      const vigorCards = player.hand.filter((card) => card.type === 'vigor');
      vigorCards.forEach((card) => {
        if (player.battlefield.length < 7) {
          this.playCard(player, card);
        }
      });
    }

    aiPlayCards(player) {
      const profile = this.profile;
      const affordable = (list) => list.filter((c) => c.manaCost <= player.mana);

      // Play creatures — hard plays everything it can afford (strongest first).
      let creatures = affordable(player.hand.filter((c) => c.type === 'creature'));
      if (profile.smart) {
        creatures = creatures.sort((a, b) => (b.attack + b.defense) - (a.attack + a.defense));
      }
      const creatureBudget = profile.playAll ? creatures.length : Math.min(1, creatures.length);
      for (let i = 0; i < creatureBudget; i++) {
        const c = creatures[i];
        if (player.battlefield.filter((x) => x.type === 'creature').length >= 5) break;
        this.playCard(player, c);
      }

      // Equipment: attach to the strongest own unit.
      const equipment = affordable(player.hand.filter((c) => c.type === 'equipment'));
      const equipBudget = profile.playAll ? equipment.length : Math.min(1, equipment.length);
      for (let i = 0; i < equipBudget; i++) {
        const targets = player.battlefield.filter((c) => c.type === 'creature' || c.type === 'primordial');
        if (!targets.length) break;
        const target = profile.smart
          ? targets.sort((a, b) => (b.attack + b.defense) - (a.attack + a.defense))[0]
          : targets[Math.floor(Math.random() * targets.length)];
        this.playCard(player, equipment[i], null, target);
      }

      // Runes: hard holds them until the player is low; others cast when able.
      const spells = affordable(player.hand.filter((c) => c.type === 'rune'));
      const spellBudget = profile.playAll ? spells.length : Math.min(1, spells.length);
      for (let i = 0; i < spellBudget; i++) {
        if (profile.smart && this.player.life > 12 && Math.random() < 0.5) break; // save the kill spell
        this.playCard(player, spells[i]);
      }
    }

    aiAttack(attackerPlayer, defenderPlayer) {
      const profile = this.profile;
      // Snapshot, but verify each attacker is still alive before it swings —
      // an attacker that died earlier in the phase never attacks.
      const attackers = attackerPlayer.battlefield.filter(
        (c) => c.type === 'creature' || c.type === 'primordial'
      );

      for (const creature of attackers) {
        if (!attackerPlayer.battlefield.includes(creature)) continue; // died mid-phase
        if (Math.random() > profile.attackChance) continue;

        const targetCreatures = defenderPlayer.battlefield.filter(
          (c) => c.type === 'creature' || c.type === 'primordial'
        );

        if (targetCreatures.length === 0) {
          this.attackPlayer(creature, defenderPlayer, attackerPlayer);
          continue;
        }

        if (profile.smart) {
          // Prefer a clean kill (target dies, attacker survives); otherwise
          // trade into the most dangerous target; otherwise go for the trade.
          const kill = targetCreatures
            .filter((t) => (creature.attack || 0) >= (t.defense || 0) && (t.attack || 0) < (creature.defense || 0))
            .sort((a, b) => (b.attack || 0) - (a.attack || 0))[0];
          const target = kill || targetCreatures.sort((a, b) => (b.attack || 0) - (a.attack || 0))[0];
          this.attackCreature(creature, target, attackerPlayer, defenderPlayer);
        } else {
          const target = targetCreatures[Math.floor(Math.random() * targetCreatures.length)];
          if (Math.random() > 0.5) {
            this.attackCreature(creature, target, attackerPlayer, defenderPlayer);
          } else {
            this.attackPlayer(creature, defenderPlayer, attackerPlayer);
          }
        }
      }
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
      'Thetorr.png', 'Tirk.png', 'Zhaddimkk.png', 'Zhiddalk.png', 'Zhork.png', 'Zoran.png',
    ];

    static cardNames = [
      'Alarion', 'Aldariel', 'Anda', 'Brozurk', 'Brugoth',
      'Brukarr', 'Burr', 'Carirol', 'Chran', 'Chrevarr',
      'Cyrel', 'Darian', 'Dasrin', 'Elara', 'Lysandria',
      'Meidas', 'Miranni', 'Nalsi', 'Nigrock', 'Noggrurr',
      'Orananni', 'Perkin', 'Serahel', 'Seraphim', 'Seraphyne',
      'Shava', 'Stirralk', 'Stotrirk', 'Stuvrith', 'Tador',
      'Thetorr', 'Tirk', 'Zhaddimkk', 'Zhiddalk', 'Zhork', 'Zoran',
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
      { name: 'Tidal Wave', cost: 16, description: 'Attacks all 5 damage', effect: 'damage', value: 5 },
    ];

    static equipmentAbilities = [
      { name: 'Acrobatic Flourish', cost: 11, attack: 0, defense: 0, description: 'Precise dagger strike, 25 damage' },
      { name: 'Deadly Dagger', cost: 8, attack: 5, defense: 0, description: 'Quick strike, 15 damage' },
      { name: 'Shadow Cloak', cost: 6, attack: 0, defense: 3, description: 'Dodge attacks for 3 turns' },
      { name: 'Divine Shield', cost: 10, attack: 0, defense: 5, description: 'Block all damage for 1 turn' },
      { name: 'Vampiric Blade', cost: 12, attack: 3, defense: 0, description: 'Lifesteal on attack' },
      { name: 'Flame Shield', cost: 8, attack: 2, defense: 2, description: 'Fire damage to attackers' },
      { name: 'Frost Armor', cost: 9, attack: 0, defense: 4, description: 'Freeze attackers' },
    ];

    static creatureAbilities = [
      { name: 'Rapid Venom', cost: 10, type: 'damage', value: 2, description: 'Deals 2 damage to opponent' },
      { name: 'Temporal Warp', cost: 2, type: 'turn_creature', duration: 4, description: 'Turn opponent creatures for 4 rounds' },
      { name: 'Soul Drain', cost: 8, type: 'life_gain', value: 5, description: 'Drain life, restore 5 HP' },
      { name: 'Fire Strike', cost: 6, type: 'damage', value: 4, description: 'Fire attack, 4 damage' },
      { name: 'Ice Shield', cost: 4, type: 'damage', value: 3, description: 'Ice attack, 3 damage' },
      { name: 'Lightning Dash', cost: 7, type: 'damage', value: 5, description: 'Lightning attack, 5 damage' },
    ];

    static primordialAbilities = [
      { name: 'Twilight Offering', cost: 16, type: 'summon', tokenName: 'Shadow Wraith', attack: 5, defense: 5, description: 'Summon 5/5 Shadow Wraith with Lifesteal' },
      { name: 'Soul Reclaim', cost: 16, type: 'draw', value: 1, description: 'Draw 1 card from graveyard' },
      { name: 'Divine Wrath', cost: 20, type: 'damage', value: 10, description: 'Deal 10 damage to all enemies' },
      { name: 'Eternal Guard', cost: 12, type: 'life_gain', value: 10, description: 'Restore 10 life' },
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
        primordial: '#ffd700',
        vigor: '#4ecdc4',
        creature: '#ff6b6b',
        rune: '#a8e6cf',
        equipment: '#c7ceea',
      };

      const color = colors[type] || '#ff6b6b';

      const card = {
        id: Date.now() + Math.random(),
        name: cardName,
        type,
        color,
        image: `/cards/${cardImage}`,
        isPrimordial: type === 'primordial',
        attachedEquipment: null,
        abilities: [],
      };

      switch (type) {
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
          if (Math.random() > 0.5) {
            card.abilities = [this.creatureAbilities[Math.floor(Math.random() * this.creatureAbilities.length)]];
          }
          card.description = card.abilities.length > 0 ? card.abilities[0].description : `Creature - ${card.attack}/${card.defense}`;
          break;
        case 'rune': {
          const runeAbility = this.runeAbilities[Math.floor(Math.random() * this.runeAbilities.length)];
          card.manaCost = runeAbility.cost;
          card.attack = 0;
          card.defense = 0;
          card.abilities = [runeAbility];
          card.description = runeAbility.description;
          card.isOneTimeUse = true;
          break;
        }
        case 'equipment': {
          const equipAbility = this.equipmentAbilities[Math.floor(Math.random() * this.equipmentAbilities.length)];
          card.manaCost = equipAbility.cost;
          card.attack = equipAbility.attack;
          card.defense = equipAbility.defense;
          card.abilities = [equipAbility];
          card.description = equipAbility.description;
          break;
        }
        default:
          card.manaCost = 0;
      }

      return card;
    }

    static generateDeck() {
      const deck = [];
      deck.push(this.generateCard('primordial'));
      for (let i = 0; i < 20; i++) deck.push(this.generateCard('vigor'));
      for (let i = 0; i < 24; i++) deck.push(this.generateCard('creature'));
      for (let i = 0; i < 8; i++) deck.push(this.generateCard('rune'));
      for (let i = 0; i < 7; i++) deck.push(this.generateCard('equipment'));
      deck.sort(() => Math.random() - 0.5);
      return deck;
    }
  }

  const KD_AI = { GameState, CardGenerator, AI_PROFILES };
  if (typeof module !== 'undefined' && module.exports) module.exports = KD_AI;
  global.KDAiGame = KD_AI;
})(typeof window !== 'undefined' ? window : globalThis);
