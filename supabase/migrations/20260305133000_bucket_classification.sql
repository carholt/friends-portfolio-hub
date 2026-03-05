-- Automatic bucket classification with manual overrides + seeded map.

ALTER TABLE public.asset_research
  ADD COLUMN IF NOT EXISTS bucket_override TEXT,
  ADD COLUMN IF NOT EXISTS bucket_computed TEXT NOT NULL DEFAULT 'Unclassified',
  ADD COLUMN IF NOT EXISTS bucket_confidence NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bucket_reason TEXT;

UPDATE public.asset_research
SET bucket_override = bucket
WHERE bucket IS NOT NULL
  AND NULLIF(trim(bucket), '') IS NOT NULL
  AND (bucket_override IS NULL OR NULLIF(trim(bucket_override), '') IS NULL);

ALTER TABLE public.asset_research DROP COLUMN IF EXISTS bucket;

CREATE TABLE IF NOT EXISTS public.asset_bucket_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  exchange_code TEXT,
  bucket TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'seed',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(symbol, exchange_code)
);

CREATE INDEX IF NOT EXISTS idx_asset_bucket_map_symbol ON public.asset_bucket_map(symbol);
CREATE INDEX IF NOT EXISTS idx_asset_bucket_map_symbol_exchange ON public.asset_bucket_map(symbol, exchange_code);

ALTER TABLE public.asset_bucket_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Asset bucket map readable by all" ON public.asset_bucket_map;
CREATE POLICY "Asset bucket map readable by all" ON public.asset_bucket_map FOR SELECT USING (true);

WITH seed(symbol, bucket) AS (
  VALUES
    ('B', 'Major Producer'),
    ('KGC', 'Major Producer'),
    ('NEM', 'Major Producer'),
    ('AYA', 'Mid Tier Producer'),
    ('ASM', 'Mid Tier Producer'),
    ('AG', 'Mid Tier Producer'),
    ('GMIN', 'Mid Tier Producer'),
    ('PAAS', 'Mid Tier Producer'),
    ('CDE', 'Mid Tier Producer'),
    ('HE', 'Mid Tier Producer'),
    ('EXK', 'Mid Tier Producer'),
    ('JAG', 'Mid Tier Producer'),
    ('USA', 'Junior Producer'),
    ('TSK', 'Junior Producer'),
    ('AGX', 'Junior Producer'),
    ('GSVR', 'Junior Producer'),
    ('SCZ', 'Junior Producer'),
    ('BCM', 'Junior Producer'),
    ('EXN', 'Near Term Producer'),
    ('VZLA', 'Near Term Producer'),
    ('AGMR', 'Near Term Producer'),
    ('GRSL', 'Near Term Producer'),
    ('SSV', 'Late Stage Developer'),
    ('LG', 'Late Stage Developer'),
    ('1911', 'Late Stage Developer'),
    ('ABRA', 'Late Stage Developer'),
    ('NEXG', 'Late Stage Developer'),
    ('CKG', 'Late Stage Developer'),
    ('APGO', 'Late Stage Developer'),
    ('TUD', 'Late Stage Developer'),
    ('WGO', 'Late Stage Developer'),
    ('SIG', 'Early Stage Explorer'),
    ('SKP', 'Early Stage Explorer'),
    ('HAMR', 'Early Stage Explorer')
)
INSERT INTO public.asset_bucket_map(symbol, exchange_code, bucket, source)
SELECT symbol, NULL, bucket, 'seed'
FROM seed
ON CONFLICT (symbol, exchange_code)
DO UPDATE SET bucket = EXCLUDED.bucket, source = EXCLUDED.source, updated_at = now();

CREATE OR REPLACE FUNCTION public.refresh_asset_research(_portfolio_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_bucket TEXT;
  v_confidence NUMERIC;
  v_reason TEXT;
  v_market_cap NUMERIC;
  v_revenue NUMERIC;
  v_resource_estimate NUMERIC;
  v_stage TEXT;
BEGIN
  IF _portfolio_id IS NULL THEN
    RAISE EXCEPTION 'portfolio id is required';
  END IF;

  -- Ensure a research row exists for all assets in holdings.
  INSERT INTO public.asset_research (portfolio_id, asset_id)
  SELECT h.portfolio_id, h.asset_id
  FROM public.holdings h
  WHERE h.portfolio_id = _portfolio_id
  ON CONFLICT (portfolio_id, asset_id) DO NOTHING;

  FOR r IN
    SELECT ar.id, ar.bucket_override, ar.assumptions, a.symbol, a.exchange_code
    FROM public.asset_research ar
    JOIN public.assets a ON a.id = ar.asset_id
    WHERE ar.portfolio_id = _portfolio_id
  LOOP
    v_bucket := NULL;
    v_confidence := 0;
    v_reason := NULL;

    IF NULLIF(trim(coalesce(r.bucket_override, '')), '') IS NOT NULL THEN
      v_bucket := trim(r.bucket_override);
      v_confidence := 1.0;
      v_reason := 'Manual override';
    ELSE
      SELECT abm.bucket, 0.95, 'Seeded mapping (symbol + exchange)'
      INTO v_bucket, v_confidence, v_reason
      FROM public.asset_bucket_map abm
      WHERE upper(abm.symbol) = upper(r.symbol)
        AND upper(coalesce(abm.exchange_code, '')) = upper(coalesce(r.exchange_code, ''))
      LIMIT 1;

      IF v_bucket IS NULL THEN
        SELECT abm.bucket, 0.85, 'Seeded mapping (symbol only)'
        INTO v_bucket, v_confidence, v_reason
        FROM public.asset_bucket_map abm
        WHERE upper(abm.symbol) = upper(r.symbol)
          AND abm.exchange_code IS NULL
        LIMIT 1;
      END IF;

      IF v_bucket IS NULL THEN
        v_market_cap := NULLIF(r.assumptions->>'market_cap', '')::NUMERIC;
        v_revenue := NULLIF(r.assumptions->>'revenue', '')::NUMERIC;
        v_resource_estimate := NULLIF(r.assumptions->>'resource_estimate', '')::NUMERIC;
        v_stage := lower(trim(coalesce(r.assumptions->>'stage', '')));

        IF v_market_cap IS NOT NULL AND v_revenue IS NOT NULL AND v_revenue > 0 THEN
          IF v_market_cap >= 10000000000 THEN
            v_bucket := 'Major Producer';
            v_confidence := 0.7;
            v_reason := 'Heuristic: market cap >= 10B and revenue > 0';
          ELSIF v_market_cap >= 2000000000 THEN
            v_bucket := 'Mid Tier Producer';
            v_confidence := 0.65;
            v_reason := 'Heuristic: market cap 2B..10B and revenue > 0';
          ELSE
            v_bucket := 'Junior Producer';
            v_confidence := 0.6;
            v_reason := 'Heuristic: market cap < 2B and revenue > 0';
          END IF;
        ELSIF v_revenue = 0 AND v_resource_estimate IS NOT NULL THEN
          IF v_stage IN ('construction', 'near term', 'near-term', 'near_term', 'development', 'developer', 'late stage', 'late-stage', 'feasibility') THEN
            v_bucket := 'Developer';
            v_confidence := 0.55;
            v_reason := 'Heuristic: revenue = 0 with resource estimate and development stage';
          ELSE
            v_bucket := 'Explorer';
            v_confidence := 0.5;
            v_reason := 'Heuristic: revenue = 0 with resource estimate and no development stage';
          END IF;
        END IF;
      END IF;

      IF v_bucket IS NULL THEN
        v_bucket := 'Unclassified';
        v_confidence := 0.2;
        v_reason := 'Insufficient data';
      END IF;
    END IF;

    UPDATE public.asset_research
    SET
      bucket_computed = v_bucket,
      bucket_confidence = GREATEST(LEAST(v_confidence, 1), 0),
      bucket_reason = v_reason,
      updated_at = now()
    WHERE id = r.id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_asset_research(UUID) TO authenticated;
