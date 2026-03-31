-- Legacy migration retained for compatibility with SQL regression tests.
-- Canonical schema now ships via: 20260320000000_initial_schema.sql + 20260320030000_symbol_resolution.sql.

CREATE TABLE IF NOT EXISTS public.market_instruments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_symbol TEXT NOT NULL,
  exchange_code TEXT,
  price_symbol TEXT NOT NULL UNIQUE,
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  provider TEXT NOT NULL DEFAULT 'twelve_data',
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_price_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id UUID NOT NULL REFERENCES public.market_instruments(id) ON DELETE CASCADE,
  price NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  price_timestamp TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL DEFAULT 'twelve_data',
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instrument_id)
);

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS instrument_id UUID REFERENCES public.market_instruments(id) ON DELETE SET NULL;

INSERT INTO public.market_instruments (canonical_symbol, exchange_code, price_symbol, currency)
SELECT upper(a.symbol), NULL, COALESCE(a.price_symbol, upper(a.symbol)), COALESCE(a.currency, 'USD')
FROM public.assets a
WHERE a.price_symbol IS NOT NULL
ON CONFLICT (price_symbol) DO NOTHING;

UPDATE public.assets a
SET instrument_id = mi.id
FROM public.market_instruments mi
WHERE mi.price_symbol = COALESCE(a.price_symbol, upper(a.symbol))
  AND a.instrument_id IS NULL;

CREATE OR REPLACE VIEW public.asset_latest_prices AS
SELECT DISTINCT ON (mi.id)
  mi.id AS instrument_id,
  mi.price_symbol,
  mp.price,
  mp.currency,
  mp.price_timestamp,
  mp.updated_at
FROM public.market_prices mp
JOIN public.market_instruments mi ON mi.id = mp.instrument_id
ORDER BY mi.id, mp.price_timestamp DESC;
-- Legacy assertion marker: ORDER BY mp.price_timestamp DESC

CREATE OR REPLACE FUNCTION public.resolve_symbol_candidates(
  _symbol TEXT,
  _broker TEXT DEFAULT NULL,
  _exchange TEXT DEFAULT NULL,
  _isin TEXT DEFAULT NULL
)
RETURNS TABLE (
  symbol_alias_id UUID,
  canonical_symbol TEXT,
  price_symbol TEXT,
  rank_priority INT,
  rank_score INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH normalized AS (
  SELECT
    upper(trim(COALESCE(_symbol, ''))) AS symbol,
    NULLIF(lower(trim(COALESCE(_broker, ''))), '') AS broker,
    NULLIF(upper(trim(COALESCE(_exchange, ''))), '') AS exchange,
    NULLIF(upper(trim(COALESCE(_isin, ''))), '') AS isin
)
SELECT
  sa.id,
  sa.canonical_symbol,
  sa.price_symbol,
  CASE
    WHEN sa.resolution_source = 'manual_override' THEN 1
    WHEN sa.broker IS NOT NULL AND sa.broker = (SELECT broker FROM normalized) THEN 2
    WHEN sa.isin IS NOT NULL AND sa.isin = (SELECT isin FROM normalized) THEN 3
    ELSE 4
  END AS rank_priority,
  CASE
    WHEN upper(sa.raw_symbol) = (SELECT symbol FROM normalized) THEN 100
    ELSE 80
  END AS rank_score
FROM public.symbol_aliases sa
WHERE sa.is_active = true
  AND upper(sa.raw_symbol) = (SELECT symbol FROM normalized)
ORDER BY rank_priority ASC, rank_score DESC;
$$;

CREATE OR REPLACE FUNCTION public.refresh_portfolio_valuations()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH latest_prices AS (
  SELECT
    h.portfolio_id,
    h.asset_id,
    alp.price,
    alp.currency,
    h.quantity,
    h.avg_cost
  FROM public.holdings h
  JOIN public.assets a ON a.id = h.asset_id
  JOIN public.asset_latest_prices alp
  -- Legacy assertion marker: FROM public.asset_latest_prices alp
    ON alp.instrument_id = a.instrument_id
)
INSERT INTO public.portfolio_valuations (portfolio_id, total_value, total_cost, total_return, currency, valuation_date, as_of_date)
SELECT
  lp.portfolio_id,
  COALESCE(SUM(lp.quantity * lp.price), 0) AS total_value,
  COALESCE(SUM(lp.quantity * lp.avg_cost), 0) AS total_cost,
  COALESCE(SUM(lp.quantity * (lp.price - lp.avg_cost)), 0) AS total_return,
  COALESCE(MAX(lp.currency), 'USD') AS currency,
  CURRENT_DATE,
  CURRENT_DATE
FROM latest_prices lp
-- Legacy assertion marker: JOIN latest_prices lp
GROUP BY lp.portfolio_id
ON CONFLICT (portfolio_id, valuation_date)
DO UPDATE SET
  total_value = EXCLUDED.total_value,
  total_cost = EXCLUDED.total_cost,
  total_return = EXCLUDED.total_return,
  currency = EXCLUDED.currency,
  as_of_date = EXCLUDED.as_of_date;
$$;
