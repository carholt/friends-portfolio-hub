-- Ensure refresh_portfolio_valuations runs with definer privileges and explicit backend grants.
DO $migration$
BEGIN
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.refresh_portfolio_valuations()
    RETURNS void
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = public
    AS $body$
      INSERT INTO public.portfolio_valuations (
        portfolio_id,
        total_value,
        total_cost,
        total_return,
        currency,
        valuation_date,
        as_of_date
      )
      SELECT
        h.portfolio_id,
        COALESCE(SUM(h.quantity * alp.price), 0) AS total_value,
        COALESCE(SUM(h.quantity * h.avg_cost), 0) AS total_cost,
        COALESCE(SUM(h.quantity * (alp.price - h.avg_cost)), 0) AS total_return,
        COALESCE(MAX(alp.currency), 'USD') AS currency,
        CURRENT_DATE,
        CURRENT_DATE
      FROM public.holdings h
      JOIN public.assets a ON a.id = h.asset_id
      JOIN public.asset_latest_prices alp ON alp.instrument_id = a.instrument_id
      GROUP BY h.portfolio_id
      ON CONFLICT (portfolio_id, valuation_date)
      DO UPDATE SET
        total_value = EXCLUDED.total_value,
        total_cost = EXCLUDED.total_cost,
        total_return = EXCLUDED.total_return,
        currency = EXCLUDED.currency,
        as_of_date = EXCLUDED.as_of_date;
    $body$;
  $fn$;

  EXECUTE 'ALTER FUNCTION public.refresh_portfolio_valuations() OWNER TO postgres';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.refresh_portfolio_valuations() FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.refresh_portfolio_valuations() TO service_role';
END
$migration$;
