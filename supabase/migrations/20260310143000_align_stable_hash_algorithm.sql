-- Align database backfill stable_hash algorithm with app-side deterministic hash logic.

CREATE OR REPLACE FUNCTION public.compute_transaction_stable_hash(
  _broker TEXT,
  _trade_type TEXT,
  _symbol_raw TEXT,
  _isin TEXT,
  _exchange_raw TEXT,
  _traded_at DATE,
  _quantity NUMERIC,
  _price NUMERIC,
  _currency TEXT,
  _fees NUMERIC
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  exchange_code TEXT;
  stable_input TEXT;
  i INT;
  hash BIGINT := 0;
  ch_code INT;
BEGIN
  exchange_code := CASE
    WHEN upper(COALESCE(_exchange_raw, '')) IN ('TSX', 'TORONTO STOCK EXCHANGE') THEN 'TSX'
    WHEN upper(COALESCE(_exchange_raw, '')) IN ('TSXV', 'TORONTO VENTURE EXCHANGE') THEN 'TSXV'
    WHEN COALESCE(_exchange_raw, '') = '' THEN ''
    ELSE upper(_exchange_raw)
  END;

  stable_input :=
    lower(COALESCE(_broker, '')) || '|' ||
    lower(COALESCE(_trade_type, '')) || '|' ||
    upper(COALESCE(_symbol_raw, '')) || '|' ||
    upper(COALESCE(_isin, '')) || '|' ||
    exchange_code || '|' ||
    COALESCE(_traded_at::text, '') || '|' ||
    CASE WHEN _quantity IS NULL THEN '' ELSE to_char(round(_quantity, 8), 'FM999999999999990D00000000') END || '|' ||
    CASE WHEN _price IS NULL THEN '' ELSE to_char(round(_price, 8), 'FM999999999999990D00000000') END || '|' ||
    upper(COALESCE(_currency, '')) || '|' ||
    CASE WHEN _fees IS NULL THEN '' ELSE to_char(round(_fees, 8), 'FM999999999999990D00000000') END;

  FOR i IN 1..char_length(stable_input) LOOP
    ch_code := ascii(substr(stable_input, i, 1));
    hash := mod((hash * 31 + ch_code), 4294967296);
  END LOOP;

  RETURN 'tx-' || to_hex(hash::bigint);
END;
$$;

WITH computed AS (
  SELECT
    t.id,
    public.compute_transaction_stable_hash(
      t.broker,
      t.trade_type,
      t.symbol_raw,
      t.isin,
      t.exchange_raw,
      t.traded_at,
      t.quantity,
      t.price,
      t.currency,
      t.fees
    ) AS next_stable_hash,
    t.portfolio_id,
    t.broker AS tx_broker,
    t.created_at
  FROM public.transactions t
), deduped AS (
  SELECT
    c.id,
    c.next_stable_hash,
    row_number() OVER (
      PARTITION BY c.portfolio_id, COALESCE(c.tx_broker, ''), c.next_stable_hash
      ORDER BY c.created_at, c.id
    ) AS rn
  FROM computed c
)
UPDATE public.transactions t
SET stable_hash = CASE WHEN d.rn = 1 THEN d.next_stable_hash ELSE NULL END
FROM deduped d
WHERE t.id = d.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_portfolio_broker_stable_hash
  ON public.transactions (portfolio_id, broker, stable_hash)
  WHERE stable_hash IS NOT NULL;
