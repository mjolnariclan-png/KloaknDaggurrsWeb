// Shared game authentication module
// Uses the same Supabase auth as the main website

const KD_CONFIG = window.KD_CONFIG || {
    supabaseUrl: 'https://egpujmjpmeuhiostfrnu.supabase.co',
    supabasePublishableKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVncHVqbWpwbWV1aGlvc3Rmcm51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUyNjY1MzgsImV4cCI6MjEwMDg0MjUzOH0.MMvVnbHo30tCCAprv5CfjwVhLGGO1Bz16-T2y-WReJk'
};

// Initialize Supabase client
const supabase = window.supabase?.createClient(
    KD_CONFIG.supabaseUrl,
    KD_CONFIG.supabasePublishableKey,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

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