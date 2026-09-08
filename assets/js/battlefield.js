// Make handleCardImageError globally accessible
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

// UI Controller
class BattlefieldUI {
    constructor(gameState) {
        this.gameState = gameState;
        this.initializeElements();
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.render();
    }
    
    initializeElements() {
        this.elements = {
            playerHand: document.getElementById('player-hand'),
            playerBattlefield: document.getElementById('player-battlefield'),
            opponentHand: document.getElementById('opponent-hand'),
            opponentBattlefield: document.getElementById('opponent-battlefield'),
            playerHandZone: document.getElementById('player-hand-zone'),
            handToggle: document.getElementById('hand-toggle'),
            clickOutsideDetector: document.getElementById('click-outside-detector'),
            playerLife: document.querySelector('.life-count'),
            playerMana: document.querySelector('.mana-count'),
            playerVigor: document.querySelector('.vigor-count'),
            opponentLife: document.querySelector('.opponent-life'),
            opponentMana: document.querySelector('.opponent-mana'),
            opponentVigor: document.querySelector('.opponent-vigor'),
            turnIndicator: document.querySelector('.turn-indicator'),
            turnNumber: document.querySelector('.turn-number'),
            turnPhase: document.querySelector('.turn-phase'),
            drawCardBtn: document.getElementById('draw-card-btn'),
            autoPlayVigorBtn: document.getElementById('auto-play-vigor-btn'),
            endTurnBtn: document.getElementById('end-turn-btn'),
            menuBtn: document.getElementById('menu-btn'),
            modeSelection: document.getElementById('mode-selection'),
            aiModeBtn: document.getElementById('ai-mode-btn'),
            twoPlayerModeBtn: document.getElementById('twoplayer-mode-btn')
        };
        
        this.isHandExpanded = false;
    }
    
    setupEventListeners() {
        this.elements.drawCardBtn.addEventListener('click', () => this.handleDrawCard());
        this.elements.autoPlayVigorBtn.addEventListener('click', () => this.handleAutoPlayVigor());
        this.elements.endTurnBtn.addEventListener('click', () => this.handleEndTurn());
        this.elements.menuBtn.addEventListener('click', () => {
            window.location.href = 'index.html';
        });
        
        // Mode selection
        this.elements.aiModeBtn.addEventListener('click', () => this.setGameMode('ai'));
        this.elements.twoPlayerModeBtn.addEventListener('click', () => this.setGameMode('twoplayer'));
        
        // Hand expansion toggle
        this.elements.handToggle.addEventListener('click', () => this.toggleHandExpansion());
        
        // Click outside detector
        this.elements.clickOutsideDetector.addEventListener('click', () => this.toggleHandExpansion());
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'd' || e.key === 'D') {
                this.handleDrawCard();
            } else if (e.key === ' ') {
                e.preventDefault();
                this.handleEndTurn();
            } else if (e.key === 'Escape') {
                if (this.isHandExpanded) {
                    this.toggleHandExpansion();
                } else {
                    window.location.href = 'index.html';
                }
            }
        });
        
        // Handle window resize for responsive adjustments
        window.addEventListener('resize', () => this.handleResize());
    }
    
    setupDragAndDrop() {
        // Set up drag and drop for the entire document
        document.addEventListener('dragstart', (e) => this.handleDragStart(e));
        document.addEventListener('dragend', (e) => this.handleDragEnd(e));
        document.addEventListener('dragover', (e) => this.handleDragOver(e));
        document.addEventListener('drop', (e) => this.handleDrop(e));
        
        // Set up click interactions for card abilities
        document.addEventListener('click', (e) => this.handleCardClick(e));
    }
    
    handleDragStart(e) {
        if (e.target.classList.contains('card') && e.target.closest('#player-hand')) {
            this.gameState.draggedCard = this.getCardFromElement(e.target);
            e.target.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', JSON.stringify(this.gameState.draggedCard));
        }
    }
    
    handleDragEnd(e) {
        if (e.target.classList.contains('card')) {
            e.target.classList.remove('dragging');
        }
        
        // Remove drag-over styling from all zones
        document.querySelectorAll('.zone').forEach(zone => {
            zone.classList.remove('drag-over');
        });
        
        this.gameState.draggedCard = null;
    }
    
    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        
        // Add visual feedback to drop zones
        const zone = e.target.closest('.zone');
        if (zone && (zone.id === 'player-battlefield-zone' || zone.id === 'player-hand-zone')) {
            zone.classList.add('drag-over');
        }
    }
    
    handleDrop(e) {
        e.preventDefault();
        
        const zone = e.target.closest('.zone');
        if (!zone || !this.gameState.draggedCard) return;
        
        // Find target card if dropping on a card
        const targetCardElement = e.target.closest('.card');
        let targetCard = null;
        if (targetCardElement) {
            targetCard = this.getCardFromElement(targetCardElement);
        }
        
        if (zone.id === 'player-battlefield-zone') {
            // Try to play the card to battlefield
            if (this.gameState.playCard(this.gameState.player, this.gameState.draggedCard, null, targetCard)) {
                this.render();
                console.log('Card played to battlefield');
            } else {
                console.log('Cannot play card - not enough mana or battlefield full');
            }
        } else if (zone.id === 'player-hand-zone') {
            // Return to hand (already there, but re-render)
            this.render();
        }
        
        zone.classList.remove('drag-over');
    }
    
    handleCardClick(e) {
        const cardElement = e.target.closest('.card');
        if (!cardElement) return;
        
        const card = this.getCardFromElement(cardElement);
        if (!card) return;
        
        // Handle different card types based on click
        if (card.type === 'creature' && cardElement.closest('#player-battlefield')) {
            // Select creature for attacking
            this.selectedCreature = card;
            console.log(`Selected ${card.name} for attack`);
            this.render();
        } else if (this.selectedCreature && cardElement.closest('#opponent-battlefield')) {
            // Attack opponent's creature
            this.gameState.attackCreature(this.selectedCreature, card, this.gameState.player, this.gameState.opponent);
            this.selectedCreature = null;
            this.render();
        } else if (this.selectedCreature && cardElement.closest('#opponent-hand-zone')) {
            // Attack opponent directly
            this.gameState.attackPlayer(this.selectedCreature, this.gameState.opponent, this.gameState.player);
            this.selectedCreature = null;
            this.render();
        } else if (card.type === 'rune' && cardElement.closest('#player-hand')) {
            // Cast spell directly
            if (this.gameState.playCard(this.gameState.player, card)) {
                this.render();
            }
        }
    }
    
    handleDrawCard() {
        if (this.gameState.isPlayerTurn) {
            const card = this.gameState.drawCard(this.gameState.player);
            if (card) {
                this.render();
                console.log('Card drawn:', card.name);
            } else {
                console.log('Cannot draw card - hand full or deck empty');
            }
        }
    }
    
    handleAutoPlayVigor() {
        if (this.gameState.isPlayerTurn) {
            this.gameState.autoPlayVigor(this.gameState.player);
            this.render();
        }
    }
    
    setGameMode(mode) {
        this.gameState.isTwoPlayer = (mode === 'twoplayer');
        
        // Update button states
        this.elements.aiModeBtn.classList.remove('active');
        this.elements.twoPlayerModeBtn.classList.remove('active');
        
        if (mode === 'ai') {
            this.elements.aiModeBtn.classList.add('active');
        } else {
            this.elements.twoPlayerModeBtn.classList.add('active');
        }
        
        console.log(`Game mode set to: ${mode}`);
        this.render();
    }
    
    handleEndTurn() {
        this.gameState.endTurn();
        this.render();
    }
    
    handleResize() {
        // Responsive adjustments can be made here if needed
        console.log('Window resized');
    }
    
    toggleHandExpansion() {
        this.isHandExpanded = !this.isHandExpanded;
        
        if (this.isHandExpanded) {
            this.elements.playerHandZone.classList.add('expanded');
            this.elements.handToggle.textContent = '−';
            this.elements.clickOutsideDetector.classList.add('active');
        } else {
            this.elements.playerHandZone.classList.remove('expanded');
            this.elements.handToggle.textContent = '+';
            this.elements.clickOutsideDetector.classList.remove('active');
        }
    }
    
    showGameOver() {
        // Remove existing game over overlay if present
        const existingOverlay = document.querySelector('.game-over-overlay');
        if (existingOverlay) {
            existingOverlay.remove();
        }
        
        // Create game over overlay
        const overlay = document.createElement('div');
        overlay.className = 'game-over-overlay';
        overlay.innerHTML = `
            <div class="game-over-content">
                <h2 class="game-over-title">${this.gameState.winner} Wins!</h2>
                <p class="game-over-message">The battle has ended.</p>
                <button id="play-again-btn" class="control-btn">Play Again</button>
                <button id="menu-btn-overlay" class="control-btn">Return to Menu</button>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        // Add event listeners
        document.getElementById('play-again-btn').addEventListener('click', () => {
            location.reload();
        });
        
        document.getElementById('menu-btn-overlay').addEventListener('click', () => {
            window.location.href = 'index.html';
        });
    }
    
    getCardFromElement(element) {
        const cardId = element.dataset.cardId;
        return this.gameState.player.hand.find(card => card.id == cardId) ||
               this.gameState.player.battlefield.find(card => card.id == cardId);
    }
    
    getColorForVigor(vigorType) {
        const colors = {
            'Earth': '#8B4513',
            'Fairy': '#FF69B4',
            'Fungus': '#6B8E23',
            'Greed': '#FFD700',
            'Lava': '#FF4500',
            'Lightning': '#FFD700',
            'Moon': '#C0C0C0',
            'Ocean': '#4169E1',
            'Sorcery': '#9400D3',
            'Spirit': '#6A5ACD',
            'Sun': '#FFD700',
            'Tar': '#2F4F4F',
            'Chaos': '#8B0000',
            'Purity': '#FFFFFF',
            'Flame': '#FF6347',
            'Frost': '#87CEEB',
            'Nature': '#228B22',
            'Death': '#4B0082',
            'Life': '#32CD32'
        };
        return colors[vigorType] || '#666666';
    }

    createCardElement(card, isFaceDown = false, isDraggable = false) {
        const cardEl = document.createElement('div');
        cardEl.className = 'card';
        cardEl.dataset.cardId = card.id;
        
        // Add type-specific classes
        if (card.type) {
            cardEl.classList.add(`card-${card.type}`);
        }
        
        // Add selected class if this is the selected creature
        if (this.selectedCreature && this.selectedCreature.id === card.id) {
            cardEl.classList.add('selected');
        }
        
        if (isFaceDown) {
            cardEl.classList.add('face-down');
        } else {
            if (isDraggable) {
                cardEl.draggable = true;
            }
            
            // Use correct field names from card data
            // Handle string format like "AP 9" and extract numeric value
            const apString = card.ap || card.attack || 0;
            const dpString = card.dp || card.defense || 0;
            const attack = typeof apString === 'string' ? parseInt(apString.replace(/\D/g, '')) || 0 : apString;
            const defense = typeof dpString === 'string' ? parseInt(dpString.replace(/\D/g, '')) || 0 : dpString;
            const vigorType = card.vigor || card.vigor_type;
            const manaCost = card['Mana Card Cost'] || card.manaCost || 0;
            const color = card.color || this.getColorForVigor(vigorType);
            const cardImage = card.standard_path || card.image;
            
            // Different card display based on type
            let cardContent = '';
            
            if (card.type === 'vigor') {
                cardContent = `
                    <div class="card-cost">0</div>
                    <div class="card-name">${card.name}</div>
                    <div class="card-image vigor-icon">
                        <img src="${cardImage}" alt="${card.name}" onerror="handleCardImageError(this, '${color}', '💎', true)">
                    </div>
                    <div class="card-description">+1 Mana</div>
                `;
            } else if (card.type === 'primordial') {
                cardContent = `
                    <div class="card-cost">${manaCost}</div>
                    <div class="card-name primordial-name">${card.name}</div>
                    <div class="card-image">
                        <img src="${cardImage}" alt="${card.name}" onerror="handleCardImageError(this, '${color}', '👑', true)">
                    </div>
                    <div class="card-stats">
                        <span class="card-attack">⚔${attack}</span>
                        <span class="card-defense">🛡${defense}</span>
                    </div>
                    <div class="card-primordial-indicator">👑 KING</div>
                `;
            } else if (card.type === 'rune') {
                cardContent = `
                    <div class="card-cost">${manaCost}</div>
                    <div class="card-name">${card.name}</div>
                    <div class="card-image rune-icon">
                        <img src="${cardImage}" alt="${card.name}" onerror="handleCardImageError(this, '${color}', '✨', false)">
                    </div>
                    <div class="card-description">One-time use</div>
                `;
            } else if (card.type === 'equipment') {
                cardContent = `
                    <div class="card-cost">${manaCost}</div>
                    <div class="card-name">${card.name}</div>
                    <div class="card-class">${card.className || ''}</div>
                    <div class="card-image equipment-icon">
                        <img src="${cardImage}" alt="${card.name}" onerror="handleCardImageError(this, '${color}', '⚔️', false)">
                    </div>
                    <div class="card-stats">
                        <span class="card-attack">+${attack}</span>
                        <span class="card-defense">+${defense}</span>
                    </div>
                    <div class="card-description">Attach to creature</div>
                `;
            } else {
                // Creature
                cardContent = `
                    <div class="card-cost">${manaCost}</div>
                    <div class="card-name">${card.name}</div>
                    <div class="card-class">${card.className || ''}</div>
                    <div class="card-image">
                        <img src="${cardImage}" alt="${card.name}" onerror="handleCardImageError(this, '${color}', '⚔️', true)">
                    </div>
                    <div class="card-stats">
                        <span class="card-attack">⚔${attack}</span>
                        <span class="card-defense">🛡${defense}</span>
                    </div>
                    ${card.attacks && card.attacks.length > 0 ? `<div class="card-abilities">Click for attacks</div>` : ''}
                    ${card.attachedEquipment ? `<div class="card-equipment">⚔️+${card.attachedEquipment.attack}/🛡+${card.attachedEquipment.defense}</div>` : ''}
                `;
            }
            
            cardEl.innerHTML = cardContent;
            
            // Add click handler for attack selection
            if (card.attacks && card.attacks.length > 0) {
                cardEl.addEventListener('click', () => this.showAttackOptions(card));
            }
        }
        
        return cardEl;
    }
    
    showAttackOptions(card) {
        const options = card.attacks.map((attack, index) => 
            `${index + 1}. ${attack.name} (${attack.description}) - Cost: ${attack.manaCost}`
        ).join('\n');
        
        alert(`Attack Options for ${card.name}:\n\n${options}`);
    }
    
    render() {
        // Update player info
        this.elements.playerLife.textContent = `Life: ${this.gameState.player.life}`;
        this.elements.playerMana.textContent = `Mana: ${this.gameState.player.mana}`;
        this.elements.playerVigor.textContent = `Vigor: ${this.gameState.calculateMana(this.gameState.player)}`;
        
        // Update opponent info
        this.elements.opponentLife.textContent = `Life: ${this.gameState.opponent.life}`;
        this.elements.opponentMana.textContent = `Mana: ${this.gameState.opponent.mana}`;
        this.elements.opponentVigor.textContent = `Vigor: ${this.gameState.calculateMana(this.gameState.opponent)}`;
        
        // Update turn info
        this.elements.turnIndicator.textContent = this.gameState.isPlayerTurn ? 'Your Turn' : "Opponent's Turn";
        this.elements.turnNumber.textContent = `Turn: ${this.gameState.turnNumber}`;
        this.elements.turnPhase.textContent = this.gameState.currentPhase.charAt(0).toUpperCase() + this.gameState.currentPhase.slice(1);
        
        // Render player hand
        this.elements.playerHand.innerHTML = '';
        this.gameState.player.hand.forEach(card => {
            const isDraggable = this.gameState.isPlayerTurn && (card.type === 'creature' || card.type === 'equipment' || card.type === 'vigor');
            const cardEl = this.createCardElement(card, false, isDraggable);
            this.elements.playerHand.appendChild(cardEl);
        });
        
        // Render player battlefield
        this.elements.playerBattlefield.innerHTML = '';
        this.gameState.player.battlefield.forEach(card => {
            const cardEl = this.createCardElement(card, false, false);
            this.elements.playerBattlefield.appendChild(cardEl);
        });
        
        // Render opponent hand (face down)
        this.elements.opponentHand.innerHTML = '';
        this.gameState.opponent.hand.forEach(card => {
            const cardEl = this.createCardElement(card, true, false);
            this.elements.opponentHand.appendChild(cardEl);
        });
        
        // Render opponent battlefield
        this.elements.opponentBattlefield.innerHTML = '';
        this.gameState.opponent.battlefield.forEach(card => {
            const cardEl = this.createCardElement(card, false, false);
            this.elements.opponentBattlefield.appendChild(cardEl);
        });
        
        // Show game over message if game is over
        if (this.gameState.gameOver) {
            this.showGameOver();
        }
        
        // Update button states
        this.elements.drawCardBtn.disabled = !this.gameState.isPlayerTurn || this.gameState.currentPhase !== 'play_cards';
        this.elements.autoPlayVigorBtn.disabled = !this.gameState.isPlayerTurn || this.gameState.currentPhase !== 'play_vigor';
        this.elements.endTurnBtn.disabled = !this.gameState.isPlayerTurn;
    }
}

// Initialize the game
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing battlefield...');
    
    // Create game state
    const gameState = new GameState();
    
    // Try to load pre-made deck from sessionStorage
    const storedDeck = sessionStorage.getItem('selectedDeck');
    if (storedDeck) {
        try {
            const deckData = JSON.parse(storedDeck);
            console.log('Loading pre-made deck:', deckData.name);
            gameState.player.deck = deckData.cards.map(card => ({ ...card, type: normalizeCardType(card.type) }));
        } catch (error) {
            console.error('Error loading stored deck:', error);
            gameState.player.deck = CardGenerator.generateDeck();
        }
    } else {
        // Generate proper 60-card decks with correct ratios
        gameState.player.deck = CardGenerator.generateDeck();
    }
    
    // Generate opponent deck (AI or multiplayer)
    gameState.opponent.deck = CardGenerator.generateDeck();
    
    // Shuffle decks
    gameState.player.deck.sort(() => Math.random() - 0.5);
    gameState.opponent.deck.sort(() => Math.random() - 0.5);
    
    // Draw initial hands (7 cards each)
    for (let i = 0; i < 7; i++) {
        gameState.drawCard(gameState.player);
        gameState.drawCard(gameState.opponent);
    }
    
    // Initial vigor reset (0 vigor on battlefield = 0 mana)
    gameState.vigorReset(gameState.player);
    gameState.vigorReset(gameState.opponent);
    
    console.log(`Player starts with ${gameState.player.mana} mana and ${gameState.player.hand.length} cards`);
    console.log(`Opponent starts with ${gameState.opponent.mana} mana and ${gameState.opponent.hand.length} cards`);
    
    // Initialize UI
    const ui = new BattlefieldUI(gameState);
    
    // Set default mode to AI
    ui.setGameMode('ai');
    
    console.log('Battlefield initialized successfully');
});