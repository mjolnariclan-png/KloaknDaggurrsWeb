document.addEventListener('DOMContentLoaded', function() {
    const queryParams = new URLSearchParams(window.location.search);
    const deckSize = parseInt(queryParams.get('deck-size')) || 60;
    const mode = queryParams.get('mode') || 'ai';
    const deckName = queryParams.get('deck');
    
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const loadingMessage = document.getElementById('loading-message');
    
    // Calculate loading time: 0.1 seconds per card
    const totalTime = deckSize * 100; // in milliseconds
    const cardDelay = totalTime / deckSize;
    
    let loadedCards = 0;
    
    const loadingInterval = setInterval(() => {
        loadedCards++;
        const progress = (loadedCards / deckSize) * 100;
        
        progressFill.style.width = `${progress}%`;
        progressText.textContent = `${loadedCards}/${deckSize}`;
        
        if (loadedCards >= deckSize) {
            clearInterval(loadingInterval);
            loadingMessage.textContent = 'Deck loaded! Entering battlefield...';
            
            setTimeout(() => {
                window.location.href = `battlefield.html?mode=${mode}&deck=${encodeURIComponent(deckName)}`;
            }, 500);
        }
    }, cardDelay);
});