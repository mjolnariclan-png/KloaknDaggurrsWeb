(() => {
  const originalFetch = window.fetch.bind(window);
  let client = null;
  window.KD_GAME_AUTH_READY = (async () => {
    if (!window.supabase || !window.KD_CONFIG) throw new Error('K&D authentication configuration missing.');
    client = window.supabase.createClient(KD_CONFIG.supabaseUrl, KD_CONFIG.supabasePublishableKey, {auth:{persistSession:true,autoRefreshToken:true}});
    const {data:{session}, error} = await client.auth.getSession();
    if (error) throw error;
    if (!session) {
      location.href = '/#/login';
      throw new Error('Sign in required');
    }
    window.KD_GAME_SESSION = session;
    return session;
  })();
  window.fetch = async (input, init={}) => {
    const raw = typeof input === 'string' ? input : input.url;
    const url = new URL(raw, location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
      const session = await window.KD_GAME_AUTH_READY;
      const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined) || {});
      headers.set('Authorization', `Bearer ${session.access_token}`);
      init = {...init, headers};
    }
    return originalFetch(input, init);
  };
})();
