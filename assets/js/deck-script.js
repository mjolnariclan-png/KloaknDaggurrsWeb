// Load available decks from local files
async function loadDecks() {
    try {
        const response = await fetch('assets/data/decks');
        const text = await response.text();
        const deckFiles = text.split('\n').filter(line => line.endsWith('.json'));
        
        const deckSelect = document.getElementById('deck');
        deckSelect.innerHTML = '<option value="">Select a deck...</option>';
        
        for (const file of deckFiles) {
            const deckName = file.replace('.json', '');
            const option = document.createElement('option');
            option.value = deckName;
            option.textContent = deckName.replace(/_/g, ' ');
            deckSelect.appendChild(option);
        }
    } catch (error) {
        console.error('Error loading decks:', error);
        const deckSelect = document.getElementById('deck');
        deckSelect.innerHTML = '<option value="">Error loading decks</option>';
    }
}

// Load decks when page loads
document.addEventListener("DOMContentLoaded", loadDecks);

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
        // Load the full deck data from local file
        const response = await fetch(`assets/data/decks/${deckName}.json`);
        const deck = await response.json();
        
        // Store deck data in sessionStorage for the battlefield
        sessionStorage.setItem('selectedDeck', JSON.stringify(deck));
        sessionStorage.setItem('gameMode', mode);
        
        // Go directly to battlefield
        const url = `battlefield.html?mode=${mode}`;
        window.location.href = url;
    } catch (error) {
        console.error('Error loading deck:', error);
        alert("Error loading deck. Please try again.");
    }
});
