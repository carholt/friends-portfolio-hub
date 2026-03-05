-- Transaction import schema expansion + asset research + holdings rebuild rpc.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS broker TEXT,
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS trade_date DATE,
  ADD COLUMN IF NOT EXISTS settle_date DATE,
  ADD COLUMN IF NOT EXISTS isin TEXT,
  ADD COLUMN IF NOT EXISTS symbol TEXT,
  ADD COLUMN IF NOT EXISTS exchange TEXT,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS price_currency TEXT,
  ADD COLUMN IF NOT EXISTS fx_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS fees NUMERIC,
  ADD COLUMN IF NOT EXISTS fees_currency TEXT,
  ADD COLUMN IF NOT EXISTS total_local NUMERIC,
  ADD COLUMN IF NOT EXISTS total_foreign NUMERIC,
  ADD COLUMN IF NOT EXISTS raw JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.transactions SET owner_user_id = user_id WHERE owner_user_id IS NULL;
ALTER TABLE public.transactions ALTER COLUMN owner_user_id SET NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN asset_id DROP NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN quantity DROP NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN type TYPE TEXT USING type::text;
DROP TYPE IF EXISTS public.transaction_type;
ALTER TABLE public.transactions ALTER COLUMN type SET NOT NULL;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_type_check CHECK (type IN ('buy', 'sell', 'dividend', 'fee', 'deposit', 'withdrawal', 'split', 'transfer', 'adjust', 'remove'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_portfolio_broker_external_id
  ON public.transactions(portfolio_id, broker, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_portfolio_trade_date ON public.transactions(portfolio_id, trade_date);
CREATE INDEX IF NOT EXISTS idx_transactions_isin ON public.transactions(isin);
CREATE INDEX IF NOT EXISTS idx_transactions_symbol ON public.transactions(symbol);

DROP TRIGGER IF EXISTS transactions_normalize_before ON public.transactions;
DROP TRIGGER IF EXISTS transactions_sync_holdings_after ON public.transactions;

DROP POLICY IF EXISTS "Owner can insert transactions" ON public.transactions;
CREATE POLICY "Owner can insert transactions" ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.owns_portfolio(portfolio_id) AND auth.uid() = owner_user_id);
DROP POLICY IF EXISTS "Owner can update transactions" ON public.transactions;
CREATE POLICY "Owner can update transactions" ON public.transactions
  FOR UPDATE TO authenticated
  USING (public.owns_portfolio(portfolio_id) AND auth.uid() = owner_user_id)
  WITH CHECK (public.owns_portfolio(portfolio_id) AND auth.uid() = owner_user_id);
DROP POLICY IF EXISTS "Owner can delete transactions" ON public.transactions;
CREATE POLICY "Owner can delete transactions" ON public.transactions
  FOR DELETE TO authenticated
  USING (public.owns_portfolio(portfolio_id) AND auth.uid() = owner_user_id);

CREATE TABLE IF NOT EXISTS public.asset_research (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  bucket TEXT,
  thesis_type TEXT,
  rating TEXT,
  investment_recommendation TEXT,
  projected_price NUMERIC,
  low_valuation_estimate NUMERIC,
  high_valuation_estimate NUMERIC,
  properties_ownership TEXT,
  management_team TEXT,
  share_structure TEXT,
  location TEXT,
  projected_growth TEXT,
  market_buzz TEXT,
  cost_structure_financing TEXT,
  cash_debt_position TEXT,
  assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(portfolio_id, asset_id)
);
ALTER TABLE public.asset_research ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_asset_research_portfolio ON public.asset_research(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_asset_research_asset ON public.asset_research(asset_id);

CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS asset_research_set_updated_at ON public.asset_research;
CREATE TRIGGER asset_research_set_updated_at
  BEFORE UPDATE ON public.asset_research
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

DROP POLICY IF EXISTS "Asset research visible via portfolio visibility" ON public.asset_research;
CREATE POLICY "Asset research visible via portfolio visibility" ON public.asset_research
  FOR SELECT USING (public.can_view_portfolio(portfolio_id));
DROP POLICY IF EXISTS "Asset research owner manage" ON public.asset_research;
CREATE POLICY "Asset research owner manage" ON public.asset_research
  FOR ALL TO authenticated
  USING (public.owns_portfolio(portfolio_id))
  WITH CHECK (public.owns_portfolio(portfolio_id));

CREATE OR REPLACE FUNCTION public.rebuild_holdings(_portfolio_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  tx RECORD;
  running_qty NUMERIC;
  running_avg NUMERIC;
  cost_basis NUMERIC;
  tx_qty NUMERIC;
  tx_price NUMERIC;
  tx_fees NUMERIC;
BEGIN
  FOR r IN SELECT DISTINCT asset_id FROM public.transactions WHERE portfolio_id = _portfolio_id AND asset_id IS NOT NULL LOOP
    running_qty := 0;
    running_avg := 0;
    cost_basis := 0;

    FOR tx IN
      SELECT *
      FROM public.transactions
      WHERE portfolio_id = _portfolio_id AND asset_id = r.asset_id
      ORDER BY COALESCE(trade_date, traded_at::date, created_at::date), created_at, id
    LOOP
      tx_qty := GREATEST(COALESCE(tx.quantity, 0), 0);
      tx_price := COALESCE(tx.price, 0);
      tx_fees := COALESCE(tx.fees, 0);

      IF tx.type = 'buy' THEN
        running_qty := running_qty + tx_qty;
        cost_basis := cost_basis + (tx_qty * tx_price + tx_fees);
        running_avg := CASE WHEN running_qty > 0 THEN cost_basis / running_qty ELSE 0 END;
      ELSIF tx.type = 'sell' THEN
        IF running_qty > 0 THEN
          running_qty := GREATEST(running_qty - tx_qty, 0);
          cost_basis := GREATEST(cost_basis - (tx_qty * running_avg), 0);
          running_avg := CASE WHEN running_qty > 0 THEN cost_basis / running_qty ELSE 0 END;
        END IF;
      END IF;
    END LOOP;

    IF running_qty <= 0 THEN
      INSERT INTO public.holdings (portfolio_id, asset_id, quantity, avg_cost, cost_currency)
      VALUES (_portfolio_id, r.asset_id, 0, 0, 'USD')
      ON CONFLICT (portfolio_id, asset_id)
      DO UPDATE SET quantity = 0, avg_cost = 0, updated_at = now();
    ELSE
      INSERT INTO public.holdings (portfolio_id, asset_id, quantity, avg_cost, cost_currency)
      VALUES (_portfolio_id, r.asset_id, running_qty, running_avg, 'USD')
      ON CONFLICT (portfolio_id, asset_id)
      DO UPDATE SET quantity = EXCLUDED.quantity, avg_cost = EXCLUDED.avg_cost, updated_at = now();
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rebuild_holdings(UUID) TO authenticated;
