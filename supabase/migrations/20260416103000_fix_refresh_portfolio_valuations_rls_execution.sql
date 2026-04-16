-- Ensure portfolio valuation refresh RPC can run from backend workers without RLS blocking holdings reads.
ALTER FUNCTION public.refresh_portfolio_valuations() SECURITY DEFINER;
ALTER FUNCTION public.refresh_portfolio_valuations() OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.refresh_portfolio_valuations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_portfolio_valuations() TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_portfolio_valuations() TO authenticated;
