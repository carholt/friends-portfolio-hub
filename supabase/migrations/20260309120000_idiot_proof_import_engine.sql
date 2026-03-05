-- Idiot-proof import engine: profiles, robust transactions schema, recompute rpc updates.

CREATE TABLE IF NOT EXISTS public.broker_import_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker_key TEXT NOT NULL DEFAULT 'unknown',
  file_fingerprint TEXT NOT NULL,
  mapping JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id, file_fingerprint)
);

ALTER TABLE public.broker_import_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner can manage own broker import profiles" ON public.broker_import_profiles;
CREATE POLICY "Owner can manage own broker import profiles"
  ON public.broker_import_profiles
  FOR ALL TO authenticated
  USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);

CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker TEXT,
  trade_id TEXT,
  trade_type TEXT,
  symbol_raw TEXT,
  isin TEXT,
  exchange_raw TEXT,
  traded_at DATE,
  quantity NUMERIC,
  price NUMERIC,
  currency TEXT,
  fx_rate NUMERIC,
  fees NUMERIC,
  raw_row JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS broker TEXT,
  ADD COLUMN IF NOT EXISTS trade_id TEXT,
  ADD COLUMN IF NOT EXISTS trade_type TEXT,
  ADD COLUMN IF NOT EXISTS symbol_raw TEXT,
  ADD COLUMN IF NOT EXISTS isin TEXT,
  ADD COLUMN IF NOT EXISTS exchange_raw TEXT,
  ADD COLUMN IF NOT EXISTS traded_at DATE,
  ADD COLUMN IF NOT EXISTS quantity NUMERIC,
  ADD COLUMN IF NOT EXISTS price NUMERIC,
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS fx_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS fees NUMERIC,
  ADD COLUMN IF NOT EXISTS raw_row JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_portfolio_broker_trade_id_v2
  ON public.transactions (portfolio_id, broker, trade_id)
  WHERE trade_id IS NOT NULL;

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS exchange_code TEXT;

CREATE OR REPLACE FUNCTION public.recompute_holdings_from_transactions(_portfolio_id UUID, _method TEXT DEFAULT 'avg_cost')
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  position RECORD;
  tx RECORD;
  running_qty NUMERIC;
  cost_basis NUMERIC;
  running_avg NUMERIC;
  tx_qty NUMERIC;
  tx_price NUMERIC;
  tx_fees NUMERIC;
BEGIN
  IF NOT public.owns_portfolio(_portfolio_id) THEN
    RAISE EXCEPTION 'Not allowed to rebuild holdings for this portfolio';
  END IF;

  CREATE TEMP TABLE tmp_holdings_calc (
    asset_id UUID PRIMARY KEY,
    quantity NUMERIC NOT NULL,
    avg_cost NUMERIC NOT NULL
  ) ON COMMIT DROP;

  FOR position IN
    SELECT DISTINCT asset_id
    FROM public.transactions
    WHERE portfolio_id = _portfolio_id
      AND asset_id IS NOT NULL
  LOOP
    running_qty := 0;
    cost_basis := 0;
    running_avg := 0;

    FOR tx IN
      SELECT *
      FROM public.transactions
      WHERE portfolio_id = _portfolio_id AND asset_id = position.asset_id
      ORDER BY COALESCE(traded_at, trade_date, created_at::date), created_at, id
    LOOP
      tx_qty := GREATEST(COALESCE(tx.quantity, 0), 0);
      tx_price := COALESCE(tx.price, 0);
      tx_fees := COALESCE(tx.fees, 0);

      IF COALESCE(tx.trade_type, tx.type) = 'buy' THEN
        running_qty := running_qty + tx_qty;
        cost_basis := cost_basis + (tx_qty * tx_price + tx_fees);
      ELSIF COALESCE(tx.trade_type, tx.type) = 'sell' THEN
        IF running_qty > 0 THEN
          running_avg := cost_basis / running_qty;
          running_qty := GREATEST(running_qty - tx_qty, 0);
          cost_basis := GREATEST(cost_basis - (tx_qty * running_avg), 0);
        END IF;
      END IF;

      IF running_qty > 0 THEN
        running_avg := cost_basis / running_qty;
      ELSE
        running_avg := 0;
      END IF;
    END LOOP;

    IF running_qty > 0 THEN
      INSERT INTO tmp_holdings_calc(asset_id, quantity, avg_cost)
      VALUES (position.asset_id, running_qty, running_avg)
      ON CONFLICT (asset_id) DO UPDATE SET quantity = EXCLUDED.quantity, avg_cost = EXCLUDED.avg_cost;
    END IF;
  END LOOP;

  DELETE FROM public.holdings h
  WHERE h.portfolio_id = _portfolio_id
    AND NOT EXISTS (SELECT 1 FROM tmp_holdings_calc c WHERE c.asset_id = h.asset_id);

  INSERT INTO public.holdings (portfolio_id, asset_id, quantity, avg_cost, cost_currency)
  SELECT _portfolio_id, c.asset_id, c.quantity, c.avg_cost, 'SEK'
  FROM tmp_holdings_calc c
  ON CONFLICT (portfolio_id, asset_id)
  DO UPDATE SET quantity = EXCLUDED.quantity, avg_cost = EXCLUDED.avg_cost, cost_currency = EXCLUDED.cost_currency, updated_at = now();

  BEGIN
    PERFORM public.log_audit_action('recompute_holdings_from_transactions', jsonb_build_object('portfolio_id', _portfolio_id, 'method', _method), _portfolio_id, 'portfolio');
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_holdings_from_transactions(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_holdings_from_transactions(UUID) TO authenticated;
