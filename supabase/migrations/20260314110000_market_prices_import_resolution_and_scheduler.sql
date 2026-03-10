-- Market price ingestion hardening, missing symbol detector, valuation refresh, and 12h scheduler.

ALTER TABLE public.market_instruments
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

UPDATE public.market_instruments
SET is_active = CASE WHEN status = 'active' THEN true ELSE false END
WHERE is_active IS DISTINCT FROM (status = 'active');

ALTER TABLE public.market_prices
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_prices_instrument_unique
  ON public.market_prices (instrument_id);

CREATE OR REPLACE VIEW public.missing_symbol_aliases AS
SELECT
  upper(trim(t.symbol_raw)) AS raw_symbol,
  lower(trim(COALESCE(t.broker, 'unknown'))) AS broker,
  count(*)::bigint AS count_occurrences
FROM public.transactions t
LEFT JOIN public.symbol_aliases sa
  ON upper(sa.raw_symbol) = upper(trim(t.symbol_raw))
 AND COALESCE(lower(sa.broker), '') = COALESCE(lower(trim(t.broker)), '')
 AND sa.is_active = true
WHERE t.symbol_raw IS NOT NULL
  AND trim(t.symbol_raw) <> ''
  AND sa.id IS NULL
GROUP BY upper(trim(t.symbol_raw)), lower(trim(COALESCE(t.broker, 'unknown')))
ORDER BY count_occurrences DESC, raw_symbol;

CREATE OR REPLACE FUNCTION public.refresh_portfolio_valuations()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_market_prices AS (
    SELECT DISTINCT ON (mp.instrument_id)
      mp.instrument_id,
      mp.price
    FROM public.market_prices mp
    ORDER BY mp.instrument_id, mp.updated_at DESC
  ),
  per_holding AS (
    SELECT
      h.portfolio_id,
      (h.quantity * lmp.price) AS position_value
    FROM public.holdings h
    JOIN public.assets a
      ON a.id = h.asset_id
    JOIN latest_market_prices lmp
      ON lmp.instrument_id = a.instrument_id
    WHERE h.quantity <> 0
  ),
  per_portfolio AS (
    SELECT
      portfolio_id,
      COALESCE(SUM(position_value), 0) AS value
    FROM per_holding
    GROUP BY portfolio_id
  )
  INSERT INTO public.portfolio_valuations (
    portfolio_id,
    total_value,
    currency,
    as_of_date,
    valuation_date,
    total_cost,
    total_return,
    created_at
  )
  SELECT
    p.id,
    COALESCE(pp.value, 0),
    p.base_currency,
    CURRENT_DATE,
    CURRENT_DATE,
    0,
    0,
    now()
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
  PERFORM cron.unschedule('portfolio-market-maintenance-12h');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'portfolio-market-maintenance-12h',
  '0 */12 * * *',
  $$
  SELECT
    net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/update-market-prices',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := '{}'::jsonb
    );

  SELECT public.refresh_portfolio_valuations();
  $$
);
