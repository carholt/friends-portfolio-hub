-- Flags malformed assets where symbol is an exchange code.
UPDATE public.assets
SET
  symbol_resolution_status = 'invalid',
  symbol_resolution_notes = 'symbol is exchange code',
  last_symbol_resolution_at = now()
WHERE upper(symbol) IN ('TSXV', 'TSX', 'NYSE', 'NASDAQ');
