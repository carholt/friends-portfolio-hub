-- Global price cache + symbol resolution override system.

CREATE TABLE IF NOT EXISTS public.market_instruments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_symbol TEXT NOT NULL,
  exchange_code TEXT,
  price_symbol TEXT NOT NULL UNIQUE,
  asset_type TEXT,
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  provider TEXT NOT NULL DEFAULT 'twelve_data',
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_price_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_instruments_last_price_at
  ON public.market_instruments(last_price_at);
CREATE INDEX IF NOT EXISTS idx_market_instruments_symbol_exchange
  ON public.market_instruments(canonical_symbol, exchange_code);

CREATE TABLE IF NOT EXISTS public.market_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id UUID NOT NULL REFERENCES public.market_instruments(id) ON DELETE CASCADE,
  price NUMERIC NOT NULL,
  currency TEXT NOT NULL,
  price_timestamp TIMESTAMPTZ NOT NULL,
  price_date DATE GENERATED ALWAYS AS ((price_timestamp AT TIME ZONE 'UTC')::date) STORED,
  source TEXT NOT NULL DEFAULT 'twelve_data',
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_prices_instrument_timestamp_desc
  ON public.market_prices(instrument_id, price_timestamp DESC);

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS instrument_id UUID REFERENCES public.market_instruments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_assets_instrument_id ON public.assets(instrument_id);

CREATE TABLE IF NOT EXISTS public.symbol_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_symbol TEXT NOT NULL,
  exchange TEXT,
  canonical_symbol TEXT NOT NULL,
  price_symbol TEXT NOT NULL,
  instrument_id UUID REFERENCES public.market_instruments(id) ON DELETE SET NULL,
  broker TEXT,
  isin TEXT,
  asset_name_hint TEXT,
  confidence NUMERIC,
  resolution_source TEXT NOT NULL DEFAULT 'auto',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS exchange TEXT;
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS canonical_symbol TEXT;
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS price_symbol TEXT;
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS instrument_id UUID REFERENCES public.market_instruments(id) ON DELETE SET NULL;
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS broker TEXT;
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS isin TEXT;
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS asset_name_hint TEXT;
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS confidence NUMERIC;
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS resolution_source TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.symbol_aliases
SET
  canonical_symbol = COALESCE(NULLIF(canonical_symbol, ''), UPPER(raw_symbol)),
  resolution_source = COALESCE(NULLIF(resolution_source, ''), 'auto'),
  is_active = COALESCE(is_active, true)
WHERE canonical_symbol IS NULL
   OR resolution_source IS NULL
   OR is_active IS NULL;

ALTER TABLE public.symbol_aliases
  ALTER COLUMN canonical_symbol SET NOT NULL,
  ALTER COLUMN price_symbol SET NOT NULL,
  ALTER COLUMN resolution_source SET NOT NULL,
  ALTER COLUMN is_active SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'symbol_aliases_resolution_source_check'
      AND conrelid = 'public.symbol_aliases'::regclass
  ) THEN
    ALTER TABLE public.symbol_aliases
      ADD CONSTRAINT symbol_aliases_resolution_source_check
      CHECK (resolution_source IN ('auto', 'imported', 'manual_override', 'ai_suggestion'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_symbol_aliases_unique_resolution
  ON public.symbol_aliases (
    UPPER(raw_symbol),
    COALESCE(UPPER(exchange), ''),
    COALESCE(LOWER(broker), ''),
    COALESCE(UPPER(isin), '')
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_symbol_aliases_unique_active_override
  ON public.symbol_aliases (
    UPPER(raw_symbol),
    COALESCE(UPPER(exchange), ''),
    COALESCE(LOWER(broker), ''),
    COALESCE(UPPER(isin), ''),
    resolution_source
  )
  WHERE is_active = true;

INSERT INTO public.market_instruments (canonical_symbol, exchange_code, price_symbol, asset_type, currency)
SELECT DISTINCT
  UPPER(COALESCE(NULLIF(a.symbol, ''), split_part(a.price_symbol, ':', 1))) AS canonical_symbol,
  NULLIF(UPPER(COALESCE(NULLIF(a.exchange_code, ''), split_part(a.price_symbol, ':', 2))), '') AS exchange_code,
  UPPER(a.price_symbol) AS price_symbol,
  a.asset_type,
  UPPER(a.currency)
FROM public.assets a
WHERE a.price_symbol IS NOT NULL
  AND trim(a.price_symbol) <> ''
ON CONFLICT (price_symbol) DO UPDATE
SET
  canonical_symbol = EXCLUDED.canonical_symbol,
  exchange_code = COALESCE(public.market_instruments.exchange_code, EXCLUDED.exchange_code),
  asset_type = COALESCE(public.market_instruments.asset_type, EXCLUDED.asset_type),
  currency = COALESCE(public.market_instruments.currency, EXCLUDED.currency),
  updated_at = now();

UPDATE public.assets a
SET instrument_id = mi.id
FROM public.market_instruments mi
WHERE a.price_symbol IS NOT NULL
  AND UPPER(a.price_symbol) = mi.price_symbol
  AND a.instrument_id IS DISTINCT FROM mi.id;

UPDATE public.symbol_aliases sa
SET instrument_id = mi.id,
    updated_at = now()
FROM public.market_instruments mi
WHERE sa.instrument_id IS NULL
  AND UPPER(sa.price_symbol) = mi.price_symbol;

CREATE OR REPLACE FUNCTION public.resolve_symbol_candidates(
  _raw_symbol TEXT,
  _exchange TEXT DEFAULT NULL,
  _broker TEXT DEFAULT NULL,
  _isin TEXT DEFAULT NULL,
  _asset_name_hint TEXT DEFAULT NULL
)
RETURNS TABLE (
  alias_id UUID,
  instrument_id UUID,
  raw_symbol TEXT,
  exchange TEXT,
  canonical_symbol TEXT,
  price_symbol TEXT,
  broker TEXT,
  isin TEXT,
  confidence NUMERIC,
  resolution_source TEXT,
  rank_priority INT,
  rank_score NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH normalized AS (
    SELECT
      UPPER(TRIM(COALESCE(_raw_symbol, ''))) AS raw_symbol,
      NULLIF(UPPER(TRIM(COALESCE(_exchange, ''))), '') AS exchange,
      NULLIF(LOWER(TRIM(COALESCE(_broker, ''))), '') AS broker,
      NULLIF(UPPER(TRIM(COALESCE(_isin, ''))), '') AS isin
  ),
  ranked AS (
    SELECT
      sa.id AS alias_id,
      sa.instrument_id,
      sa.raw_symbol,
      sa.exchange,
      sa.canonical_symbol,
      sa.price_symbol,
      sa.broker,
      sa.isin,
      COALESCE(sa.confidence, 0.5) AS confidence,
      sa.resolution_source,
      CASE
        WHEN sa.resolution_source = 'manual_override' THEN 1
        WHEN sa.broker IS NOT NULL AND sa.broker = (SELECT broker FROM normalized) THEN 2
        WHEN sa.isin IS NOT NULL AND sa.isin = (SELECT isin FROM normalized) THEN 3
        WHEN UPPER(sa.raw_symbol) = (SELECT raw_symbol FROM normalized)
          AND COALESCE(UPPER(sa.exchange), '') = COALESCE((SELECT exchange FROM normalized), '') THEN 4
        WHEN UPPER(sa.canonical_symbol) = (SELECT raw_symbol FROM normalized) THEN 5
        ELSE 99
      END AS rank_priority,
      (
        CASE
          WHEN sa.resolution_source = 'manual_override' THEN 1.0
          WHEN sa.broker IS NOT NULL AND sa.broker = (SELECT broker FROM normalized) THEN 0.95
          WHEN sa.isin IS NOT NULL AND sa.isin = (SELECT isin FROM normalized) THEN 0.9
          WHEN UPPER(sa.raw_symbol) = (SELECT raw_symbol FROM normalized)
            AND COALESCE(UPPER(sa.exchange), '') = COALESCE((SELECT exchange FROM normalized), '') THEN 0.85
          WHEN UPPER(sa.canonical_symbol) = (SELECT raw_symbol FROM normalized) THEN 0.75
          ELSE 0.1
        END
      ) * COALESCE(sa.confidence, 1.0) AS rank_score
    FROM public.symbol_aliases sa
    WHERE sa.is_active = true
      AND (
        UPPER(sa.raw_symbol) = (SELECT raw_symbol FROM normalized)
        OR UPPER(sa.canonical_symbol) = (SELECT raw_symbol FROM normalized)
        OR (sa.isin IS NOT NULL AND sa.isin = (SELECT isin FROM normalized))
      )
  )
  SELECT *
  FROM ranked
  ORDER BY rank_priority ASC, rank_score DESC, confidence DESC, raw_symbol ASC
  LIMIT 10;
$$;

CREATE OR REPLACE VIEW public.asset_latest_prices AS
SELECT
  a.id AS asset_id,
  a.instrument_id,
  lp.price,
  lp.currency,
  lp.price_timestamp
FROM public.assets a
LEFT JOIN LATERAL (
  SELECT mp.price, mp.currency, mp.price_timestamp
  FROM public.market_prices mp
  WHERE mp.instrument_id = a.instrument_id
  ORDER BY mp.price_timestamp DESC
  LIMIT 1
) lp ON true;

CREATE OR REPLACE FUNCTION public.refresh_portfolio_valuations()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_prices AS (
    SELECT alp.asset_id, alp.price
    FROM public.asset_latest_prices alp
    WHERE alp.price IS NOT NULL
  ),
  per_holding AS (
    SELECT
      h.portfolio_id,
      h.asset_id,
      h.quantity,
      h.avg_cost,
      lp.price,
      (h.quantity * lp.price) AS position_value,
      (h.quantity * h.avg_cost) AS position_cost
    FROM public.holdings h
    JOIN latest_prices lp
      ON lp.asset_id = h.asset_id
    WHERE h.quantity <> 0
  ),
  per_portfolio AS (
    SELECT
      portfolio_id,
      SUM(position_value) AS total_value,
      SUM(position_cost) AS total_cost,
      SUM(position_value - position_cost) AS total_return
    FROM per_holding
    GROUP BY portfolio_id
  )
  INSERT INTO public.portfolio_valuations (
    portfolio_id,
    valuation_date,
    as_of_date,
    total_value,
    total_cost,
    total_return,
    currency
  )
  SELECT
    pp.portfolio_id,
    CURRENT_DATE,
    CURRENT_DATE,
    COALESCE(pp.total_value, 0),
    COALESCE(pp.total_cost, 0),
    COALESCE(pp.total_return, 0),
    'SEK'
  FROM per_portfolio pp
  ON CONFLICT (portfolio_id, valuation_date)
  DO UPDATE SET
    total_value = EXCLUDED.total_value,
    total_cost = EXCLUDED.total_cost,
    total_return = EXCLUDED.total_return,
    as_of_date = EXCLUDED.as_of_date;
$$;

ALTER TABLE public.market_instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.symbol_aliases ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='market_instruments' AND policyname='Authenticated users can read market instruments') THEN
    CREATE POLICY "Authenticated users can read market instruments"
      ON public.market_instruments
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='market_prices' AND policyname='Authenticated users can read market prices') THEN
    CREATE POLICY "Authenticated users can read market prices"
      ON public.market_prices
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='symbol_aliases' AND policyname='Authenticated users can read aliases') THEN
    CREATE POLICY "Authenticated users can read aliases"
      ON public.symbol_aliases
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='symbol_aliases' AND policyname='Authenticated users can manage aliases') THEN
    CREATE POLICY "Authenticated users can manage aliases"
      ON public.symbol_aliases
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE public.market_instruments FROM PUBLIC;
REVOKE ALL ON TABLE public.market_prices FROM PUBLIC;
REVOKE ALL ON TABLE public.symbol_aliases FROM PUBLIC;
REVOKE ALL ON VIEW public.asset_latest_prices FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_symbol_candidates(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

GRANT SELECT ON TABLE public.market_instruments TO authenticated;
GRANT SELECT ON TABLE public.market_prices TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.symbol_aliases TO authenticated;
GRANT SELECT ON VIEW public.asset_latest_prices TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_symbol_candidates(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT INSERT, SELECT ON TABLE public.market_prices TO service_role;
GRANT SELECT, UPDATE ON TABLE public.market_instruments TO service_role;
GRANT SELECT ON TABLE public.symbol_aliases TO service_role;

GRANT SELECT ON public.portfolio_leaderboard TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_portfolio_leaderboard(integer) TO authenticated, anon;
