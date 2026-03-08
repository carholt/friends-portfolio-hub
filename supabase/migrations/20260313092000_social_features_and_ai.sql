CREATE OR REPLACE FUNCTION public.compare_portfolios(portfolio_ids UUID[])
RETURNS TABLE (
  portfolio_id UUID,
  name TEXT,
  owner TEXT,
  total_value NUMERIC,
  total_cost NUMERIC,
  return_pct NUMERIC,
  largest_position TEXT,
  risk_score NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH selected_portfolios AS (
    SELECT p.id, p.name, p.owner_user_id
    FROM public.portfolios p
    WHERE p.id = ANY(COALESCE(portfolio_ids, ARRAY[]::UUID[]))
      AND public.can_view_portfolio(p.id)
  ),
  latest_vals AS (
    SELECT DISTINCT ON (v.portfolio_id)
      v.portfolio_id,
      v.total_value,
      v.total_cost,
      v.total_return
    FROM public.portfolio_valuations v
    JOIN selected_portfolios sp ON sp.id = v.portfolio_id
    ORDER BY v.portfolio_id, v.valuation_date DESC, v.created_at DESC
  ),
  latest_prices AS (
    SELECT DISTINCT ON (pr.asset_id)
      pr.asset_id,
      pr.price
    FROM public.prices pr
    ORDER BY pr.asset_id, pr.price_date DESC, pr.created_at DESC
  ),
  position_values AS (
    SELECT
      h.portfolio_id,
      a.symbol,
      (h.quantity * lp.price) AS position_value
    FROM public.holdings h
    JOIN latest_prices lp ON lp.asset_id = h.asset_id
    JOIN public.assets a ON a.id = h.asset_id
    JOIN selected_portfolios sp ON sp.id = h.portfolio_id
    WHERE h.quantity > 0
  ),
  largest AS (
    SELECT DISTINCT ON (pv.portfolio_id)
      pv.portfolio_id,
      pv.symbol,
      pv.position_value
    FROM position_values pv
    ORDER BY pv.portfolio_id, pv.position_value DESC
  ),
  position_weights AS (
    SELECT
      pv.portfolio_id,
      pv.symbol,
      pv.position_value,
      pv.position_value / NULLIF(SUM(pv.position_value) OVER (PARTITION BY pv.portfolio_id), 0) AS weight
    FROM position_values pv
  ),
  concentration AS (
    SELECT
      pw.portfolio_id,
      MAX(pw.weight) AS max_weight
    FROM position_weights pw
    GROUP BY pw.portfolio_id
  )
  SELECT
    sp.id AS portfolio_id,
    sp.name,
    COALESCE(pr.display_name, 'Unknown') AS owner,
    COALESCE(lv.total_value, 0) AS total_value,
    COALESCE(lv.total_cost, 0) AS total_cost,
    CASE
      WHEN COALESCE(lv.total_cost, 0) > 0
      THEN (COALESCE(lv.total_return, 0) / lv.total_cost) * 100
      ELSE 0
    END AS return_pct,
    COALESCE(l.symbol, '-') AS largest_position,
    ROUND((100 - COALESCE(c.max_weight, 1) * 100)::NUMERIC, 2) AS risk_score
  FROM selected_portfolios sp
  LEFT JOIN latest_vals lv ON lv.portfolio_id = sp.id
  LEFT JOIN largest l ON l.portfolio_id = sp.id
  LEFT JOIN concentration c ON c.portfolio_id = sp.id
  LEFT JOIN public.profiles pr ON pr.user_id = sp.owner_user_id
  ORDER BY return_pct DESC;
$$;
