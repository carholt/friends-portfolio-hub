-- Ensure RPC functions are callable by app roles while still constrained by RLS helpers.
GRANT EXECUTE ON FUNCTION public.can_access_portfolio(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(TEXT) TO authenticated;
