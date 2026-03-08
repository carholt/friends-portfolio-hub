-- Add stable hash fallback dedupe key for transaction imports.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS stable_hash TEXT;

WITH computed AS (
  SELECT
    t.id,
    CONCAT(
      'tx-',
      md5(
        lower(COALESCE(t.broker, '')) || '|' ||
        lower(COALESCE(t.trade_type, '')) || '|' ||
        upper(COALESCE(t.symbol_raw, '')) || '|' ||
        upper(COALESCE(t.isin, '')) || '|' ||
        upper(COALESCE(t.exchange_raw, '')) || '|' ||
        COALESCE(t.traded_at::text, '') || '|' ||
        COALESCE(trim(to_char(t.quantity, 'FM999999999999990D99999999')), '') || '|' ||
        COALESCE(trim(to_char(t.price, 'FM999999999999990D99999999')), '') || '|' ||
        upper(COALESCE(t.currency, '')) || '|' ||
        COALESCE(trim(to_char(t.fees, 'FM999999999999990D99999999')), '')
      )
    ) AS next_stable_hash
  FROM public.transactions t
  WHERE t.stable_hash IS NULL
), deduped AS (
  SELECT
    c.id,
    c.next_stable_hash,
    row_number() OVER (
      PARTITION BY t.portfolio_id, COALESCE(t.broker, ''), c.next_stable_hash
      ORDER BY t.created_at, t.id
    ) AS rn
  FROM computed c
  JOIN public.transactions t ON t.id = c.id
)
UPDATE public.transactions t
SET stable_hash = CASE WHEN d.rn = 1 THEN d.next_stable_hash ELSE NULL END
FROM deduped d
WHERE t.id = d.id
  AND t.stable_hash IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_portfolio_broker_stable_hash
  ON public.transactions (portfolio_id, broker, stable_hash)
  WHERE stable_hash IS NOT NULL;
