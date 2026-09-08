-- ============================================
-- Supabase RPC: get_cards_from_mongodb
-- Queries the game server's MongoDB for card data
-- ============================================

CREATE OR REPLACE FUNCTION get_cards_from_mongodb(
    p_set TEXT DEFAULT NULL,
    p_type TEXT DEFAULT NULL,
    p_vigor_type TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    game_server_url TEXT := 'https://api.kloakndaggurrs.com'; -- Change to your production game server URL
    api_url TEXT;
    response TEXT;
    result JSON;
BEGIN
    -- Build API URL with query parameters
    api_url := game_server_url || '/api/cards-public';
    
    IF p_set IS NOT NULL THEN
        api_url := api_url || '?set=' || url_encode(p_set);
    END IF;
    
    IF p_type IS NOT NULL THEN
        IF p_set IS NULL THEN
            api_url := api_url || '?type=' || url_encode(p_type);
        ELSE
            api_url := api_url || '&type=' || url_encode(p_type);
        END IF;
    END IF;
    
    IF p_vigor_type IS NOT NULL THEN
        IF p_set IS NULL AND p_type IS NULL THEN
            api_url := api_url || '?vigorType=' || url_encode(p_vigor_type);
        ELSE
            api_url := api_url || '&vigorType=' || url_encode(p_vigor_type);
        END IF;
    END IF;
    
    -- Make HTTP request to game server
    -- Note: This requires pg_net extension to be enabled in Supabase
    SELECT content INTO response
    FROM http_get(api_url);
    
    -- Parse response as JSON
    result := response::json;
    
    RETURN result;
END;
$$;

-- ============================================
-- Alternative: Direct MongoDB connection via pg_net
-- If pg_net is not available, use Supabase Edge Function instead
-- ============================================

-- For production, you should use a Supabase Edge Function instead:
-- This function would:
-- 1. Receive the request from the frontend
-- 2. Call the game server's /api/cards-public endpoint
-- 3. Return the card data
-- This avoids needing pg_net extension in Supabase

-- Edge Function example (create in Supabase Dashboard):
/*
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const GAME_SERVER_URL = 'https://api.kloakndaggurrs.com'; -- Change to your production game server URL

serve(async (req) => {
  const { set, type, vigorType } = await req.json();
  
  const apiUrl = new URL(`${GAME_SERVER_URL}/api/cards-public`);
  if (set) apiUrl.searchParams.set('set', set);
  if (type) apiUrl.searchParams.set('type', type);
  if (vigorType) apiUrl.searchParams.set('vigorType', vigorType);
  
  const response = await fetch(apiUrl.toString());
  const data = await response.json();
  
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' }
  });
});
*/