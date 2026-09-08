// Load available decks from API (MongoDB)
async function loadDecks() {
    try {
        const response = await window.GameAuth.authenticatedFetch('/api/decks');
        const data = await response.json();
        if (data.success) {
            const deckSelect = document.getElementById('deck');
            deckSelect.innerHTML = '<option value="">Select a deck...</option>';
            data.decks.forEach(deck => {
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
            alert("Error loading deck: " + data.error);
        }
    } catch (error) {
        console.error('Error loading deck:', error);
        alert("Error loading deck. Please try again.");
    }
});
