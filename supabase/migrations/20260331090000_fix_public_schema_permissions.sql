-- Ensure public leaderboard RPC is reachable for anonymous users.
-- Some environments may have had schema-level privileges tightened,
-- causing `permission denied for schema public` when calling public RPCs.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Re-assert access to open leaderboard endpoints.
GRANT EXECUTE ON FUNCTION public.get_leaderboard(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_portfolio_leaderboard(INTEGER) TO anon, authenticated, service_role;
