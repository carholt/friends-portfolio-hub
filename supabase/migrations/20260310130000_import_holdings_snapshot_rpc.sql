CREATE OR REPLACE FUNCTION public.import_holdings_snapshot(
  _portfolio_id UUID,
  _mode TEXT,
  _rows_json JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _normalized_mode TEXT := lower(coalesce(_mode, ''));
  _inserted_count INTEGER := 0;
  _updated_count INTEGER := 0;
  _skipped_count INTEGER := 0;
BEGIN
  IF NOT public.owns_portfolio(_portfolio_id) THEN
    RAISE EXCEPTION 'Not allowed to import holdings into this portfolio';
  END IF;

  IF _normalized_mode NOT IN ('merge', 'replace') THEN
    RAISE EXCEPTION 'Invalid import mode: %, expected merge|replace', _mode;
  END IF;

  IF _rows_json IS NULL OR jsonb_typeof(_rows_json) <> 'array' THEN
    RAISE EXCEPTION 'rows_json must be a JSON array';
  END IF;

  CREATE TEMP TABLE tmp_import_rows (
    row_order BIGINT NOT NULL,
    symbol TEXT,
    name TEXT,
    asset_type public.asset_type,
    exchange TEXT,
    cost_currency TEXT,
    quantity NUMERIC,
    avg_cost NUMERIC,
    metadata_json JSONB,
    is_valid BOOLEAN NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO tmp_import_rows (
    row_order,
    symbol,
    name,
    asset_type,
    exchange,
    cost_currency,
    quantity,
    avg_cost,
    metadata_json,
    is_valid
  )
  SELECT
    t.row_order,
    upper(nullif(trim(t.symbol), '')),
    nullif(trim(t.name), ''),
    CASE
      WHEN lower(coalesce(t.asset_type, '')) IN ('stock', 'etf', 'fund', 'metal', 'other')
        THEN lower(t.asset_type)::public.asset_type
      ELSE 'other'::public.asset_type
    END,
    nullif(trim(t.exchange), ''),
    upper(coalesce(nullif(trim(t.cost_currency), ''), 'USD')),
    t.quantity,
    greatest(coalesce(t.avg_cost, 0), 0),
    coalesce(t.metadata_json, '{}'::jsonb),
    (
      nullif(trim(t.symbol), '') IS NOT NULL
      AND t.quantity IS NOT NULL
      AND t.quantity > 0
      AND coalesce(t.avg_cost, 0) >= 0
    )
  FROM jsonb_to_recordset(_rows_json) WITH ORDINALITY AS t(
    symbol TEXT,
    name TEXT,
    asset_type TEXT,
    exchange TEXT,
    cost_currency TEXT,
    quantity NUMERIC,
    avg_cost NUMERIC,
    metadata_json JSONB,
    row_order BIGINT
  );

  SELECT count(*) INTO _skipped_count FROM tmp_import_rows WHERE NOT is_valid;

  CREATE TEMP TABLE tmp_import_final (
    asset_id UUID PRIMARY KEY,
    quantity NUMERIC NOT NULL,
    avg_cost NUMERIC NOT NULL,
    cost_currency TEXT NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO public.assets (symbol, name, asset_type, exchange, currency, metadata_json)
  SELECT DISTINCT
    r.symbol,
    coalesce(r.name, r.symbol),
    r.asset_type,
    r.exchange,
    r.cost_currency,
    r.metadata_json
  FROM tmp_import_rows r
  WHERE r.is_valid
  ON CONFLICT (symbol) DO NOTHING;

  IF _normalized_mode = 'merge' THEN
    INSERT INTO tmp_import_final (asset_id, quantity, avg_cost, cost_currency)
    SELECT
      a.id,
      sum(r.quantity) AS quantity,
      CASE
        WHEN sum(r.quantity) <= 0 THEN 0
        ELSE sum(r.quantity * r.avg_cost) / sum(r.quantity)
      END AS avg_cost,
      (array_agg(r.cost_currency ORDER BY r.row_order DESC))[1] AS cost_currency
    FROM tmp_import_rows r
    JOIN public.assets a ON a.symbol = r.symbol
    WHERE r.is_valid
    GROUP BY a.id;
  ELSE
    INSERT INTO tmp_import_final (asset_id, quantity, avg_cost, cost_currency)
    SELECT DISTINCT ON (a.id)
      a.id,
      r.quantity,
      r.avg_cost,
      r.cost_currency
    FROM tmp_import_rows r
    JOIN public.assets a ON a.symbol = r.symbol
    WHERE r.is_valid
    ORDER BY a.id, r.row_order DESC;

    DELETE FROM public.holdings
    WHERE portfolio_id = _portfolio_id;
  END IF;

  SELECT count(*) INTO _updated_count
  FROM tmp_import_final f
  JOIN public.holdings h
    ON h.portfolio_id = _portfolio_id
   AND h.asset_id = f.asset_id;

  SELECT greatest(count(*) - _updated_count, 0) INTO _inserted_count
  FROM tmp_import_final;

  INSERT INTO public.holdings (portfolio_id, asset_id, quantity, avg_cost, cost_currency)
  SELECT _portfolio_id, asset_id, quantity, avg_cost, cost_currency
  FROM tmp_import_final
  ON CONFLICT (portfolio_id, asset_id)
  DO UPDATE SET
    quantity = CASE
      WHEN _normalized_mode = 'merge' THEN public.holdings.quantity + EXCLUDED.quantity
      ELSE EXCLUDED.quantity
    END,
    avg_cost = CASE
      WHEN _normalized_mode = 'merge' THEN
        CASE
          WHEN (public.holdings.quantity + EXCLUDED.quantity) <= 0 THEN 0
          ELSE (
            (public.holdings.quantity * public.holdings.avg_cost)
            + (EXCLUDED.quantity * EXCLUDED.avg_cost)
          ) / (public.holdings.quantity + EXCLUDED.quantity)
        END
      ELSE EXCLUDED.avg_cost
    END,
    cost_currency = EXCLUDED.cost_currency,
    updated_at = now();

  RETURN jsonb_build_object(
    'inserted', _inserted_count,
    'updated', _updated_count,
    'skipped', _skipped_count,
    'errors', 0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_holdings_snapshot(UUID, TEXT, JSONB) TO authenticated;

