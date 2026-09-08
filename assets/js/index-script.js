document.addEventListener("DOMContentLoaded", function() {
    const startGameButton = document.getElementById("start-game-btn");
    const multiplayerButton = document.getElementById("multiplayer-btn");
    const deckBuilderButton = document.getElementById("deck-builder-btn");
    const optionsButton = document.getElementById("options-btn");
    const creditsButton = document.getElementById("credits-btn");

    startGameButton.addEventListener("click", function() {
        // Navigate to deck selection for AI game
        window.location.href = "deck-selection.html?mode=ai";
    });

    multiplayerButton.addEventListener("click", function() {
        // Navigate to deck selection for multiplayer
        window.location.href = "deck-selection.html?mode=multiplayer";
    });

    deckBuilderButton.addEventListener("click", function() {
        // Navigate to deck builder
        window.location.href = "deck-builder.html";
    });

    optionsButton.addEventListener("click", function() {
        // Navigate to the options screen
        window.location.href = "options.html"; // Change the URL as needed
    });

    creditsButton.addEventListener("click", function() {
        // Navigate to the credits screen
        window.location.href = "credits.html"; // Change the URL as needed
    });
});
