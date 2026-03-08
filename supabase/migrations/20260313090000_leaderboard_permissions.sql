-- Leaderboard frontend permissions hardening.

GRANT SELECT ON public.portfolio_leaderboard TO authenticated;
GRANT SELECT ON public.portfolio_leaderboard TO anon;
GRANT ALL ON public.portfolio_leaderboard TO service_role;

GRANT EXECUTE ON FUNCTION public.get_portfolio_leaderboard(integer)
TO authenticated, anon;
