-- Tighten transaction invariants and ensure exchange-aware metadata is durable.

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_non_zero_quantity CHECK (quantity <> 0);

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_buy_sell_positive_price CHECK (
    (type IN ('buy', 'sell') AND COALESCE(price, 0) > 0)
    OR type IN ('adjust', 'remove')
  );

CREATE OR REPLACE FUNCTION public.set_asset_provider_symbol()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  exchange_code TEXT;
BEGIN
  exchange_code := upper(COALESCE(
    NULLIF(NEW.metadata_json->>'exchange_code', ''),
    NULLIF(NEW.exchange, '')
  ));

  NEW.metadata_json := COALESCE(NEW.metadata_json, '{}'::jsonb)
    || jsonb_build_object(
      'provider_symbol',
      CASE
        WHEN exchange_code IS NULL THEN upper(NEW.symbol)
        ELSE upper(NEW.symbol) || ':' || exchange_code
      END
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assets_provider_symbol_before ON public.assets;
CREATE TRIGGER assets_provider_symbol_before
  BEFORE INSERT OR UPDATE OF symbol, exchange, metadata_json
  ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.set_asset_provider_symbol();
