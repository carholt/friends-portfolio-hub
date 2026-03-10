-- Mining Intelligence Engine: metadata, classification, valuation, exposures, and insights.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'mining_stage'
      AND n.nspname = 'public'
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
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id)
);

CREATE INDEX IF NOT EXISTS idx_mining_company_profiles_asset_id
  ON public.mining_company_profiles(asset_id);
CREATE INDEX IF NOT EXISTS idx_mining_company_profiles_primary_metal
  ON public.mining_company_profiles(primary_metal);
CREATE INDEX IF NOT EXISTS idx_mining_company_profiles_jurisdiction
  ON public.mining_company_profiles(jurisdiction);
CREATE INDEX IF NOT EXISTS idx_mining_company_profiles_stage
  ON public.mining_company_profiles(stage);

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
  SELECT
    mcp.annual_production_oz,
    mcp.resource_size_oz
  INTO _production, _resource
  FROM public.mining_company_profiles mcp
  WHERE mcp.asset_id = _asset_id;

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

  UPDATE public.mining_company_profiles
  SET stage = _stage
  WHERE asset_id = _asset_id;

  RETURN _stage;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_mining_profile_classification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.stage := CASE
    WHEN NEW.annual_production_oz IS NOT NULL AND NEW.annual_production_oz > 500000 THEN 'major'::public.mining_stage
    WHEN NEW.annual_production_oz IS NOT NULL AND NEW.annual_production_oz >= 100000 THEN 'mid_tier'::public.mining_stage
    WHEN NEW.annual_production_oz IS NOT NULL AND NEW.annual_production_oz > 0 THEN 'producer'::public.mining_stage
    WHEN NEW.resource_size_oz IS NOT NULL AND NEW.resource_size_oz > 0 THEN 'developer'::public.mining_stage
    ELSE 'explorer'::public.mining_stage
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mining_profile_classification ON public.mining_company_profiles;
CREATE TRIGGER trg_mining_profile_classification
  BEFORE INSERT OR UPDATE OF annual_production_oz, resource_size_oz
  ON public.mining_company_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_mining_profile_classification();

CREATE TABLE IF NOT EXISTS public.mining_valuation_metrics (
  asset_id UUID PRIMARY KEY REFERENCES public.assets(id) ON DELETE CASCADE,
  ev_per_ounce NUMERIC,
  price_to_nav NUMERIC,
  cash_flow_multiple NUMERIC,
  resource_multiple NUMERIC,
  valuation_rating TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mining_valuation_metrics_rating
  ON public.mining_valuation_metrics(valuation_rating);

CREATE OR REPLACE FUNCTION public.refresh_mining_valuation_metrics(_asset_id UUID DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.mining_valuation_metrics (
    asset_id,
    ev_per_ounce,
    price_to_nav,
    cash_flow_multiple,
    resource_multiple,
    valuation_rating,
    created_at,
    updated_at
  )
  SELECT
    mcp.asset_id,
    CASE
      WHEN mcp.enterprise_value IS NOT NULL
       AND mcp.resource_size_oz IS NOT NULL
       AND mcp.resource_size_oz <> 0
      THEN mcp.enterprise_value / mcp.resource_size_oz
      ELSE NULL
    END AS ev_per_ounce,
    NULL::NUMERIC AS price_to_nav,
    NULL::NUMERIC AS cash_flow_multiple,
    CASE
      WHEN mcp.market_cap IS NOT NULL
       AND mcp.resource_size_oz IS NOT NULL
       AND mcp.resource_size_oz <> 0
      THEN mcp.market_cap / mcp.resource_size_oz
      ELSE NULL
    END AS resource_multiple,
    CASE
      WHEN mcp.enterprise_value IS NULL OR mcp.resource_size_oz IS NULL OR mcp.resource_size_oz = 0 THEN NULL
      WHEN (mcp.enterprise_value / mcp.resource_size_oz) < 50 THEN 'Deep Value'
      WHEN (mcp.enterprise_value / mcp.resource_size_oz) < 150 THEN 'Value'
      WHEN (mcp.enterprise_value / mcp.resource_size_oz) <= 400 THEN 'Fair'
      ELSE 'Expensive'
    END AS valuation_rating,
    now(),
    now()
  FROM public.mining_company_profiles mcp
  WHERE _asset_id IS NULL OR mcp.asset_id = _asset_id
  ON CONFLICT (asset_id)
  DO UPDATE SET
    ev_per_ounce = EXCLUDED.ev_per_ounce,
    price_to_nav = EXCLUDED.price_to_nav,
    cash_flow_multiple = EXCLUDED.cash_flow_multiple,
    resource_multiple = EXCLUDED.resource_multiple,
    valuation_rating = EXCLUDED.valuation_rating,
    updated_at = now();
$$;

CREATE OR REPLACE FUNCTION public.portfolio_metal_exposure(_portfolio_id UUID)
RETURNS TABLE (
  metal TEXT,
  weight_percent NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_prices AS (
    SELECT DISTINCT ON (asset_id)
      asset_id,
      price
    FROM (
      SELECT ap.asset_id, ap.price, ap.price_date AS ts, ap.created_at
      FROM public.asset_prices ap
      UNION ALL
      SELECT p.asset_id, p.price, p.as_of_date AS ts, p.created_at
      FROM public.prices p
    ) x
    ORDER BY asset_id, ts DESC, created_at DESC
  ),
  positions AS (
    SELECT
      h.asset_id,
      COALESCE(NULLIF(lower(mcp.primary_metal), ''), 'other') AS metal,
      (h.quantity * COALESCE(lp.price, 0)) AS position_value
    FROM public.holdings_v2 h
    LEFT JOIN latest_prices lp ON lp.asset_id = h.asset_id
    LEFT JOIN public.mining_company_profiles mcp ON mcp.asset_id = h.asset_id
    WHERE h.portfolio_id = _portfolio_id
      AND h.quantity <> 0
  ),
  agg AS (
    SELECT
      metal,
      SUM(position_value) AS metal_value
    FROM positions
    GROUP BY metal
  )
  SELECT
    metal,
    ROUND((metal_value / NULLIF(SUM(metal_value) OVER (), 0)) * 100, 2) AS weight_percent
  FROM agg
  WHERE metal_value > 0
  ORDER BY weight_percent DESC;
$$;

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
ON CONFLICT (jurisdiction)
DO UPDATE SET risk_level = EXCLUDED.risk_level;

CREATE OR REPLACE FUNCTION public.portfolio_jurisdiction_risk(_portfolio_id UUID)
RETURNS TABLE (
  low_risk_percent NUMERIC,
  medium_risk_percent NUMERIC,
  high_risk_percent NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_prices AS (
    SELECT DISTINCT ON (asset_id)
      asset_id,
      price
    FROM (
      SELECT ap.asset_id, ap.price, ap.price_date AS ts, ap.created_at
      FROM public.asset_prices ap
      UNION ALL
      SELECT p.asset_id, p.price, p.as_of_date AS ts, p.created_at
      FROM public.prices p
    ) x
    ORDER BY asset_id, ts DESC, created_at DESC
  ),
  positions AS (
    SELECT
      COALESCE(lower(mcp.jurisdiction), 'unknown') AS jurisdiction,
      (h.quantity * COALESCE(lp.price, 0)) AS position_value
    FROM public.holdings_v2 h
    LEFT JOIN latest_prices lp ON lp.asset_id = h.asset_id
    LEFT JOIN public.mining_company_profiles mcp ON mcp.asset_id = h.asset_id
    WHERE h.portfolio_id = _portfolio_id
      AND h.quantity <> 0
  ),
  scored AS (
    SELECT
      COALESCE(jrs.risk_level, 'medium') AS risk_level,
      SUM(p.position_value) AS risk_value
    FROM positions p
    LEFT JOIN public.jurisdiction_risk_scores jrs
      ON jrs.jurisdiction = p.jurisdiction
    GROUP BY COALESCE(jrs.risk_level, 'medium')
  ),
  totals AS (
    SELECT COALESCE(SUM(risk_value), 0) AS total_value
    FROM scored
  )
  SELECT
    ROUND(COALESCE((SELECT risk_value FROM scored WHERE risk_level = 'low'), 0) / NULLIF(t.total_value, 0) * 100, 2) AS low_risk_percent,
    ROUND(COALESCE((SELECT risk_value FROM scored WHERE risk_level = 'medium'), 0) / NULLIF(t.total_value, 0) * 100, 2) AS medium_risk_percent,
    ROUND(COALESCE((SELECT risk_value FROM scored WHERE risk_level = 'high'), 0) / NULLIF(t.total_value, 0) * 100, 2) AS high_risk_percent
  FROM totals t;
$$;

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

CREATE INDEX IF NOT EXISTS idx_mining_insights_portfolio_created
  ON public.mining_insights(portfolio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mining_insights_type
  ON public.mining_insights(insight_type);

CREATE OR REPLACE FUNCTION public.generate_portfolio_mining_insights(_portfolio_id UUID)
RETURNS SETOF public.mining_insights
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _silver_weight NUMERIC := 0;
  _top_jurisdiction TEXT;
  _top_jurisdiction_weight NUMERIC := 0;
BEGIN
  PERFORM public.refresh_mining_valuation_metrics(NULL);

  SELECT COALESCE(weight_percent, 0)
  INTO _silver_weight
  FROM public.portfolio_metal_exposure(_portfolio_id)
  WHERE metal = 'silver';

  WITH latest_prices AS (
    SELECT DISTINCT ON (asset_id)
      asset_id,
      price
    FROM (
      SELECT ap.asset_id, ap.price, ap.price_date AS ts, ap.created_at
      FROM public.asset_prices ap
      UNION ALL
      SELECT p.asset_id, p.price, p.as_of_date AS ts, p.created_at
      FROM public.prices p
    ) x
    ORDER BY asset_id, ts DESC, created_at DESC
  ),
  exposure AS (
    SELECT
      COALESCE(lower(mcp.jurisdiction), 'unknown') AS jurisdiction,
      SUM(h.quantity * COALESCE(lp.price, 0)) AS position_value
    FROM public.holdings_v2 h
    LEFT JOIN latest_prices lp ON lp.asset_id = h.asset_id
    LEFT JOIN public.mining_company_profiles mcp ON mcp.asset_id = h.asset_id
    WHERE h.portfolio_id = _portfolio_id
      AND h.quantity <> 0
    GROUP BY COALESCE(lower(mcp.jurisdiction), 'unknown')
  ),
  ranked AS (
    SELECT
      jurisdiction,
      position_value,
      (position_value / NULLIF(SUM(position_value) OVER (), 0)) * 100 AS pct
    FROM exposure
  )
  SELECT jurisdiction, COALESCE(pct, 0)
  INTO _top_jurisdiction, _top_jurisdiction_weight
  FROM ranked
  ORDER BY pct DESC NULLS LAST
  LIMIT 1;

  IF _silver_weight > 70 THEN
    INSERT INTO public.mining_insights (portfolio_id, insight_type, title, description, severity)
    VALUES (
      _portfolio_id,
      'metal_exposure',
      'High Silver Leverage',
      format('Silver accounts for %s%% of mining exposure, increasing sensitivity to silver price volatility.', ROUND(_silver_weight, 2)),
      CASE WHEN _silver_weight >= 85 THEN 'high' ELSE 'medium' END
    )
    ON CONFLICT (portfolio_id, insight_type, title)
    DO UPDATE SET
      description = EXCLUDED.description,
      severity = EXCLUDED.severity,
      created_at = now();
  END IF;

  IF _top_jurisdiction_weight > 50 AND _top_jurisdiction IS NOT NULL THEN
    INSERT INTO public.mining_insights (portfolio_id, insight_type, title, description, severity)
    VALUES (
      _portfolio_id,
      'jurisdiction_risk',
      'Jurisdiction Concentration Risk',
      format('%s%% of mining holdings are concentrated in %s.', ROUND(_top_jurisdiction_weight, 2), initcap(_top_jurisdiction)),
      CASE WHEN _top_jurisdiction_weight >= 70 THEN 'high' ELSE 'medium' END
    )
    ON CONFLICT (portfolio_id, insight_type, title)
    DO UPDATE SET
      description = EXCLUDED.description,
      severity = EXCLUDED.severity,
      created_at = now();
  END IF;

  INSERT INTO public.mining_insights (portfolio_id, insight_type, title, description, severity)
  SELECT
    _portfolio_id,
    'valuation',
    'Potential Deep Value Opportunity',
    format('%s trades at EV/oz %.2f, below the deep value threshold.', a.symbol, mvm.ev_per_ounce),
    'low'
  FROM public.holdings_v2 h
  JOIN public.assets a ON a.id = h.asset_id
  JOIN public.mining_valuation_metrics mvm ON mvm.asset_id = h.asset_id
  WHERE h.portfolio_id = _portfolio_id
    AND h.quantity <> 0
    AND mvm.ev_per_ounce < 50
  ON CONFLICT (portfolio_id, insight_type, title)
  DO UPDATE SET
    description = EXCLUDED.description,
    severity = EXCLUDED.severity,
    created_at = now();

  RETURN QUERY
  SELECT mi.*
  FROM public.mining_insights mi
  WHERE mi.portfolio_id = _portfolio_id
  ORDER BY mi.created_at DESC;
END;
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
      SELECT ap.asset_id, ap.price, ap.price_date AS ts, ap.created_at
      FROM public.asset_prices ap
      UNION ALL
      SELECT p.asset_id, p.price, p.as_of_date AS ts, p.created_at
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
      mvm.ev_per_ounce,
      mvm.valuation_rating
    FROM public.holdings_v2 h
    LEFT JOIN latest_prices lp ON lp.asset_id = h.asset_id
    LEFT JOIN public.mining_company_profiles mcp ON mcp.asset_id = h.asset_id
    LEFT JOIN public.mining_valuation_metrics mvm ON mvm.asset_id = h.asset_id
    WHERE h.portfolio_id = _portfolio_id
      AND h.quantity <> 0
  ),
  metal_exposure AS (
    SELECT
      metal,
      ROUND((SUM(position_value) / NULLIF(SUM(SUM(position_value)) OVER (), 0)) * 100, 2) AS weight_percent
    FROM positions
    GROUP BY metal
  ),
  jurisdiction_exposure AS (
    SELECT
      jurisdiction,
      ROUND((SUM(position_value) / NULLIF(SUM(SUM(position_value)) OVER (), 0)) * 100, 2) AS weight_percent
    FROM positions
    GROUP BY jurisdiction
  ),
  stage_breakdown AS (
    SELECT
      stage,
      COUNT(*)::INT AS holdings_count,
      ROUND((SUM(position_value) / NULLIF(SUM(SUM(position_value)) OVER (), 0)) * 100, 2) AS weight_percent
    FROM positions
    GROUP BY stage
  ),
  valuation_summary AS (
    SELECT jsonb_build_object(
      'avg_ev_per_ounce', ROUND(AVG(ev_per_ounce), 2),
      'deep_value_count', COUNT(*) FILTER (WHERE ev_per_ounce < 50),
      'value_count', COUNT(*) FILTER (WHERE ev_per_ounce >= 50 AND ev_per_ounce < 150),
      'fair_count', COUNT(*) FILTER (WHERE ev_per_ounce >= 150 AND ev_per_ounce <= 400),
      'expensive_count', COUNT(*) FILTER (WHERE ev_per_ounce > 400)
    ) AS summary
    FROM positions
    WHERE ev_per_ounce IS NOT NULL
  )
  SELECT jsonb_build_object(
    'exposure_by_metal', COALESCE((SELECT jsonb_agg(to_jsonb(me) ORDER BY me.weight_percent DESC) FROM metal_exposure me), '[]'::jsonb),
    'exposure_by_jurisdiction', COALESCE((SELECT jsonb_agg(to_jsonb(je) ORDER BY je.weight_percent DESC) FROM jurisdiction_exposure je), '[]'::jsonb),
    'stage_breakdown', COALESCE((SELECT jsonb_agg(to_jsonb(sb) ORDER BY sb.weight_percent DESC) FROM stage_breakdown sb), '[]'::jsonb),
    'valuation_summary', COALESCE((SELECT summary FROM valuation_summary), '{}'::jsonb),
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

ALTER TABLE public.mining_company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mining_valuation_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jurisdiction_risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mining_insights ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mining_company_profiles' AND policyname = 'Mining company profiles readable by all'
  ) THEN
    CREATE POLICY "Mining company profiles readable by all"
      ON public.mining_company_profiles
      FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mining_company_profiles' AND policyname = 'Mining company profiles writable by authenticated'
  ) THEN
    CREATE POLICY "Mining company profiles writable by authenticated"
      ON public.mining_company_profiles
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mining_valuation_metrics' AND policyname = 'Mining valuation metrics readable by all'
  ) THEN
    CREATE POLICY "Mining valuation metrics readable by all"
      ON public.mining_valuation_metrics
      FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'jurisdiction_risk_scores' AND policyname = 'Jurisdiction risk scores readable by all'
  ) THEN
    CREATE POLICY "Jurisdiction risk scores readable by all"
      ON public.jurisdiction_risk_scores
      FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mining_insights' AND policyname = 'Mining insights visible by portfolio access'
  ) THEN
    CREATE POLICY "Mining insights visible by portfolio access"
      ON public.mining_insights
      FOR SELECT
      USING (public.can_view_portfolio(portfolio_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mining_insights' AND policyname = 'Mining insights writable by portfolio owner'
  ) THEN
    CREATE POLICY "Mining insights writable by portfolio owner"
      ON public.mining_insights
      FOR ALL
      TO authenticated
      USING (public.owns_portfolio(portfolio_id))
      WITH CHECK (public.owns_portfolio(portfolio_id));
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.classify_mining_company(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_mining_valuation_metrics(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portfolio_metal_exposure(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portfolio_jurisdiction_risk(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_portfolio_mining_insights(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_portfolio_mining_snapshot(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_portfolio_mining_dashboard(UUID) TO authenticated, service_role;
