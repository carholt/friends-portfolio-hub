-- Ensure RPC functions are callable by app roles while still constrained by RLS helpers.
DO $do$
BEGIN
  IF to_regprocedure('public.can_access_portfolio(uuid)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.can_access_portfolio(UUID) TO authenticated, anon;
  END IF;

  IF to_regprocedure('public.get_leaderboard(text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_leaderboard(TEXT) TO authenticated;
  END IF;
END;
$do$;
