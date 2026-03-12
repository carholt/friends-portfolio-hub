-- Price updater + valuation cache + leaderboard pipeline.

ALTER TABLE public.prices
  ADD COLUMN IF NOT EXISTS price_date DATE NOT NULL DEFAULT CURRENT_DATE;

UPDATE public.prices
SET price_date = as_of_date
WHERE price_date IS DISTINCT FROM as_of_date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_prices_asset_price_date
  ON public.prices (asset_id, price_date);

ALTER TABLE public.portfolio_valuations
  ADD COLUMN IF NOT EXISTS valuation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_return NUMERIC NOT NULL DEFAULT 0;

UPDATE public.portfolio_valuations
SET valuation_date = as_of_date
WHERE valuation_date IS DISTINCT FROM as_of_date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_valuations_portfolio_date
  ON public.portfolio_valuations (portfolio_id, valuation_date);

CREATE OR REPLACE FUNCTION public.refresh_portfolio_valuations()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_prices AS (
    SELECT DISTINCT ON (p.asset_id)
      p.asset_id,
      p.price
    FROM public.prices p
    ORDER BY p.asset_id, p.price_date DESC, p.created_at DESC
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

CREATE OR REPLACE VIEW public.portfolio_leaderboard AS
SELECT
  p.id AS portfolio_id,
  p.name,
  v.total_value,
  v.total_cost,
  v.total_return,
  (v.total_return / NULLIF(v.total_cost, 0)) * 100 AS return_pct
FROM public.portfolios p
JOIN LATERAL (
  SELECT *
  FROM public.portfolio_valuations
  WHERE portfolio_id = p.id
  ORDER BY valuation_date DESC
  LIMIT 1
) v ON true
ORDER BY return_pct DESC NULLS LAST;

CREATE OR REPLACE FUNCTION public.get_portfolio_leaderboard("limit" INT DEFAULT 50)
RETURNS TABLE (
  portfolio_id UUID,
  portfolio_name TEXT,
  total_value NUMERIC,
  return_pct NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    pl.portfolio_id,
    pl.name AS portfolio_name,
    pl.total_value,
    pl.return_pct
  FROM public.portfolio_leaderboard pl
  LIMIT GREATEST(COALESCE("limit", 50), 1);
$$;

GRANT EXECUTE ON FUNCTION public.refresh_portfolio_valuations() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_portfolio_leaderboard(INT) TO anon, authenticated, service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('update-prices-every-5-minutes');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'update-prices-every-5-minutes',
  '*/5 * * * *',
  $$
  SELECT
    net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/update-prices',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);
