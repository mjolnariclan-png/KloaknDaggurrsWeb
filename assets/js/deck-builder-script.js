// Load user's unlocked factions from Supabase
async function loadUnlockedFactions() {
    try {
        const user = await window.GameAuth.getUser();
        
        if (!user) {
            console.log('User not authenticated, using default factions');
            return ['First Light', 'Ash Cycle']; // Default fallback for unauthenticated users
        }
        
        const { data, error } = await window.GameAuth.supabase
            .from('vault_unlocks')
            .select('faction')
            .eq('user_id', user.id);
        
        if (error) {
            console.error('Error loading unlocked factions:', error);
            return ['First Light', 'Ash Cycle']; // Default fallback
        }
        
        if (!data || data.length === 0) {
            console.log('No unlocked factions found, using defaults');
            return ['First Light', 'Ash Cycle']; // Default fallback
        }
        
        return data.map(u => u.faction);
    } catch (error) {
        console.error('Error loading unlocked factions:', error);
        return ['First Light', 'Ash Cycle']; // Default fallback
    }
}

// Load player's decks from API (MongoDB), filtered by unlocked factions
async function loadPlayerDecks() {
    try {
        if (!sessionStorage.getItem('selectedDeck')) {
            const unlockedFactions = await loadUnlockedFactions();
            console.log('Unlocked factions:', unlockedFactions);
            
            // Load decks from server API
            const response = await window.GameAuth.authenticatedFetch('/api/decks');
            const data = await response.json();
            
            if (!data.success) {
                console.error('Error loading decks:', data.error);
                document.getElementById('decks-container').innerHTML = '<p>Error loading decks</p>';
                return;
            }
            
            // Filter decks by unlocked factions
            const filteredDecks = data.decks.filter(deck => {
                const deckSet = deck.set.toLowerCase();
                return unlockedFactions.some(faction => {
                    const factionLower = faction.toLowerCase();
                    return deckSet.includes(factionLower) || factionLower.includes(deckSet);
                });
            });
            
            const container = document.getElementById('decks-container');
            
            if (!filteredDecks || filteredDecks.length === 0) {
                container.innerHTML = '<p>No decks available for your unlocked factions.</p>';
                return;
            }
            
            container.innerHTML = filteredDecks.map(deck => `
                <div class="deck-card" data-deck-name="${deck.name}">
                    <h3>${deck.name}</h3>
                    <p>${deck.set} - ${deck.vigor}</p>
                    <button class="btn primary select-deck-btn" data-deck="${deck.name}">Select Deck</button>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error in loadPlayerDecks:', error);
    }
}
                    <p>${deck.total_cards} cards</p>
                    <p>Vigor: ${deck.vigor || 'Unknown'}</p>
                    <button class="btn primary select-deck-btn" data-deck="${deck.deck_name}">Select Deck</button>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error in loadPlayerDecks:', error);
    }
}

// Test mode toggle
document.getElementById('test-mode-toggle').addEventListener('change', function() {
    const testControls = document.getElementById('test-mode-controls');
    testControls.style.display = this.checked ? 'block' : 'none';
});

// Test deck button
document.getElementById('test-deck-btn').addEventListener('click', async function() {
    const selectedDeck = sessionStorage.getItem('selectedDeck');
    
    if (!selectedDeck) {
        alert('Please select a deck first');
        return;
    }
    
    const aiDifficulty = document.getElementById('ai-difficulty').value;
    
    // Store test mode settings
    sessionStorage.setItem('testMode', 'true');
    sessionStorage.setItem('aiDifficulty', aiDifficulty);
    
    // Navigate to battlefield
    window.location.href = 'battlefield.html?mode=test';
});

// Select deck button
document.addEventListener('click', async function(e) {
    if (e.target.classList.contains('select-deck-btn')) {
        const deckName = e.target.dataset.deck;
        
        // Load full deck data from API (MongoDB + Cloudinary)
        try {
            const response = await window.GameAuth.authenticatedFetch(`/api/decks/${encodeURIComponent(deckName)}`);
            const data = await response.json();
            
            if (data.success) {
                sessionStorage.setItem('selectedDeck', JSON.stringify(data.deck));
                alert(`Selected: ${deckName}`);
            } else {
                alert('Error loading deck');
            }
        } catch (error) {
            console.error('Error loading deck:', error);
            alert('Error loading deck');
        }
    }
});

// Back to menu button
document.getElementById('back-to-menu-btn').addEventListener('click', function() {
    window.location.href = 'index.html';
});

// Load decks on page load
document.addEventListener('DOMContentLoaded', loadPlayerDecks);