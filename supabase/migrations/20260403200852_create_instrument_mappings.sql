CREATE TABLE IF NOT EXISTS public.instrument_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  isin text UNIQUE NOT NULL,
  ticker text,
  name text,
  exchange text,
  currency text,
  source text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_instrument_mappings_isin ON public.instrument_mappings (isin);
