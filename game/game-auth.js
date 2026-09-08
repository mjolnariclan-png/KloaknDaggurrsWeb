// Shared game authentication module
// Uses the same Supabase auth as the main website

(function() {
    // Use the Supabase client initialized in the HTML
    const supabaseClient = window.supabase;

    if (!supabaseClient) {
        console.error('Supabase client not found. Make sure it is initialized before loading this script.');
        return;
    }

    // Game server URL configuration
    // Local development: http://localhost:3005
    // Production: Change to your deployed game server URL
    const GAME_SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3005'
        : 'https://api.kloakndaggurrs.com'; // Change this to your production game server URL

    // Get current session
    async function getSession() {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error) {
            console.error('Error getting session:', error);
            return null;
        }
        return session;
    }

    // Get auth token for API calls
    async function getAuthToken() {
        const session = await getSession();
        return session ? session.access_token : null;
    }

    // Make authenticated API call to game server
    async function authenticatedFetch(url, options = {}) {
        const token = await getAuthToken();
        
        // Convert relative URLs to absolute URLs pointing to game server
        let apiUrl = url;
        if (url.startsWith('/')) {
            apiUrl = GAME_SERVER_URL + url;
        }
        
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        return fetch(apiUrl, {
            ...options,
            headers
        });
    }

    // Check if user is authenticated
    async function isAuthenticated() {
        const session = await getSession();
        return session !== null;
    }

    // Redirect to login if not authenticated
    async function requireAuth() {
        const authenticated = await isAuthenticated();
        if (!authenticated) {
            // Redirect to main website login
            window.location.href = 'https://www.kloakndaggurrs.com';
            return false;
        }
        return true;
    }

    // Get user info
    async function getUser() {
        const session = await getSession();
        return session ? session.user : null;
    }

    // Logout
    async function logout() {
        await supabaseClient.auth.signOut();
        window.location.href = 'https://www.kloakndaggurrs.com';
    }

    // Export for use in game pages
    window.GameAuth = {
        supabase: supabaseClient,
        GAME_SERVER_URL,
        getSession,
        getAuthToken,
        authenticatedFetch,
        isAuthenticated,
        requireAuth,
        getUser,
        logout
    };
})();

// Get current session
async function getSession() {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
        console.error('Error getting session:', error);
        return null;
    }
    return session;
}

// Get auth token for API calls
async function getAuthToken() {
    const session = await getSession();
    return session ? session.access_token : null;
}

// Make authenticated API call to game server
async function authenticatedFetch(url, options = {}) {
    const token = await getAuthToken();
    
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    return fetch(url, {
        ...options,
        headers
    });
}

// Check if user is authenticated
async function isAuthenticated() {
    const session = await getSession();
    return session !== null;
}

// Redirect to login if not authenticated
async function requireAuth() {
    const authenticated = await isAuthenticated();
    if (!authenticated) {
        // Redirect to main website login
        window.location.href = 'https://www.kloakndaggurrs.com';
        return false;
    }
    return true;
}

// Get user info
async function getUser() {
    const session = await getSession();
    return session ? session.user : null;
}

// Logout
async function logout() {
    await supabase.auth.signOut();
    window.location.href = 'https://www.kloakndaggurrs.com';
}

// Export for use in game pages
window.GameAuth = {
    supabase,
    getSession,
    getAuthToken,
    authenticatedFetch,
    isAuthenticated,
    requireAuth,
    getUser,
    logout
};