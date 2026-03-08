-- Cleanup and harden table/function permissions for app-facing roles.
-- This migration is idempotent and complements 20260310100000_fix_permissions.sql.

-- 1) Never rely on PUBLIC defaults for app tables.
REVOKE ALL ON TABLE public.profiles FROM PUBLIC;
REVOKE ALL ON TABLE public.portfolios FROM PUBLIC;
REVOKE ALL ON TABLE public.assets FROM PUBLIC;
REVOKE ALL ON TABLE public.prices FROM PUBLIC;
REVOKE ALL ON TABLE public.holdings FROM PUBLIC;
REVOKE ALL ON TABLE public.transactions FROM PUBLIC;
REVOKE ALL ON TABLE public.portfolio_valuations FROM PUBLIC;
REVOKE ALL ON TABLE public.groups FROM PUBLIC;
REVOKE ALL ON TABLE public.group_members FROM PUBLIC;
REVOKE ALL ON TABLE public.group_messages FROM PUBLIC;
REVOKE ALL ON TABLE public.companies FROM PUBLIC;
REVOKE ALL ON TABLE public.company_metrics FROM PUBLIC;
REVOKE ALL ON TABLE public.company_ai_reports FROM PUBLIC;
REVOKE ALL ON TABLE public.asset_research FROM PUBLIC;
REVOKE ALL ON TABLE public.broker_import_profiles FROM PUBLIC;

-- 2) Lock down function execute permissions before re-granting explicit access.
-- Public visibility helpers / reads allowed for anon + authenticated.
REVOKE EXECUTE ON FUNCTION public.can_access_portfolio(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_portfolio(UUID) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.latest_price(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.latest_price(UUID) TO anon, authenticated;

-- Authenticated-only RPCs used by the frontend.
REVOKE EXECUTE ON FUNCTION public.latest_portfolio_value(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.latest_portfolio_value(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_leaderboard(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.set_asset_resolution(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_asset_resolution(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.user_has_access_to_report(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_access_to_report(UUID, UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.request_company_ai_report(UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_company_ai_report(UUID, UUID, JSONB) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.refresh_asset_research(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_asset_research(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.recompute_holdings_from_transactions(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_holdings_from_transactions(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_holdings_from_transactions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_holdings_from_transactions(UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.log_audit_action(TEXT, TEXT, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_audit_action(TEXT, TEXT, UUID, JSONB) TO authenticated;
