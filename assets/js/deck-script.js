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

// Load available decks from API (MongoDB), filtered by unlocked factions
async function loadDecks() {
    try {
        const unlockedFactions = await loadUnlockedFactions();
        console.log('Unlocked factions:', unlockedFactions);
        
        const response = await window.GameAuth.authenticatedFetch('/api/decks');
        const data = await response.json();
        
        if (data.success) {
            const deckSelect = document.getElementById('deck');
            deckSelect.innerHTML = '<option value="">Select a deck...</option>';
            
            // Filter decks by unlocked factions
            const filteredDecks = data.decks.filter(deck => {
                // Match faction names with set names
                const deckSet = deck.set.toLowerCase();
                return unlockedFactions.some(faction => {
                    const factionLower = faction.toLowerCase();
                    return deckSet.includes(factionLower) || factionLower.includes(deckSet);
                });
            });
            
            if (filteredDecks.length === 0) {
                deckSelect.innerHTML = '<option value="">No decks available for your unlocked factions</option>';
                return;
            }
            
            filteredDecks.forEach(deck => {
                const option = document.createElement('option');
                option.value = deck.name;
                option.textContent = `${deck.name} (${deck.set} - ${deck.vigor})`;
                deckSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading decks:', error);
        const deckSelect = document.getElementById('deck');
        deckSelect.innerHTML = '<option value="">Error loading decks</option>';
    }
}

// Load decks when page loads
document.addEventListener("DOMContentLoaded", loadDecks);

// Back to menu button
document.getElementById("back-to-menu-btn").addEventListener("click", function() {
    window.location.href = "index.html";
});

document.getElementById("deck-selection-form").addEventListener("submit", async function(event) {
    event.preventDefault();
    const deckName = document.getElementById("deck").value;

    // Get mode from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode') || 'ai';

    if (!deckName) {
        alert("Please select a deck.");
        return;
    }

    try {
        // Load the full deck data from API (MongoDB + Cloudinary)
        const response = await window.GameAuth.authenticatedFetch(`/api/decks/${encodeURIComponent(deckName)}`);
        const data = await response.json();
        
        if (data.success) {
            // Store deck data in sessionStorage for the battlefield
            sessionStorage.setItem('selectedDeck', JSON.stringify(data.deck));
            sessionStorage.setItem('gameMode', mode);
            
            // Go to loading screen first
            const deckSize = data.deck.cards ? data.deck.cards.length : 60;
            const url = `loading.html?mode=${mode}&deck=${encodeURIComponent(deckName)}&deck-size=${deckSize}`;
            window.location.href = url;
        } else {
            alert("Error loading deck: " + data.error);
        }
    } catch (error) {
        console.error('Error loading deck:', error);
        alert("Error loading deck. Please try again.");
    }
});
