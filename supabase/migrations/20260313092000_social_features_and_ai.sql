-- Portfolio privacy extension, social comparison RPCs, AI scan RPCs, symbol aliases, and performance indexes.

ALTER TYPE public.portfolio_visibility ADD VALUE IF NOT EXISTS 'friends';

CREATE OR REPLACE FUNCTION public.can_access_portfolio(_portfolio_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.portfolios AS p
    WHERE p.id = _portfolio_id
      AND (
        p.owner_user_id = auth.uid()
        OR p.visibility = 'public'
        OR (p.visibility = 'authenticated' AND auth.uid() IS NOT NULL)
        OR (
          p.visibility = 'group'
          AND p.group_id IS NOT NULL
          AND public.is_group_member(auth.uid(), p.group_id)
        )
        OR (
          p.visibility = 'friends'
          AND auth.uid() IS NOT NULL
          AND public.are_friends(p.owner_user_id, auth.uid())
        )
      )
  );
$function$;

DROP POLICY IF EXISTS "portfolios_read_via_visibility" ON public.portfolios;
CREATE POLICY "portfolios_read_via_visibility"
ON public.portfolios
FOR SELECT
TO anon, authenticated
USING (
  owner_user_id = auth.uid()
  OR visibility = 'public'
  OR (visibility = 'authenticated' AND auth.uid() IS NOT NULL)
  OR (visibility = 'group' AND group_id IS NOT NULL AND public.is_group_member(auth.uid(), group_id))
  OR (visibility = 'friends' AND auth.uid() IS NOT NULL AND public.are_friends(owner_user_id, auth.uid()))
);

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
  concentration AS (
    SELECT
      pv.portfolio_id,
      MAX(pv.position_value / NULLIF(SUM(pv.position_value) OVER (PARTITION BY pv.portfolio_id), 0)) AS max_weight
    FROM position_values pv
    GROUP BY pv.portfolio_id
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

CREATE OR REPLACE FUNCTION public.get_group_leaderboard(group_id UUID, "limit" INT DEFAULT 50)
RETURNS TABLE (
  portfolio_id UUID,
  portfolio_name TEXT,
  owner TEXT,
  total_value NUMERIC,
  return_pct NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH in_group AS (
    SELECT p.id, p.name, p.owner_user_id
    FROM public.portfolios p
    WHERE p.group_id = get_group_leaderboard.group_id
      AND public.can_view_portfolio(p.id)
  ),
  latest_vals AS (
    SELECT DISTINCT ON (v.portfolio_id)
      v.portfolio_id,
      v.total_value,
      v.total_cost,
      v.total_return
    FROM public.portfolio_valuations v
    JOIN in_group g ON g.id = v.portfolio_id
    ORDER BY v.portfolio_id, v.valuation_date DESC, v.created_at DESC
  )
  SELECT
    g.id AS portfolio_id,
    g.name AS portfolio_name,
    COALESCE(pr.display_name, 'Unknown') AS owner,
    COALESCE(v.total_value, 0) AS total_value,
    CASE WHEN COALESCE(v.total_cost, 0) > 0 THEN (COALESCE(v.total_return, 0) / v.total_cost) * 100 ELSE 0 END AS return_pct
  FROM in_group g
  LEFT JOIN latest_vals v ON v.portfolio_id = g.id
  LEFT JOIN public.profiles pr ON pr.user_id = g.owner_user_id
  ORDER BY return_pct DESC NULLS LAST
  LIMIT GREATEST(COALESCE("limit", 50), 1);
$$;

ALTER TABLE public.company_ai_reports
  ADD COLUMN IF NOT EXISTS symbol TEXT,
  ADD COLUMN IF NOT EXISTS analysis_json JSONB,
  ADD COLUMN IF NOT EXISTS score NUMERIC,
  ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_company_ai_reports_symbol_generated
  ON public.company_ai_reports(symbol, generated_at DESC);

CREATE OR REPLACE FUNCTION public.ai_scan_companies(checklist JSONB)
RETURNS TABLE (
  symbol TEXT,
  analysis_json JSONB,
  score NUMERIC,
  generated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH latest_metrics AS (
    SELECT DISTINCT ON (c.id, cm.metric_key)
      c.id AS company_id,
      c.canonical_symbol,
      cm.metric_key,
      cm.value_number
    FROM public.companies c
    LEFT JOIN public.company_metrics cm ON cm.company_id = c.id
    ORDER BY c.id, cm.metric_key, cm.as_of_date DESC, cm.created_at DESC
  ),
  scored AS (
    SELECT
      lm.canonical_symbol AS symbol,
      jsonb_build_object(
        'checklist', checklist,
        'notes', 'Rule-based Sanders prefilter (AI enrichment can post-process this output).'
      ) AS analysis_json,
      (
        CASE WHEN COALESCE((checklist->>'revenue_growth') <> '', false) THEN 20 ELSE 0 END
        + CASE WHEN COALESCE((checklist->>'debt_to_equity') <> '', false) THEN 20 ELSE 0 END
        + CASE WHEN COALESCE((checklist->>'sector') <> '', false) THEN 20 ELSE 0 END
        + 40
      )::NUMERIC AS score,
      now() AS generated_at
    FROM latest_metrics lm
    GROUP BY lm.canonical_symbol
  )
  SELECT *
  FROM scored
  ORDER BY score DESC, symbol ASC;
$$;

CREATE OR REPLACE FUNCTION public.analyze_portfolio(portfolio_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH latest_prices AS (
    SELECT DISTINCT ON (p.asset_id) p.asset_id, p.price
    FROM public.prices p
    ORDER BY p.asset_id, p.price_date DESC, p.created_at DESC
  ),
  pv AS (
    SELECT
      h.asset_id,
      a.symbol,
      COALESCE(a.asset_type::TEXT, 'unknown') AS sector,
      (h.quantity * COALESCE(lp.price, 0)) AS position_value
    FROM public.holdings h
    JOIN public.assets a ON a.id = h.asset_id
    LEFT JOIN latest_prices lp ON lp.asset_id = h.asset_id
    WHERE h.portfolio_id = analyze_portfolio.portfolio_id
      AND public.can_view_portfolio(h.portfolio_id)
      AND h.quantity > 0
  ),
  weights AS (
    SELECT
      symbol,
      sector,
      position_value,
      position_value / NULLIF(SUM(position_value) OVER (), 0) AS weight
    FROM pv
  ),
  stats AS (
    SELECT
      COUNT(*)::INT AS holdings_count,
      COALESCE(MAX(weight), 0) AS max_weight,
      COALESCE(SUM(weight * weight), 0) AS hhi
    FROM weights
  )
  SELECT jsonb_build_object(
    'diversification', ROUND((100 - LEAST(100, s.hhi * 100))::NUMERIC, 2),
    'sector_concentration', CASE WHEN s.max_weight > 0.35 THEN 'high' WHEN s.max_weight > 0.2 THEN 'medium' ELSE 'low' END,
    'risk_rating', CASE WHEN s.max_weight > 0.45 THEN 'high' WHEN s.max_weight > 0.25 THEN 'medium' ELSE 'low' END,
    'recommendations', jsonb_build_array(
      CASE WHEN s.max_weight > 0.35 THEN 'Reduce concentration in your largest position' ELSE 'Concentration is within target range' END,
      'Add uncorrelated holdings to improve diversification',
      'Review currency and geographic exposure before adding new positions'
    )
  )
  FROM stats s;
$$;

CREATE TABLE IF NOT EXISTS public.symbol_aliases (
  raw_symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  canonical_symbol TEXT NOT NULL,
  price_symbol TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (raw_symbol, exchange)
);

CREATE INDEX IF NOT EXISTS idx_symbol_aliases_canonical ON public.symbol_aliases(canonical_symbol);

ALTER TABLE public.symbol_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "symbol_aliases_public_read" ON public.symbol_aliases;
CREATE POLICY "symbol_aliases_public_read"
ON public.symbol_aliases
FOR SELECT
TO anon, authenticated
USING (true);

GRANT SELECT ON public.symbol_aliases TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compare_portfolios(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_leaderboard(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_scan_companies(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analyze_portfolio(UUID) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_holdings_portfolio_asset ON public.holdings(portfolio_id, asset_id);
CREATE INDEX IF NOT EXISTS idx_transactions_portfolio_traded_at_desc ON public.transactions(portfolio_id, traded_at DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_valuations_portfolio_valuation_date_desc ON public.portfolio_valuations(portfolio_id, valuation_date DESC);

ALTER TABLE public.portfolios DROP CONSTRAINT IF EXISTS portfolios_broker_allowed;
ALTER TABLE public.portfolios
  ADD CONSTRAINT portfolios_broker_allowed
  CHECK (broker IN ('manual', 'avanza', 'nordea', 'interactive_brokers', 'degiro', 'vera_cash', 'binance'));
