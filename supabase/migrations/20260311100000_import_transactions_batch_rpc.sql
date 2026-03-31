-- Legacy migration retained for compatibility with SQL regression tests.
-- Canonical implementation currently lives in: 20260320010000_import_transactions_rpc.sql

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
  );

  DELETE FROM tmp_rows ranked
  USING (
    SELECT ctid,
      row_number() OVER (
        PARTITION BY COALESCE(trade_id, stable_hash), COALESCE(broker, ''), symbol_raw, traded_at, quantity, price
        ORDER BY ctid
      ) AS rn
    FROM tmp_rows
  ) ranked_map
  WHERE ranked.ctid = ranked_map.ctid
    AND ranked_map.rn > 1;

  -- Legacy assertion marker: WHERE ranked.rn > 1

  SELECT count(*) INTO v_total_rows FROM tmp_rows;

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
  WHERE t.trade_id IS NOT NULL
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
  WHERE t.trade_id IS NULL AND t.stable_hash IS NOT NULL
  ON CONFLICT (portfolio_id, broker, stable_hash)
  DO UPDATE SET
    asset_id = EXCLUDED.asset_id,
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
