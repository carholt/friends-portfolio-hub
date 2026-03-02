-- Database hardening: indexes, constraints, RLS safety, and leaderboard optimization.

-- 1) Data integrity constraints
ALTER TABLE public.holdings
  ADD CONSTRAINT holdings_quantity_non_negative CHECK (quantity >= 0),
  ADD CONSTRAINT holdings_avg_cost_non_negative CHECK (avg_cost >= 0);

ALTER TABLE public.prices
  ADD CONSTRAINT prices_price_positive CHECK (price > 0);

ALTER TABLE public.portfolios
  ADD CONSTRAINT portfolios_group_visibility_requires_group
  CHECK (visibility <> 'group' OR group_id IS NOT NULL);

ALTER TABLE public.holdings
  ADD CONSTRAINT holdings_unique_portfolio_asset UNIQUE (portfolio_id, asset_id);

-- 2) Indexes for common query paths and helper functions.
CREATE INDEX IF NOT EXISTS idx_portfolios_owner_user_id ON public.portfolios(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_portfolios_visibility ON public.portfolios(visibility);
CREATE INDEX IF NOT EXISTS idx_holdings_portfolio_id ON public.holdings(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_holdings_asset_id ON public.holdings(asset_id);
CREATE INDEX IF NOT EXISTS idx_prices_asset_id_as_of_date_desc ON public.prices(asset_id, as_of_date DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_valuations_portfolio_id_as_of_date_desc
  ON public.portfolio_valuations(portfolio_id, as_of_date DESC);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id_group_id ON public.group_members(user_id, group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON public.group_members(group_id);

-- 3) Safe helper functions for latest values.
CREATE OR REPLACE FUNCTION public.latest_portfolio_value(_portfolio_id UUID)
RETURNS TABLE (portfolio_id UUID, total_value NUMERIC, as_of_date DATE)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  SELECT pv.portfolio_id, pv.total_value, pv.as_of_date
  FROM public.portfolio_valuations AS pv
  WHERE pv.portfolio_id = _portfolio_id
  ORDER BY pv.as_of_date DESC
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.latest_price(_asset_id UUID)
RETURNS TABLE (asset_id UUID, price NUMERIC, as_of_date DATE)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  SELECT p.asset_id, p.price, p.as_of_date
  FROM public.prices AS p
  WHERE p.asset_id = _asset_id
  ORDER BY p.as_of_date DESC
  LIMIT 1;
$function$;

-- 4) Leaderboard optimization:
--    - scope to accessible portfolios only
--    - index-driven latest value lookup via helper
--    - index-driven period start lookup via LATERAL
CREATE OR REPLACE FUNCTION public.get_leaderboard(_period TEXT DEFAULT 'ALL')
RETURNS TABLE (
  portfolio_id UUID,
  portfolio_name TEXT,
  visibility public.portfolio_visibility,
  owner_name TEXT,
  start_value NUMERIC,
  end_value NUMERIC,
  return_abs NUMERIC,
  return_pct NUMERIC,
  last_updated DATE
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  WITH params AS (
    SELECT CASE _period
      WHEN '1M' THEN (CURRENT_DATE - INTERVAL '1 month')::DATE
      WHEN '3M' THEN (CURRENT_DATE - INTERVAL '3 months')::DATE
      WHEN 'YTD' THEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::INT, 1, 1)
      WHEN '1Y' THEN (CURRENT_DATE - INTERVAL '1 year')::DATE
      ELSE DATE '2000-01-01'
    END AS period_start
  ),
  accessible AS (
    SELECT p.id, p.name, p.visibility, p.owner_user_id
    FROM public.portfolios AS p
    WHERE public.can_access_portfolio(p.id)
  ),
  computed AS (
    SELECT
      a.id AS portfolio_id,
      a.name AS portfolio_name,
      a.visibility,
      a.owner_user_id,
      lv.total_value AS end_value,
      lv.as_of_date AS last_updated,
      COALESCE(ps.total_value, fe.total_value) AS start_value
    FROM accessible AS a
    LEFT JOIN LATERAL public.latest_portfolio_value(a.id) AS lv ON TRUE
    LEFT JOIN LATERAL (
      SELECT pv.total_value
      FROM public.portfolio_valuations AS pv, params
      WHERE pv.portfolio_id = a.id
        AND pv.as_of_date >= params.period_start
      ORDER BY pv.as_of_date ASC
      LIMIT 1
    ) AS ps ON TRUE
    LEFT JOIN LATERAL (
      SELECT pv.total_value
      FROM public.portfolio_valuations AS pv
      WHERE pv.portfolio_id = a.id
      ORDER BY pv.as_of_date ASC
      LIMIT 1
    ) AS fe ON TRUE
    WHERE lv.total_value IS NOT NULL
  )
  SELECT
    c.portfolio_id,
    c.portfolio_name,
    c.visibility,
    COALESCE(pr.display_name, '–') AS owner_name,
    c.start_value,
    c.end_value,
    c.end_value - c.start_value AS return_abs,
    CASE
      WHEN c.start_value > 0 THEN ((c.end_value - c.start_value) / c.start_value) * 100
      ELSE NULL
    END AS return_pct,
    c.last_updated
  FROM computed AS c
  LEFT JOIN public.profiles AS pr ON pr.user_id = c.owner_user_id
  ORDER BY return_pct DESC NULLS LAST, return_abs DESC NULLS LAST;
$function$;

-- 5) RLS hardening for audit log write-path.
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM authenticated, anon;

-- No direct write policy should exist for clients on audit_log.
DROP POLICY IF EXISTS "Users can insert own audit log" ON public.audit_log;
DROP POLICY IF EXISTS "Users can update own audit log" ON public.audit_log;
DROP POLICY IF EXISTS "Users can delete own audit log" ON public.audit_log;

-- 6) RPC grants
GRANT EXECUTE ON FUNCTION public.latest_portfolio_value(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.latest_price(UUID) TO authenticated, anon;
