-- Transaction-led holdings operations + group board social feed.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_type') THEN
    CREATE TYPE public.transaction_type AS ENUM ('buy', 'sell', 'adjust', 'remove');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  type public.transaction_type NOT NULL,
  quantity NUMERIC NOT NULL,
  price NUMERIC,
  currency TEXT NOT NULL DEFAULT 'USD',
  traded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_transactions_portfolio_asset_time
  ON public.transactions (portfolio_id, asset_id, traded_at, created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON public.transactions (user_id);

DROP POLICY IF EXISTS "View transactions via portfolio visibility" ON public.transactions;
CREATE POLICY "View transactions via portfolio visibility" ON public.transactions
  FOR SELECT USING (public.can_view_portfolio(portfolio_id));

DROP POLICY IF EXISTS "Owner can insert transactions" ON public.transactions;
CREATE POLICY "Owner can insert transactions" ON public.transactions
  FOR INSERT TO authenticated WITH CHECK (public.owns_portfolio(portfolio_id) AND auth.uid() = user_id);

DROP POLICY IF EXISTS "Owner can update transactions" ON public.transactions;
CREATE POLICY "Owner can update transactions" ON public.transactions
  FOR UPDATE TO authenticated USING (public.owns_portfolio(portfolio_id) AND auth.uid() = user_id)
  WITH CHECK (public.owns_portfolio(portfolio_id) AND auth.uid() = user_id);

DROP POLICY IF EXISTS "Owner can delete transactions" ON public.transactions;
CREATE POLICY "Owner can delete transactions" ON public.transactions
  FOR DELETE TO authenticated USING (public.owns_portfolio(portfolio_id) AND auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.normalize_transaction_quantity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_qty NUMERIC := 0;
BEGIN
  IF NEW.quantity IS NULL THEN
    NEW.quantity := 0;
  END IF;

  IF NEW.type = 'buy' THEN
    NEW.quantity := abs(NEW.quantity);
  ELSIF NEW.type = 'sell' THEN
    NEW.quantity := -abs(NEW.quantity);
  ELSIF NEW.type = 'remove' THEN
    SELECT COALESCE(quantity, 0)
      INTO current_qty
    FROM public.holdings
    WHERE portfolio_id = NEW.portfolio_id AND asset_id = NEW.asset_id
    LIMIT 1;
    NEW.quantity := -abs(current_qty);
  END IF;

  IF NEW.type IN ('buy', 'sell') AND NEW.price IS NULL THEN
    RAISE EXCEPTION 'price is required for buy/sell transactions';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_holding_from_transactions(_portfolio_id UUID, _asset_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tx RECORD;
  running_qty NUMERIC := 0;
  running_avg NUMERIC := 0;
  realized NUMERIC := 0;
  qty_after NUMERIC;
BEGIN
  FOR tx IN
    SELECT *
    FROM public.transactions
    WHERE portfolio_id = _portfolio_id AND asset_id = _asset_id
    ORDER BY traded_at, created_at, id
  LOOP
    IF tx.type = 'buy' OR (tx.type = 'adjust' AND tx.quantity > 0) THEN
      IF running_qty + tx.quantity > 0 THEN
        running_avg := ((running_qty * running_avg) + (tx.quantity * COALESCE(tx.price, running_avg, 0))) / (running_qty + tx.quantity);
      END IF;
      running_qty := running_qty + tx.quantity;
    ELSIF tx.type = 'remove' THEN
      running_qty := 0;
      running_avg := 0;
    ELSE
      qty_after := running_qty + tx.quantity;
      IF tx.quantity < 0 AND running_qty > 0 AND COALESCE(tx.price, 0) > 0 THEN
        realized := realized + ((COALESCE(tx.price, 0) - running_avg) * abs(tx.quantity));
      END IF;
      running_qty := GREATEST(qty_after, 0);
      IF running_qty = 0 THEN
        running_avg := 0;
      END IF;
    END IF;
  END LOOP;

  IF running_qty <= 0 THEN
    DELETE FROM public.holdings
    WHERE portfolio_id = _portfolio_id AND asset_id = _asset_id;
  ELSE
    INSERT INTO public.holdings (portfolio_id, asset_id, quantity, avg_cost, cost_currency)
    VALUES (_portfolio_id, _asset_id, running_qty, running_avg, 'USD')
    ON CONFLICT (portfolio_id, asset_id)
    DO UPDATE SET quantity = EXCLUDED.quantity, avg_cost = EXCLUDED.avg_cost, updated_at = now();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_holdings_from_transactions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_holding_from_transactions(OLD.portfolio_id, OLD.asset_id);
    RETURN OLD;
  END IF;

  PERFORM public.recompute_holding_from_transactions(NEW.portfolio_id, NEW.asset_id);

  IF TG_OP = 'UPDATE' AND (OLD.portfolio_id <> NEW.portfolio_id OR OLD.asset_id <> NEW.asset_id) THEN
    PERFORM public.recompute_holding_from_transactions(OLD.portfolio_id, OLD.asset_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_normalize_before ON public.transactions;
CREATE TRIGGER transactions_normalize_before
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.normalize_transaction_quantity();

DROP TRIGGER IF EXISTS transactions_sync_holdings_after ON public.transactions;
CREATE TRIGGER transactions_sync_holdings_after
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.sync_holdings_from_transactions();

CREATE OR REPLACE FUNCTION public.audit_transaction_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID;
BEGIN
  actor := COALESCE(auth.uid(), NEW.user_id, OLD.user_id);

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, details)
  VALUES (
    actor,
    'transaction_' || lower(TG_OP),
    'transaction',
    COALESCE(NEW.id, OLD.id),
    jsonb_build_object(
      'portfolio_id', COALESCE(NEW.portfolio_id, OLD.portfolio_id),
      'asset_id', COALESCE(NEW.asset_id, OLD.asset_id),
      'type', COALESCE(NEW.type, OLD.type),
      'quantity', COALESCE(NEW.quantity, OLD.quantity),
      'price', COALESCE(NEW.price, OLD.price),
      'traded_at', COALESCE(NEW.traded_at, OLD.traded_at)
    )
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS transactions_audit_after ON public.transactions;
CREATE TRIGGER transactions_audit_after
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.audit_transaction_mutation();

CREATE TABLE IF NOT EXISTS public.group_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'message' CHECK (type IN ('message','note')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_group_messages_group_created ON public.group_messages (group_id, created_at DESC);

DROP POLICY IF EXISTS "Group members can read messages" ON public.group_messages;
CREATE POLICY "Group members can read messages" ON public.group_messages
  FOR SELECT USING (public.is_group_member(auth.uid(), group_id));

DROP POLICY IF EXISTS "Group members can create messages" ON public.group_messages;
CREATE POLICY "Group members can create messages" ON public.group_messages
  FOR INSERT TO authenticated WITH CHECK (public.is_group_member(auth.uid(), group_id) AND auth.uid() = user_id);

DROP POLICY IF EXISTS "Author or owner can delete message" ON public.group_messages;
CREATE POLICY "Author or owner can delete message" ON public.group_messages
  FOR DELETE TO authenticated USING (
    auth.uid() = user_id OR public.is_group_owner(auth.uid(), group_id)
  );
