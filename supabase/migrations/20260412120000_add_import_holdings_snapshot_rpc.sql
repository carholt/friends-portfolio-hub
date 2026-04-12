-- Restore holdings snapshot import RPC used by the frontend import flow.

CREATE OR REPLACE FUNCTION public.import_holdings_snapshot(
  _portfolio_id UUID,
  _mode TEXT DEFAULT 'replace',
  _rows_json JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_rows INTEGER := 0;
  v_valid_rows INTEGER := 0;
  v_skipped_rows INTEGER := 0;
  v_written_rows INTEGER := 0;
BEGIN
  IF _portfolio_id IS NULL THEN
    RAISE EXCEPTION 'portfolio_id is required';
  END IF;

  IF NOT public.owns_portfolio(_portfolio_id) THEN
    RAISE EXCEPTION 'Not allowed to import into this portfolio';
  END IF;

  CREATE TEMP TABLE tmp_holdings_import (
    symbol TEXT,
    isin TEXT,
    name TEXT,
    quantity NUMERIC,
    avg_cost NUMERIC,
    cost_currency TEXT,
    asset_type public.asset_type
  ) ON COMMIT DROP;

  INSERT INTO tmp_holdings_import (symbol, isin, name, quantity, avg_cost, cost_currency, asset_type)
  SELECT
    NULLIF(upper(trim(r.symbol)), ''),
    NULLIF(upper(trim(r.isin)), ''),
    NULLIF(trim(r.name), ''),
    COALESCE(r.quantity, 0),
    COALESCE(r.avg_cost, 0),
    COALESCE(NULLIF(upper(trim(r.cost_currency)), ''), 'USD'),
    COALESCE(r.asset_type, 'stock'::public.asset_type)
  FROM jsonb_to_recordset(COALESCE(_rows_json, '[]'::jsonb)) AS r(
    symbol TEXT,
    isin TEXT,
    name TEXT,
    quantity NUMERIC,
    avg_cost NUMERIC,
    cost_currency TEXT,
    asset_type public.asset_type
  );

  SELECT count(*) INTO v_total_rows FROM tmp_holdings_import;

  DELETE FROM tmp_holdings_import
  WHERE symbol IS NULL
     OR quantity IS NULL
     OR quantity = 0;

  SELECT count(*) INTO v_valid_rows FROM tmp_holdings_import;
  v_skipped_rows := GREATEST(v_total_rows - v_valid_rows, 0);

  INSERT INTO public.assets (symbol, name, asset_type, currency)
  SELECT DISTINCT
    t.symbol,
    COALESCE(t.name, t.symbol),
    COALESCE(t.asset_type, 'stock'::public.asset_type),
    COALESCE(t.cost_currency, 'USD')
  FROM tmp_holdings_import t
  ON CONFLICT (symbol) DO UPDATE
  SET
    name = COALESCE(EXCLUDED.name, public.assets.name),
    currency = COALESCE(EXCLUDED.currency, public.assets.currency);

  IF COALESCE(lower(trim(_mode)), 'replace') = 'replace' THEN
    DELETE FROM public.holdings WHERE portfolio_id = _portfolio_id;
  END IF;

  INSERT INTO public.holdings (portfolio_id, asset_id, quantity, avg_cost, cost_currency)
  SELECT
    _portfolio_id,
    a.id,
    t.quantity,
    t.avg_cost,
    COALESCE(t.cost_currency, 'USD')
  FROM tmp_holdings_import t
  JOIN public.assets a ON a.symbol = t.symbol
  ON CONFLICT (portfolio_id, asset_id)
  DO UPDATE SET
    quantity = EXCLUDED.quantity,
    avg_cost = EXCLUDED.avg_cost,
    cost_currency = EXCLUDED.cost_currency,
    updated_at = now();

  GET DIAGNOSTICS v_written_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'inserted', v_written_rows,
    'updated', 0,
    'skipped', v_skipped_rows,
    'errors', 0
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.import_holdings_snapshot(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_holdings_snapshot(UUID, TEXT, JSONB) TO authenticated, service_role;
