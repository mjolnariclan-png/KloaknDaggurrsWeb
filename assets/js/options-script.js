document.addEventListener('DOMContentLoaded', function() {
    // Load saved options from localStorage
    loadOptions();
    
    // Save options button
    document.getElementById('save-options-btn').addEventListener('click', function() {
        saveOptions();
        alert('Options saved successfully!');
    });
    
    // Back to menu button
    document.getElementById('back-to-menu-btn').addEventListener('click', function() {
        window.location.href = 'index.html';
    });
});

function loadOptions() {
    const options = JSON.parse(localStorage.getItem('gameOptions') || '{}');
    
    if (options.battleSpeed) {
        document.getElementById('battle-speed').value = options.battleSpeed;
    }
    if (options.cardBack) {
        document.getElementById('card-back').value = options.cardBack;
    }
    if (options.showTutorials !== undefined) {
        document.getElementById('show-tutorials').checked = options.showTutorials;
    }
    if (options.masterVolume !== undefined) {
        document.getElementById('master-volume').value = options.masterVolume;
    }
    if (options.musicVolume !== undefined) {
        document.getElementById('music-volume').value = options.musicVolume;
    }
    if (options.sfxVolume !== undefined) {
        document.getElementById('sfx-volume').value = options.sfxVolume;
    }
}

function saveOptions() {
    const options = {
        battleSpeed: document.getElementById('battle-speed').value,
        cardBack: document.getElementById('card-back').value,
        showTutorials: document.getElementById('show-tutorials').checked,
        masterVolume: parseInt(document.getElementById('master-volume').value),
        musicVolume: parseInt(document.getElementById('music-volume').value),
        sfxVolume: parseInt(document.getElementById('sfx-volume').value)
    };
    
    localStorage.setItem('gameOptions', JSON.stringify(options));
}