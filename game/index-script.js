document.addEventListener("DOMContentLoaded", function() {
    const startGameButton = document.getElementById("start-game-btn");
    const multiplayerButton = document.getElementById("multiplayer-btn");
    const optionsButton = document.getElementById("options-btn");
    const creditsButton = document.getElementById("credits-btn");

    startGameButton.addEventListener("click", function() {
        // Navigate to deck selection for AI game
        window.location.href = "deck-selection.html?mode=ai";
    });

    multiplayerButton.addEventListener("click", function() {
        // Navigate to deck selection for multiplayer
        window.location.href = "multiplayer.html";
    });

    optionsButton.addEventListener("click", function() {
        // Navigate to the options screen
        alert("Battle Arena options are coming in the next build.");
    });

    creditsButton.addEventListener("click", function() {
        // Navigate to the credits screen
        alert("Kloak & Daggurrs — Klandestine Battle Arena.");
    });
});
