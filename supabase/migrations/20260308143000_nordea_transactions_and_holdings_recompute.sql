-- Nordea transaction import schema and holdings recompute RPC.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS trade_id TEXT,
  ADD COLUMN IF NOT EXISTS trade_type TEXT,
  ADD COLUMN IF NOT EXISTS symbol_raw TEXT,
  ADD COLUMN IF NOT EXISTS exchange_raw TEXT,
  ADD COLUMN IF NOT EXISTS traded_at DATE,
  ADD COLUMN IF NOT EXISTS settle_at DATE,
  ADD COLUMN IF NOT EXISTS trade_currency TEXT,
  ADD COLUMN IF NOT EXISTS gross NUMERIC,
  ADD COLUMN IF NOT EXISTS net NUMERIC,
  ADD COLUMN IF NOT EXISTS base_currency TEXT NOT NULL DEFAULT 'SEK',
  ADD COLUMN IF NOT EXISTS raw_row JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.transactions
SET trade_id = COALESCE(trade_id, external_id),
    trade_type = COALESCE(trade_type, type),
    symbol_raw = COALESCE(symbol_raw, symbol),
    exchange_raw = COALESCE(exchange_raw, exchange),
    traded_at = COALESCE(traded_at, trade_date, traded_at::date),
    settle_at = COALESCE(settle_at, settle_date),
    trade_currency = COALESCE(trade_currency, price_currency, currency),
    gross = COALESCE(gross, total_foreign),
    net = COALESCE(net, total_local),
    raw_row = COALESCE(raw_row, raw, '{}'::jsonb)
WHERE TRUE;

ALTER TABLE public.transactions
  ALTER COLUMN broker SET NOT NULL,
  ALTER COLUMN trade_type SET NOT NULL,
  ALTER COLUMN quantity SET DEFAULT 0,
  ALTER COLUMN quantity SET NOT NULL,
  ALTER COLUMN base_currency SET NOT NULL,
  ALTER COLUMN raw_row SET NOT NULL;

DROP INDEX IF EXISTS idx_transactions_portfolio_broker_external_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_portfolio_broker_trade_id
  ON public.transactions (portfolio_id, broker, trade_id)
  WHERE trade_id IS NOT NULL;

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_trade_type_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_trade_type_check CHECK (trade_type IN ('buy', 'sell', 'dividend', 'fee', 'fx', 'unknown'));

ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS exchange_code TEXT;

CREATE OR REPLACE FUNCTION public.build_provider_symbol(_symbol TEXT, _exchange_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  symbol_clean TEXT := upper(trim(COALESCE(_symbol, '')));
  exchange_clean TEXT := upper(trim(COALESCE(_exchange_code, '')));
BEGIN
  IF symbol_clean = '' THEN
    RETURN NULL;
  END IF;

  IF exchange_clean = 'TSX' THEN
    RETURN symbol_clean || '.TO';
  ELSIF exchange_clean = 'TSXV' THEN
    RETURN symbol_clean || '.V';
  END IF;

  RETURN symbol_clean;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_asset_provider_symbol()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  exchange_value TEXT;
  provider_symbol TEXT;
BEGIN
  exchange_value := upper(COALESCE(NULLIF(NEW.exchange_code, ''), NULLIF(NEW.exchange, ''), NULLIF(NEW.metadata_json->>'exchange_code', '')));
  NEW.exchange_code := exchange_value;

  provider_symbol := public.build_provider_symbol(NEW.symbol, exchange_value);

  NEW.metadata_json := COALESCE(NEW.metadata_json, '{}'::jsonb)
    || jsonb_build_object('exchange_code', exchange_value, 'provider_symbol', provider_symbol);

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_holdings_from_transactions(_portfolio_id UUID)
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
      WHERE portfolio_id = _portfolio_id
        AND asset_id = position.asset_id
      ORDER BY COALESCE(traded_at, trade_date, created_at::date), created_at, id
    LOOP
      tx_qty := GREATEST(COALESCE(tx.quantity, 0), 0);
      tx_price := COALESCE(tx.price, 0);
      tx_fees := COALESCE(tx.fees, 0);

      IF tx.trade_type = 'buy' THEN
        running_qty := running_qty + tx_qty;
        cost_basis := cost_basis + (tx_qty * tx_price + tx_fees);
      ELSIF tx.trade_type = 'sell' THEN
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
  DO UPDATE SET
    quantity = EXCLUDED.quantity,
    avg_cost = EXCLUDED.avg_cost,
    cost_currency = EXCLUDED.cost_currency,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_holdings_from_transactions(UUID) TO authenticated;
