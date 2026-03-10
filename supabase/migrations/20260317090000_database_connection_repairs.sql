-- Repair migration for environments that are missing newer DB objects/RPCs.
-- Keeps everything idempotent and backwards compatible.

-- 1) Compatibility shims for schemas that only have `holdings`/`prices`.
DO $$
BEGIN
  IF to_regclass('public.holdings_v2') IS NULL AND to_regclass('public.holdings') IS NOT NULL THEN
    EXECUTE $v$
      CREATE VIEW public.holdings_v2 AS
      SELECT
        h.id,
        h.portfolio_id,
        h.asset_id,
        h.quantity,
        h.avg_cost,
        h.cost_currency,
        h.created_at,
        h.updated_at
      FROM public.holdings h
    $v$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.asset_prices') IS NULL AND to_regclass('public.prices') IS NOT NULL THEN
    EXECUTE $v$
      CREATE VIEW public.asset_prices AS
      SELECT
        p.id,
        p.asset_id,
        p.price,
        p.as_of_date::date AS price_date,
        p.created_at
      FROM public.prices p
    $v$;
  END IF;
END $$;

-- 2) Backfill commonly missing company_metrics columns in older DBs.
ALTER TABLE IF EXISTS public.company_metrics
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS source_title TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 3) Mining engine core objects.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'mining_stage'
  ) THEN
    CREATE TYPE public.mining_stage AS ENUM (
      'explorer',
      'developer',
      'near_term_producer',
      'producer',
      'mid_tier',
      'major'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.mining_company_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL UNIQUE REFERENCES public.assets(id) ON DELETE CASCADE,
  primary_metal TEXT,
  secondary_metals TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  jurisdiction TEXT,
  stage public.mining_stage NOT NULL DEFAULT 'explorer',
  market_cap NUMERIC,
  enterprise_value NUMERIC,
  annual_production_oz NUMERIC,
  resource_size_oz NUMERIC,
  all_in_sustaining_cost NUMERIC,
  mine_life_years NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mining_valuation_metrics (
  asset_id UUID PRIMARY KEY REFERENCES public.assets(id) ON DELETE CASCADE,
  ev_per_ounce NUMERIC,
  valuation_rating TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jurisdiction_risk_scores (
  jurisdiction TEXT PRIMARY KEY,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.jurisdiction_risk_scores (jurisdiction, risk_level)
VALUES
  ('canada', 'low'),
  ('usa', 'low'),
  ('mexico', 'medium'),
  ('peru', 'medium'),
  ('morocco', 'medium'),
  ('bolivia', 'high')
ON CONFLICT (jurisdiction) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.mining_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, insight_type, title)
);

CREATE OR REPLACE FUNCTION public.classify_mining_company(_asset_id UUID)
RETURNS public.mining_stage
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _production NUMERIC;
  _resource NUMERIC;
  _stage public.mining_stage;
BEGIN
  SELECT annual_production_oz, resource_size_oz
  INTO _production, _resource
  FROM public.mining_company_profiles
  WHERE asset_id = _asset_id;

  IF _production IS NOT NULL AND _production > 500000 THEN
    _stage := 'major';
  ELSIF _production IS NOT NULL AND _production >= 100000 THEN
    _stage := 'mid_tier';
  ELSIF _production IS NOT NULL AND _production > 0 THEN
    _stage := 'producer';
  ELSIF _resource IS NOT NULL AND _resource > 0 THEN
    _stage := 'developer';
  ELSE
    _stage := 'explorer';
  END IF;

  UPDATE public.mining_company_profiles SET stage = _stage WHERE asset_id = _asset_id;
  RETURN _stage;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_mining_valuation_metrics(_asset_id UUID DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.mining_valuation_metrics (asset_id, ev_per_ounce, valuation_rating, created_at, updated_at)
  SELECT
    mcp.asset_id,
    CASE
      WHEN mcp.enterprise_value IS NOT NULL AND mcp.resource_size_oz IS NOT NULL AND mcp.resource_size_oz <> 0
      THEN mcp.enterprise_value / mcp.resource_size_oz
      ELSE NULL
    END,
    CASE
      WHEN mcp.enterprise_value IS NULL OR mcp.resource_size_oz IS NULL OR mcp.resource_size_oz = 0 THEN NULL
      WHEN (mcp.enterprise_value / mcp.resource_size_oz) < 50 THEN 'Deep Value'
      WHEN (mcp.enterprise_value / mcp.resource_size_oz) < 150 THEN 'Value'
      WHEN (mcp.enterprise_value / mcp.resource_size_oz) <= 400 THEN 'Fair'
      ELSE 'Expensive'
    END,
    now(),
    now()
  FROM public.mining_company_profiles mcp
  WHERE _asset_id IS NULL OR mcp.asset_id = _asset_id
  ON CONFLICT (asset_id)
  DO UPDATE SET
    ev_per_ounce = EXCLUDED.ev_per_ounce,
    valuation_rating = EXCLUDED.valuation_rating,
    updated_at = now();
$$;

CREATE OR REPLACE FUNCTION public.refresh_portfolio_mining_snapshot(_portfolio_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _asset_id UUID;
BEGIN
  FOR _asset_id IN
    SELECT DISTINCT h.asset_id
    FROM public.holdings_v2 h
    WHERE h.portfolio_id = _portfolio_id
      AND h.quantity <> 0
  LOOP
    PERFORM public.classify_mining_company(_asset_id);
  END LOOP;

  PERFORM public.refresh_mining_valuation_metrics(NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_portfolio_mining_dashboard(_portfolio_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_prices AS (
    SELECT DISTINCT ON (asset_id)
      asset_id,
      price
    FROM (
      SELECT ap.asset_id, ap.price, ap.price_date::timestamp AS ts, ap.created_at
      FROM public.asset_prices ap
      UNION ALL
      SELECT p.asset_id, p.price, p.as_of_date::timestamp AS ts, p.created_at
      FROM public.prices p
    ) x
    ORDER BY asset_id, ts DESC, created_at DESC
  ),
  positions AS (
    SELECT
      h.asset_id,
      h.quantity,
      COALESCE(lp.price, 0) AS price,
      h.quantity * COALESCE(lp.price, 0) AS position_value,
      COALESCE(NULLIF(lower(mcp.primary_metal), ''), 'other') AS metal,
      COALESCE(NULLIF(lower(mcp.jurisdiction), ''), 'unknown') AS jurisdiction,
      COALESCE(mcp.stage::TEXT, 'explorer') AS stage,
      mvm.ev_per_ounce
    FROM public.holdings_v2 h
    LEFT JOIN latest_prices lp ON lp.asset_id = h.asset_id
    LEFT JOIN public.mining_company_profiles mcp ON mcp.asset_id = h.asset_id
    LEFT JOIN public.mining_valuation_metrics mvm ON mvm.asset_id = h.asset_id
    WHERE h.portfolio_id = _portfolio_id
      AND h.quantity <> 0
  )
  SELECT jsonb_build_object(
    'exposure_by_metal', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('metal', metal, 'weight_percent', ROUND((SUM(position_value) / NULLIF(SUM(SUM(position_value)) OVER (), 0)) * 100, 2)) ORDER BY ROUND((SUM(position_value) / NULLIF(SUM(SUM(position_value)) OVER (), 0)) * 100, 2) DESC)
      FROM positions GROUP BY metal
    ), '[]'::jsonb),
    'exposure_by_jurisdiction', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('jurisdiction', jurisdiction, 'weight_percent', ROUND((SUM(position_value) / NULLIF(SUM(SUM(position_value)) OVER (), 0)) * 100, 2)) ORDER BY ROUND((SUM(position_value) / NULLIF(SUM(SUM(position_value)) OVER (), 0)) * 100, 2) DESC)
      FROM positions GROUP BY jurisdiction
    ), '[]'::jsonb),
    'stage_breakdown', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('stage', stage, 'holdings_count', COUNT(*)::INT, 'weight_percent', ROUND((SUM(position_value) / NULLIF(SUM(SUM(position_value)) OVER (), 0)) * 100, 2)) ORDER BY ROUND((SUM(position_value) / NULLIF(SUM(SUM(position_value)) OVER (), 0)) * 100, 2) DESC)
      FROM positions GROUP BY stage
    ), '[]'::jsonb),
    'valuation_summary', COALESCE((
      SELECT jsonb_build_object(
        'avg_ev_per_ounce', ROUND(AVG(ev_per_ounce), 2),
        'deep_value_count', COUNT(*) FILTER (WHERE ev_per_ounce < 50),
        'value_count', COUNT(*) FILTER (WHERE ev_per_ounce >= 50 AND ev_per_ounce < 150),
        'fair_count', COUNT(*) FILTER (WHERE ev_per_ounce >= 150 AND ev_per_ounce <= 400),
        'expensive_count', COUNT(*) FILTER (WHERE ev_per_ounce > 400)
      )
      FROM positions WHERE ev_per_ounce IS NOT NULL
    ), '{}'::jsonb),
    'insights', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'insight_type', mi.insight_type,
          'title', mi.title,
          'description', mi.description,
          'severity', mi.severity,
          'created_at', mi.created_at
        )
        ORDER BY mi.created_at DESC
      )
      FROM public.mining_insights mi
      WHERE mi.portfolio_id = _portfolio_id
    ), '[]'::jsonb)
  );
$$;

-- 4) Missing RPCs referenced by frontend.
CREATE OR REPLACE FUNCTION public.analyze_portfolio(portfolio_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_prices AS (
    SELECT DISTINCT ON (asset_id)
      asset_id,
      price
    FROM public.prices
    ORDER BY asset_id, as_of_date DESC, created_at DESC
  ),
  positions AS (
    SELECT
      h.asset_id,
      (h.quantity * COALESCE(lp.price, 0)) AS value
    FROM public.holdings h
    LEFT JOIN latest_prices lp ON lp.asset_id = h.asset_id
    WHERE h.portfolio_id = analyze_portfolio.portfolio_id
      AND h.quantity <> 0
  ),
  totals AS (
    SELECT COALESCE(SUM(value), 0) AS total_value, COUNT(*)::INT AS holdings_count FROM positions
  ),
  weights AS (
    SELECT
      value / NULLIF((SELECT total_value FROM totals), 0) AS w
    FROM positions
    WHERE value > 0
  ),
  hhi AS (
    SELECT COALESCE(SUM(w * w), 1) AS concentration FROM weights
  )
  SELECT jsonb_build_object(
    'diversification', ROUND((1 - LEAST((SELECT concentration FROM hhi), 1)) * 100, 2),
    'risk_rating', CASE
      WHEN (SELECT concentration FROM hhi) > 0.35 THEN 'high'
      WHEN (SELECT concentration FROM hhi) > 0.2 THEN 'medium'
      ELSE 'low'
    END,
    'recommendations', to_jsonb(ARRAY[
      CASE WHEN (SELECT holdings_count FROM totals) < 5 THEN 'Öka antalet innehav för bättre diversifiering.' ELSE 'Diversifieringsnivån ser stabil ut.' END,
      'Granska regelbundet positionernas viktning mot din riskprofil.',
      'Säkerställ att likviditetsbehov och tidshorisont matchar portföljens sammansättning.'
    ])
  );
$$;

CREATE OR REPLACE FUNCTION public.ai_scan_companies(checklist JSONB DEFAULT '[]'::jsonb)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'status', 'ok',
    'message', 'AI bolagsscanning är inte fullaktiverad än. RPC finns nu för stabil appkoppling.',
    'checklist', COALESCE(checklist, '[]'::jsonb),
    'results', '[]'::jsonb
  );
$$;

GRANT EXECUTE ON FUNCTION public.classify_mining_company(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_mining_valuation_metrics(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_portfolio_mining_snapshot(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_portfolio_mining_dashboard(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.analyze_portfolio(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_scan_companies(JSONB) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
