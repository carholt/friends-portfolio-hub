-- Dedicated asset price layer + valuation refresh + 12h scheduler.

CREATE TABLE IF NOT EXISTS public.asset_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  price NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  price_date DATE NOT NULL,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, price_date)
);

CREATE INDEX IF NOT EXISTS idx_asset_prices_asset_date
  ON public.asset_prices(asset_id, price_date DESC);

ALTER TABLE public.asset_prices ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'asset_prices'
      AND policyname = 'Asset prices readable by all'
  ) THEN
    CREATE POLICY "Asset prices readable by all"
      ON public.asset_prices
      FOR SELECT
      USING (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_portfolio_valuations()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_asset_prices AS (
    SELECT DISTINCT ON (ap.asset_id)
      ap.asset_id,
      ap.price,
      ap.currency,
      ap.price_date
    FROM public.asset_prices ap
    ORDER BY ap.asset_id, ap.price_date DESC, ap.created_at DESC
  ),
  per_holding AS (
    SELECT
      h.portfolio_id,
      (h.quantity * lap.price) AS position_value,
      lap.currency,
      lap.price_date
    FROM public.holdings_v2 h
    JOIN public.assets a
      ON a.id = h.asset_id
    JOIN latest_asset_prices lap
      ON lap.asset_id = a.id
    WHERE h.quantity <> 0
  ),
  per_portfolio AS (
    SELECT
      portfolio_id,
      COALESCE(SUM(position_value), 0) AS total_value,
      (array_agg(currency ORDER BY price_date DESC))[1] AS currency,
      MAX(price_date) AS as_of_date
    FROM per_holding
    GROUP BY portfolio_id
  )
  INSERT INTO public.portfolio_valuations (
    portfolio_id,
    total_value,
    currency,
    valuation_date,
    as_of_date
  )
  SELECT
    p.id,
    COALESCE(pp.total_value, 0),
    COALESCE(pp.currency, p.base_currency),
    CURRENT_DATE,
    COALESCE(pp.as_of_date, CURRENT_DATE)
  FROM public.portfolios p
  LEFT JOIN per_portfolio pp ON pp.portfolio_id = p.id
  ON CONFLICT (portfolio_id, valuation_date)
  DO UPDATE SET
    total_value = EXCLUDED.total_value,
    currency = EXCLUDED.currency,
    as_of_date = EXCLUDED.as_of_date;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_portfolio_valuations() TO authenticated, service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('update-prices-every-5-minutes');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('portfolio-market-maintenance-12h');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('update-prices-every-12-hours');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'update-prices-every-12-hours',
  '0 */12 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/update-prices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
