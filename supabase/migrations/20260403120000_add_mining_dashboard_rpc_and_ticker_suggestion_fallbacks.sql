-- Restore mining dashboard RPC for PostgREST schema cache compatibility.

CREATE OR REPLACE FUNCTION public.get_portfolio_mining_dashboard(portfolio_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_authorized BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.portfolios p
    LEFT JOIN public.group_members gm
      ON gm.group_id = p.group_id
     AND gm.user_id = auth.uid()
    WHERE p.id = get_portfolio_mining_dashboard.portfolio_id
      AND (
        auth.role() = 'service_role'
        OR p.owner_user_id = auth.uid()
        OR gm.user_id IS NOT NULL
      )
  )
  INTO v_authorized;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not allowed to view this portfolio dashboard'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN (
    WITH latest_valuation AS (
      SELECT pv.total_value, pv.total_cost, pv.total_return
      FROM public.portfolio_valuations pv
      WHERE pv.portfolio_id = get_portfolio_mining_dashboard.portfolio_id
      ORDER BY pv.valuation_date DESC
      LIMIT 1
    ),
    previous_valuation AS (
      SELECT pv.total_value
      FROM public.portfolio_valuations pv
      WHERE pv.portfolio_id = get_portfolio_mining_dashboard.portfolio_id
      ORDER BY pv.valuation_date DESC
      OFFSET 1
      LIMIT 1
    ),
    exposure_by_metal AS (
      SELECT COALESCE(NULLIF(mcp.primary_metal, ''), 'Other') AS name,
             SUM(h.quantity * COALESCE(alp.price, h.avg_cost, 0)) AS value
      FROM public.holdings h
      JOIN public.assets a ON a.id = h.asset_id
      LEFT JOIN public.mining_company_profiles mcp ON mcp.asset_id = a.id
      LEFT JOIN public.asset_latest_prices alp ON alp.instrument_id = a.instrument_id
      WHERE h.portfolio_id = get_portfolio_mining_dashboard.portfolio_id
      GROUP BY 1
    ),
    exposure_by_jurisdiction AS (
      SELECT COALESCE(NULLIF(mcp.jurisdiction, ''), 'Unknown') AS name,
             SUM(h.quantity * COALESCE(alp.price, h.avg_cost, 0)) AS value
      FROM public.holdings h
      JOIN public.assets a ON a.id = h.asset_id
      LEFT JOIN public.mining_company_profiles mcp ON mcp.asset_id = a.id
      LEFT JOIN public.asset_latest_prices alp ON alp.instrument_id = a.instrument_id
      WHERE h.portfolio_id = get_portfolio_mining_dashboard.portfolio_id
      GROUP BY 1
    ),
    stage_breakdown AS (
      SELECT COALESCE(mcp.stage::text, 'explorer') AS stage,
             COUNT(*)::int AS value
      FROM public.holdings h
      JOIN public.assets a ON a.id = h.asset_id
      LEFT JOIN public.mining_company_profiles mcp ON mcp.asset_id = a.id
      WHERE h.portfolio_id = get_portfolio_mining_dashboard.portfolio_id
      GROUP BY 1
    ),
    holdings_view AS (
      SELECT
        a.symbol,
        COALESCE(NULLIF(a.name, ''), a.symbol) AS name,
        COALESCE(mcp.stage::text, 'explorer') AS stage,
        COALESCE(NULLIF(mcp.primary_metal, ''), 'Other') AS metal,
        COALESCE(NULLIF(mcp.jurisdiction, ''), 'Unknown') AS jurisdiction,
        (h.quantity * COALESCE(alp.price, h.avg_cost, 0))::numeric AS position_value,
        CASE
          WHEN lv.total_value IS NULL OR lv.total_value = 0 THEN 0
          ELSE ((h.quantity * COALESCE(alp.price, h.avg_cost, 0)) / lv.total_value)
        END::numeric AS portfolio_weight,
        COALESCE(mvm.valuation_rating, 'N/A') AS ev_oz_rating
      FROM public.holdings h
      JOIN public.assets a ON a.id = h.asset_id
      LEFT JOIN latest_valuation lv ON true
      LEFT JOIN public.mining_company_profiles mcp ON mcp.asset_id = a.id
      LEFT JOIN public.mining_valuation_metrics mvm ON mvm.asset_id = a.id
      LEFT JOIN public.asset_latest_prices alp ON alp.instrument_id = a.instrument_id
      WHERE h.portfolio_id = get_portfolio_mining_dashboard.portfolio_id
    ),
    insights_view AS (
      SELECT title, description,
             CASE
               WHEN lower(COALESCE(severity::text, '')) IN ('critical', 'high') THEN 'high'
               WHEN lower(COALESCE(severity::text, '')) IN ('medium', 'med') THEN 'medium'
               ELSE 'low'
             END AS severity
      FROM public.mining_insights
      WHERE portfolio_id = get_portfolio_mining_dashboard.portfolio_id
      ORDER BY created_at DESC
      LIMIT 20
    ),
    timeline AS (
      SELECT to_char(pv.valuation_date, 'YYYY-MM-DD') AS date,
             COALESCE(pv.total_value, 0) AS value
      FROM public.portfolio_valuations pv
      WHERE pv.portfolio_id = get_portfolio_mining_dashboard.portfolio_id
      ORDER BY pv.valuation_date ASC
      LIMIT 60
    )
    SELECT jsonb_build_object(
      'exposure_by_metal', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'value', value) ORDER BY value DESC) FROM exposure_by_metal), '[]'::jsonb),
      'exposure_by_jurisdiction', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'value', value) ORDER BY value DESC) FROM exposure_by_jurisdiction), '[]'::jsonb),
      'stage_breakdown', COALESCE((SELECT jsonb_agg(jsonb_build_object('stage', stage, 'value', value) ORDER BY value DESC) FROM stage_breakdown), '[]'::jsonb),
      'valuation_summary', jsonb_build_object(
        'portfolio_value', COALESCE((SELECT total_value FROM latest_valuation), 0),
        'daily_change', COALESCE((SELECT total_value FROM latest_valuation), 0) - COALESCE((SELECT total_value FROM previous_valuation), 0),
        'return_30d', COALESCE((SELECT total_return FROM latest_valuation), 0),
        'number_of_holdings', (SELECT COUNT(*) FROM holdings_view),
        'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', date, 'value', value) ORDER BY date ASC) FROM timeline), '[]'::jsonb),
        'deep_value_assets', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('symbol', symbol, 'signal', ev_oz_rating, 'score', CASE WHEN lower(ev_oz_rating) = 'deep value' THEN 100 WHEN lower(ev_oz_rating) = 'value' THEN 80 ELSE 50 END) ORDER BY position_value DESC)
          FROM holdings_view
          WHERE lower(ev_oz_rating) IN ('deep value', 'value')
        ), '[]'::jsonb)
      ),
      'insights', COALESCE((SELECT jsonb_agg(jsonb_build_object('title', title, 'description', description, 'severity', severity)) FROM insights_view), '[]'::jsonb),
      'holdings', COALESCE((SELECT jsonb_agg(jsonb_build_object('symbol', symbol, 'name', name, 'stage', stage, 'metal', metal, 'jurisdiction', jurisdiction, 'position_value', position_value, 'portfolio_weight', portfolio_weight, 'ev_oz_rating', ev_oz_rating) ORDER BY position_value DESC) FROM holdings_view), '[]'::jsonb)
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_portfolio_mining_dashboard(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_portfolio_mining_dashboard(UUID) TO authenticated, service_role;
