-- High-performance transaction import RPC using set-based SQL and jsonb_to_recordset.

CREATE OR REPLACE FUNCTION public.import_transactions_batch(_portfolio_id UUID, _rows_json JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID := auth.uid();
  v_total_rows INTEGER := 0;
  v_deduped_rows INTEGER := 0;
  v_trade_inserted INTEGER := 0;
  v_trade_updated INTEGER := 0;
  v_stable_inserted INTEGER := 0;
  v_stable_updated INTEGER := 0;
  v_assets_upserted INTEGER := 0;
BEGIN
  IF _portfolio_id IS NULL THEN
    RAISE EXCEPTION 'portfolio_id is required';
  END IF;

  IF NOT public.owns_portfolio(_portfolio_id) THEN
    RAISE EXCEPTION 'Not allowed to import into this portfolio';
  END IF;

  CREATE TEMP TABLE tmp_import_rows (
    ord INTEGER,
    broker TEXT,
    trade_id TEXT,
    stable_hash TEXT,
    trade_type TEXT,
    symbol_raw TEXT,
    isin TEXT,
    exchange_raw TEXT,
    exchange_code TEXT,
    price_symbol TEXT,
    traded_at DATE,
    quantity NUMERIC,
    price NUMERIC,
    currency TEXT,
    fx_rate NUMERIC,
    fees NUMERIC,
    raw_row JSONB
  ) ON COMMIT DROP;

  INSERT INTO tmp_import_rows (
    ord,
    broker,
    trade_id,
    stable_hash,
    trade_type,
    symbol_raw,
    isin,
    exchange_raw,
    exchange_code,
    price_symbol,
    traded_at,
    quantity,
    price,
    currency,
    fx_rate,
    fees,
    raw_row
  )
  SELECT
    row_number() OVER (),
    NULLIF(trim(r.broker), ''),
    NULLIF(trim(r.trade_id), ''),
    NULLIF(trim(r.stable_hash), ''),
    COALESCE(NULLIF(trim(r.trade_type), ''), 'unknown'),
    NULLIF(upper(trim(r.symbol_raw)), ''),
    NULLIF(upper(trim(r.isin)), ''),
    NULLIF(trim(r.exchange_raw), ''),
    NULLIF(upper(trim(r.exchange_code)), ''),
    NULLIF(trim(r.price_symbol), ''),
    r.traded_at,
    COALESCE(r.quantity, 0),
    r.price,
    NULLIF(upper(trim(r.currency)), ''),
    r.fx_rate,
    r.fees,
    COALESCE(r.raw_row, '{}'::jsonb)
  FROM jsonb_to_recordset(COALESCE(_rows_json, '[]'::jsonb)) AS r(
    broker TEXT,
    trade_id TEXT,
    stable_hash TEXT,
    trade_type TEXT,
    symbol_raw TEXT,
    isin TEXT,
    exchange_raw TEXT,
    exchange_code TEXT,
    price_symbol TEXT,
    traded_at DATE,
    quantity NUMERIC,
    price NUMERIC,
    currency TEXT,
    fx_rate NUMERIC,
    fees NUMERIC,
    raw_row JSONB
  )
  WHERE COALESCE(r.trade_id, r.stable_hash) IS NOT NULL;

  SELECT count(*) INTO v_total_rows FROM tmp_import_rows;

  DELETE FROM tmp_import_rows t
  USING (
    SELECT ord
    FROM (
      SELECT
        ord,
        row_number() OVER (
          PARTITION BY COALESCE(broker, ''),
            CASE WHEN trade_id IS NOT NULL THEN 'trade:' || trade_id ELSE 'stable:' || COALESCE(stable_hash, '') END
          ORDER BY ord
        ) AS rn
      FROM tmp_import_rows
    ) ranked
    WHERE ranked.rn > 1
  ) d
  WHERE t.ord = d.ord;

  SELECT count(*) INTO v_deduped_rows FROM tmp_import_rows;

  WITH distinct_assets AS (
    SELECT DISTINCT symbol_raw, exchange_code, price_symbol
    FROM tmp_import_rows
    WHERE symbol_raw IS NOT NULL
  ), upserted AS (
    INSERT INTO public.assets (symbol, name, asset_type, exchange, currency, metadata_json)
    SELECT
      a.symbol_raw,
      a.symbol_raw,
      'stock'::public.asset_type,
      a.exchange_code,
      'USD',
      jsonb_strip_nulls(jsonb_build_object('exchange_code', a.exchange_code, 'price_symbol', a.price_symbol))
    FROM distinct_assets a
    ON CONFLICT (symbol)
    DO UPDATE SET
      exchange = COALESCE(EXCLUDED.exchange, public.assets.exchange),
      metadata_json = COALESCE(public.assets.metadata_json, '{}'::jsonb) || COALESCE(EXCLUDED.metadata_json, '{}'::jsonb)
    RETURNING id
  )
  SELECT count(*) INTO v_assets_upserted FROM upserted;

  CREATE TEMP TABLE tmp_asset_lookup AS
  SELECT
    t.ord,
    a.id AS asset_id
  FROM tmp_import_rows t
  LEFT JOIN LATERAL (
    SELECT a1.id
    FROM public.assets a1
    WHERE upper(a1.symbol) = COALESCE(t.symbol_raw, '')
      AND (
        COALESCE(upper(a1.exchange), '') = COALESCE(t.exchange_code, '')
        OR t.exchange_code IS NULL
      )
    ORDER BY CASE WHEN COALESCE(upper(a1.exchange), '') = COALESCE(t.exchange_code, '') THEN 0 ELSE 1 END, a1.id
    LIMIT 1
  ) a ON TRUE;

  WITH upsert_trade AS (
    INSERT INTO public.transactions (
      portfolio_id,
      owner_user_id,
      broker,
      trade_id,
      stable_hash,
      trade_type,
      symbol_raw,
      isin,
      exchange_raw,
      traded_at,
      quantity,
      price,
      currency,
      fx_rate,
      fees,
      raw_row,
      asset_id,
      metadata_json
    )
    SELECT
      _portfolio_id,
      v_owner,
      t.broker,
      t.trade_id,
      t.stable_hash,
      t.trade_type,
      t.symbol_raw,
      t.isin,
      t.exchange_raw,
      t.traded_at,
      t.quantity,
      t.price,
      t.currency,
      t.fx_rate,
      t.fees,
      t.raw_row,
      l.asset_id,
      jsonb_strip_nulls(jsonb_build_object('exchange_code', t.exchange_code, 'price_symbol', t.price_symbol))
    FROM tmp_import_rows t
    LEFT JOIN tmp_asset_lookup l ON l.ord = t.ord
    WHERE t.trade_id IS NOT NULL
    ON CONFLICT (portfolio_id, broker, trade_id)
    DO UPDATE SET
      stable_hash = EXCLUDED.stable_hash,
      trade_type = EXCLUDED.trade_type,
      symbol_raw = EXCLUDED.symbol_raw,
      isin = EXCLUDED.isin,
      exchange_raw = EXCLUDED.exchange_raw,
      traded_at = EXCLUDED.traded_at,
      quantity = EXCLUDED.quantity,
      price = EXCLUDED.price,
      currency = EXCLUDED.currency,
      fx_rate = EXCLUDED.fx_rate,
      fees = EXCLUDED.fees,
      raw_row = EXCLUDED.raw_row,
      asset_id = EXCLUDED.asset_id,
      metadata_json = EXCLUDED.metadata_json,
      owner_user_id = EXCLUDED.owner_user_id
    RETURNING xmax = 0 AS inserted
  )
  SELECT
    count(*) FILTER (WHERE inserted),
    count(*) FILTER (WHERE NOT inserted)
  INTO v_trade_inserted, v_trade_updated
  FROM upsert_trade;

  WITH upsert_stable AS (
    INSERT INTO public.transactions (
      portfolio_id,
      owner_user_id,
      broker,
      trade_id,
      stable_hash,
      trade_type,
      symbol_raw,
      isin,
      exchange_raw,
      traded_at,
      quantity,
      price,
      currency,
      fx_rate,
      fees,
      raw_row,
      asset_id,
      metadata_json
    )
    SELECT
      _portfolio_id,
      v_owner,
      t.broker,
      NULL,
      t.stable_hash,
      t.trade_type,
      t.symbol_raw,
      t.isin,
      t.exchange_raw,
      t.traded_at,
      t.quantity,
      t.price,
      t.currency,
      t.fx_rate,
      t.fees,
      t.raw_row,
      l.asset_id,
      jsonb_strip_nulls(jsonb_build_object('exchange_code', t.exchange_code, 'price_symbol', t.price_symbol))
    FROM tmp_import_rows t
    LEFT JOIN tmp_asset_lookup l ON l.ord = t.ord
    WHERE t.trade_id IS NULL
      AND t.stable_hash IS NOT NULL
    ON CONFLICT (portfolio_id, broker, stable_hash)
    DO UPDATE SET
      trade_type = EXCLUDED.trade_type,
      symbol_raw = EXCLUDED.symbol_raw,
      isin = EXCLUDED.isin,
      exchange_raw = EXCLUDED.exchange_raw,
      traded_at = EXCLUDED.traded_at,
      quantity = EXCLUDED.quantity,
      price = EXCLUDED.price,
      currency = EXCLUDED.currency,
      fx_rate = EXCLUDED.fx_rate,
      fees = EXCLUDED.fees,
      raw_row = EXCLUDED.raw_row,
      asset_id = EXCLUDED.asset_id,
      metadata_json = EXCLUDED.metadata_json,
      owner_user_id = EXCLUDED.owner_user_id
    RETURNING xmax = 0 AS inserted
  )
  SELECT
    count(*) FILTER (WHERE inserted),
    count(*) FILTER (WHERE NOT inserted)
  INTO v_stable_inserted, v_stable_updated
  FROM upsert_stable;

  PERFORM public.rebuild_holdings(_portfolio_id);

  RETURN jsonb_build_object(
    'received', v_total_rows,
    'deduped', v_deduped_rows,
    'assets_upserted', v_assets_upserted,
    'trade_id', jsonb_build_object('inserted', v_trade_inserted, 'updated', v_trade_updated),
    'stable_hash', jsonb_build_object('inserted', v_stable_inserted, 'updated', v_stable_updated),
    'processed', v_trade_inserted + v_trade_updated + v_stable_inserted + v_stable_updated,
    'skipped', GREATEST(v_total_rows - v_deduped_rows, 0),
    'holdings_rebuilt', true
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.import_transactions_batch(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_transactions_batch(UUID, JSONB) TO authenticated;
