-- Transaction import RPC.

CREATE OR REPLACE FUNCTION public.import_transactions_batch(_portfolio_id UUID, _rows_json JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID := auth.uid();
  v_total_rows INTEGER := 0;
  v_processed_rows INTEGER := 0;
BEGIN
  IF _portfolio_id IS NULL THEN
    RAISE EXCEPTION 'portfolio_id is required';
  END IF;

  IF NOT public.owns_portfolio(_portfolio_id) THEN
    RAISE EXCEPTION 'Not allowed to import into this portfolio';
  END IF;

  CREATE TEMP TABLE tmp_rows (
    broker TEXT,
    trade_id TEXT,
    stable_hash TEXT,
    symbol_raw TEXT,
    traded_at DATE,
    quantity NUMERIC,
    price NUMERIC,
    currency TEXT
  ) ON COMMIT DROP;

  INSERT INTO tmp_rows
  SELECT
    NULLIF(trim(r.broker), ''),
    NULLIF(trim(r.trade_id), ''),
    NULLIF(trim(r.stable_hash), ''),
    NULLIF(upper(trim(r.symbol_raw)), ''),
    r.traded_at,
    COALESCE(r.quantity, 0),
    r.price,
    NULLIF(upper(trim(r.currency)), '')
  FROM jsonb_to_recordset(COALESCE(_rows_json, '[]'::jsonb)) AS r(
    broker TEXT,
    trade_id TEXT,
    stable_hash TEXT,
    symbol_raw TEXT,
    traded_at DATE,
    quantity NUMERIC,
    price NUMERIC,
    currency TEXT
  )
  WHERE COALESCE(r.trade_id, r.stable_hash) IS NOT NULL;

  SELECT count(*) INTO v_total_rows FROM tmp_rows;

  INSERT INTO public.assets (symbol, name, asset_type, currency)
  SELECT DISTINCT t.symbol_raw, t.symbol_raw, 'stock'::public.asset_type, COALESCE(t.currency, 'USD')
  FROM tmp_rows t
  WHERE t.symbol_raw IS NOT NULL
  ON CONFLICT (symbol) DO NOTHING;

  INSERT INTO public.transactions (
    portfolio_id, owner_user_id, asset_id, broker, trade_id, stable_hash,
    symbol_raw, traded_at, quantity, price, currency
  )
  SELECT
    _portfolio_id,
    v_owner,
    a.id,
    t.broker,
    t.trade_id,
    t.stable_hash,
    t.symbol_raw,
    t.traded_at,
    t.quantity,
    t.price,
    COALESCE(t.currency, 'USD')
  FROM tmp_rows t
  LEFT JOIN public.assets a ON a.symbol = t.symbol_raw
  ON CONFLICT (portfolio_id, broker, trade_id)
  DO UPDATE SET
    asset_id = EXCLUDED.asset_id,
    stable_hash = EXCLUDED.stable_hash,
    symbol_raw = EXCLUDED.symbol_raw,
    traded_at = EXCLUDED.traded_at,
    quantity = EXCLUDED.quantity,
    price = EXCLUDED.price,
    currency = EXCLUDED.currency,
    updated_at = now();

  GET DIAGNOSTICS v_processed_rows = ROW_COUNT;

  PERFORM public.rebuild_holdings(_portfolio_id);

  RETURN jsonb_build_object(
    'received', v_total_rows,
    'processed', v_processed_rows,
    'holdings_rebuilt', true
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.import_transactions_batch(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_transactions_batch(UUID, JSONB) TO authenticated, service_role;
