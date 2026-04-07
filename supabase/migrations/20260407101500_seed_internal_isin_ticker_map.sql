-- Seed curated ISIN → ticker mappings for mining-focused symbols.
INSERT INTO public.instrument_mappings (isin, ticker, name, exchange, source)
VALUES
  ('CA40066W1068', 'GSVR.V', 'Guanajuato Silver', 'TSXV', 'manual_seed'),
  ('CA82825J1093', 'SVRS.V', 'Silver Storm Mining', 'TSXV', 'manual_seed'),
  ('CA80280U2056', 'SCZ.V', 'Santacruz Silver Mining', 'TSXV', 'manual_seed'),
  ('CA0539061030', 'ASM', 'Avino Silver & Gold Mines', 'AMEX', 'manual_seed'),
  ('CA03770A3073', 'APGO.V', 'Apollo Silver', 'TSXV', 'manual_seed'),
  ('CA05466C1095', 'AYA.TO', 'Aya Gold & Silver', 'TSX', 'manual_seed'),
  ('CA8283411079', 'AGX.V', 'Silver X Mining', 'TSXV', 'manual_seed'),
  ('CA89901T1093', 'TUD.V', 'Tudor Gold', 'TSXV', 'manual_seed'),
  ('CA1651841027', 'CKG.V', 'Chesapeake Gold', 'TSXV', 'manual_seed'),
  ('CA65442J1075', 'AUMB.V', '1911 Gold', 'TSXV', 'manual_seed'),
  ('CA36258E1025', 'GRSL.V', 'GR Silver Mining', 'TSXV', 'manual_seed'),
  ('CA8280425072', 'AGMR.V', 'Silver Mountain Resources', 'TSXV', 'manual_seed'),
  ('CA8438142033', 'SSV.V', 'Southern Silver Exploration', 'TSXV', 'manual_seed')
ON CONFLICT (isin)
DO UPDATE SET
  ticker = EXCLUDED.ticker,
  name = EXCLUDED.name,
  exchange = EXCLUDED.exchange,
  source = EXCLUDED.source;
