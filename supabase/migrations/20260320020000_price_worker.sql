-- Price worker and cron wiring.

CREATE OR REPLACE FUNCTION public.enqueue_price_worker()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/update-prices',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := '{}'::jsonb
    );
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('update-prices-every-5-minutes');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'update-prices-every-5-minutes',
  '*/5 * * * *',
  $$SELECT public.enqueue_price_worker(); SELECT public.refresh_portfolio_valuations();$$
);

REVOKE EXECUTE ON FUNCTION public.enqueue_price_worker() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_price_worker() TO service_role;
