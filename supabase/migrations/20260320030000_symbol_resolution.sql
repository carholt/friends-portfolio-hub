-- Symbol resolution and global price cache helpers.

CREATE OR REPLACE FUNCTION public.resolve_asset_symbol(
  _symbol TEXT,
  _exchange TEXT DEFAULT NULL
)
RETURNS TABLE (
  asset_id UUID,
  canonical_symbol TEXT,
  price_symbol TEXT,
  instrument_id UUID,
  score INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    COALESCE(sa.canonical_symbol, upper(a.symbol)) AS canonical_symbol,
    COALESCE(sa.price_symbol, mi.price_symbol, upper(a.symbol)) AS price_symbol,
    COALESCE(sa.instrument_id, a.instrument_id) AS instrument_id,
    CASE WHEN sa.id IS NOT NULL THEN 100 ELSE 50 END AS score
  FROM public.assets a
  LEFT JOIN public.symbol_aliases sa
    ON upper(sa.raw_symbol) = upper(_symbol)
   AND sa.is_active = true
   AND (sa.exchange IS NULL OR _exchange IS NULL OR upper(sa.exchange) = upper(_exchange))
  LEFT JOIN public.market_instruments mi ON mi.id = COALESCE(sa.instrument_id, a.instrument_id)
  WHERE upper(a.symbol) = upper(_symbol)
     OR upper(coalesce(sa.raw_symbol, '')) = upper(_symbol)
  ORDER BY score DESC
  LIMIT 10;
$$;

CREATE OR REPLACE VIEW public.missing_symbol_aliases AS
SELECT
  upper(trim(t.symbol_raw)) AS raw_symbol,
  lower(trim(COALESCE(t.broker, 'unknown'))) AS broker,
  count(*)::bigint AS count_occurrences
FROM public.transactions t
LEFT JOIN public.symbol_aliases sa
  ON upper(sa.raw_symbol) = upper(trim(t.symbol_raw))
 AND COALESCE(lower(sa.broker), '') = COALESCE(lower(trim(t.broker)), '')
 AND sa.is_active = true
WHERE t.symbol_raw IS NOT NULL
  AND trim(t.symbol_raw) <> ''
  AND sa.id IS NULL
GROUP BY upper(trim(t.symbol_raw)), lower(trim(COALESCE(t.broker, 'unknown')))
ORDER BY count_occurrences DESC, raw_symbol;

REVOKE ALL ON TABLE public.missing_symbol_aliases FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_asset_symbol(TEXT, TEXT) FROM PUBLIC;
GRANT SELECT ON TABLE public.missing_symbol_aliases TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_asset_symbol(TEXT, TEXT) TO authenticated, service_role;
