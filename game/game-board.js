async function fetchCards(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('Failed to fetch cards');
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching cards:', error);
        throw error;
    }
}

async function loadPlayerHand() {
    try {
        const playerHand = await fetchCards('/api/player-hand'); // Adjust URL as needed
        console.log('Player Hand:', playerHand); // Example: Log the fetched data
        // Handle displaying player hand cards in your game interface
    } catch (error) {
        console.error('Error loading player hand:', error);
        // Handle error (e.g., display error message to user)
    }
}

async function loadBattlefield() {
    try {
        const battlefield = await fetchCards('/api/battlefield'); // Adjust URL as needed
        console.log('Battlefield:', battlefield); // Example: Log the fetched data
        // Handle displaying battlefield cards in your game interface
    } catch (error) {
        console.error('Error loading battlefield:', error);
        // Handle error (e.g., display error message to user)
    }
}
async function drawCard() {
    console.log('Draw Card button clicked'); // Add console log to check if function is called

    try {
        // Placeholder for fetch logic or any other action
        console.log('Fetching new card data...'); // Add console log for debugging fetch

        // Example: Simulate fetching card data
        const newCardData = {
            id: 1,
            name: 'New Card',
            type: 'Creature',
            power: 3,
            toughness: 2
        };

        // Example: Update UI or do something with newCardData
        console.log('New card fetched:', newCardData); // Log fetched card data for debugging
    } catch (error) {
        console.error('Error drawing card:', error);
        // Handle error (e.g., display error message to user)
    }
}

async function fetchNewCard() {
    try {
        const response = await fetch('/api/cards', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            // Example body: Adjust based on your card data structure
            body: JSON.stringify({ playerId: 1 }), // Assuming playerId 1 is hardcoded for example
        });
        if (!response.ok) {
            throw new Error('Failed to fetch new card');
        }
        const newCard = await response.json();
        return newCard; // Return fetched card data
    } catch (error) {
        console.error('Error fetching new card:', error);
        throw error; // Rethrow error to handle it further if needed
    }
}
