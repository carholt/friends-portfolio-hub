-- Canonical symbol resolution metadata for resilient non-US pricing.

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS exchange_code TEXT NULL,
  ADD COLUMN IF NOT EXISTS price_symbol TEXT NULL,
  ADD COLUMN IF NOT EXISTS price_provider TEXT NOT NULL DEFAULT 'twelve_data',
  ADD COLUMN IF NOT EXISTS last_symbol_resolution_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS symbol_resolution_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS symbol_resolution_notes TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'assets_symbol_resolution_status_check'
      AND conrelid = 'public.assets'::regclass
  ) THEN
    ALTER TABLE public.assets
      ADD CONSTRAINT assets_symbol_resolution_status_check
      CHECK (symbol_resolution_status IN ('unknown', 'resolved', 'ambiguous', 'invalid'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_assets_price_symbol ON public.assets(price_symbol);
CREATE INDEX IF NOT EXISTS idx_assets_exchange_code ON public.assets(exchange_code);
CREATE INDEX IF NOT EXISTS idx_assets_symbol_resolution_status ON public.assets(symbol_resolution_status);

CREATE OR REPLACE FUNCTION public.set_asset_resolution(
  _asset_id UUID,
  _price_symbol TEXT,
  _exchange_code TEXT,
  _status TEXT,
  _notes TEXT DEFAULT NULL
)
RETURNS public.assets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id UUID := auth.uid();
  _allowed BOOLEAN := FALSE;
  _normalized_status TEXT := lower(trim(coalesce(_status, 'unknown')));
  _normalized_price_symbol TEXT := NULLIF(upper(trim(coalesce(_price_symbol, ''))), '');
  _normalized_exchange_code TEXT := NULLIF(upper(trim(coalesce(_exchange_code, ''))), '');
  _updated public.assets;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF _normalized_status NOT IN ('unknown', 'resolved', 'ambiguous', 'invalid') THEN
    RAISE EXCEPTION 'Invalid status: %', _normalized_status;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.holdings h
    JOIN public.portfolios p ON p.id = h.portfolio_id
    WHERE h.asset_id = _asset_id
      AND p.owner_user_id = _user_id
  ) INTO _allowed;

  IF NOT _allowed THEN
    RAISE EXCEPTION 'Not allowed to resolve symbol for this asset';
  END IF;

  UPDATE public.assets
  SET
    price_symbol = _normalized_price_symbol,
    exchange_code = _normalized_exchange_code,
    symbol_resolution_status = _normalized_status,
    symbol_resolution_notes = _notes,
    last_symbol_resolution_at = now(),
    price_provider = 'twelve_data'
  WHERE id = _asset_id
  RETURNING * INTO _updated;

  IF _updated.id IS NULL THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  PERFORM public.log_audit_action(
    'asset_symbol_resolution',
    'asset',
    _asset_id,
    jsonb_build_object(
      'price_symbol', _normalized_price_symbol,
      'exchange_code', _normalized_exchange_code,
      'status', _normalized_status,
      'notes', _notes
    )
  );

  RETURN _updated;
END;
$$;

REVOKE ALL ON FUNCTION public.set_asset_resolution(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_asset_resolution(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Admin cleanup: symbols that are actually exchange names cannot be priced directly.
UPDATE public.assets
SET
  symbol_resolution_status = 'invalid',
  symbol_resolution_notes = 'symbol is exchange code',
  last_symbol_resolution_at = now()
WHERE upper(symbol) IN ('TSXV', 'TSX', 'NYSE', 'NASDAQ');

CREATE OR REPLACE FUNCTION public.resolve_asset_symbol(
  _symbol TEXT,
  _hint_currency TEXT DEFAULT NULL
)
RETURNS TABLE (
  price_symbol TEXT,
  exchange_code TEXT,
  name TEXT,
  currency TEXT,
  score INT,
  provider TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(a.price_symbol, upper(a.symbol)) AS price_symbol,
    a.exchange_code,
    a.name,
    a.currency,
    CASE WHEN a.symbol_resolution_status = 'resolved' THEN 100 ELSE 40 END::INT AS score,
    a.price_provider AS provider
  FROM public.assets a
  WHERE upper(a.symbol) = upper(_symbol)
    AND (_hint_currency IS NULL OR upper(a.currency) = upper(_hint_currency))
  ORDER BY score DESC, a.created_at DESC
  LIMIT 10;
$$;

REVOKE ALL ON FUNCTION public.resolve_asset_symbol(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_asset_symbol(TEXT, TEXT) TO authenticated;
