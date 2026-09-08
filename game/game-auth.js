// Shared game authentication module
// Uses the same Supabase auth as the main website

(function() {
    // Use the Supabase client initialized in the HTML
    const supabaseClient = window.supabase;

    if (!supabaseClient) {
        console.error('Supabase client not found. Make sure it is initialized before loading this script.');
        return;
    }

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
        
        // If URL is relative and gameServerUrl is configured, prepend it
        // Otherwise use same-origin (relative URLs work without prepending)
        let fullUrl = url;
        if (url.startsWith('/') && window.KD_CONFIG?.gameServerUrl) {
            fullUrl = window.KD_CONFIG.gameServerUrl + url;
        }
        
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        return fetch(fullUrl, {
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
        getSession,
        getAuthToken,
        authenticatedFetch,
        isAuthenticated,
        requireAuth,
        getUser,
        logout
    };
})();