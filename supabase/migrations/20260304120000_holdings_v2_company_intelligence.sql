-- Holdings input v2, broker profiles, and company intelligence MVP.

ALTER TYPE public.asset_type ADD VALUE IF NOT EXISTS 'crypto';

ALTER TABLE public.portfolios
  ADD COLUMN IF NOT EXISTS broker TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS broker_notes TEXT;

ALTER TABLE public.portfolios
  ADD CONSTRAINT portfolios_broker_allowed
  CHECK (broker IN ('manual', 'avanza', 'nordea', 'vera_cash', 'binance'));

-- Dedupe holdings before enforcing uniqueness (keep newest row per portfolio+asset).
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY portfolio_id, asset_id ORDER BY updated_at DESC, created_at DESC, id DESC) AS rn
  FROM public.holdings
)
DELETE FROM public.holdings h
USING ranked r
WHERE h.id = r.id
  AND r.rn > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'holdings_unique_portfolio_asset'
      AND conrelid = 'public.holdings'::regclass
  ) THEN
    ALTER TABLE public.holdings
      ADD CONSTRAINT holdings_unique_portfolio_asset UNIQUE (portfolio_id, asset_id);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL UNIQUE REFERENCES public.assets(id) ON DELETE CASCADE,
  canonical_symbol TEXT NOT NULL,
  exchange TEXT,
  name TEXT NOT NULL,
  lifecycle_stage TEXT NOT NULL,
  tier TEXT NOT NULL,
  started_year INTEGER,
  jurisdiction TEXT,
  website TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.company_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  value_number NUMERIC NOT NULL,
  unit TEXT,
  as_of_date DATE NOT NULL DEFAULT CURRENT_DATE,
  source_url TEXT NOT NULL,
  source_title TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, metric_key, as_of_date)
);
ALTER TABLE public.company_metrics ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.user_assumptions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  gold_price NUMERIC NOT NULL DEFAULT 2200,
  silver_price NUMERIC NOT NULL DEFAULT 25,
  discount_rate NUMERIC NOT NULL DEFAULT 8,
  multiple_ev_oz NUMERIC NOT NULL DEFAULT 120,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_assumptions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_companies_canonical_symbol ON public.companies(canonical_symbol);
CREATE INDEX IF NOT EXISTS idx_company_metrics_company_date ON public.company_metrics(company_id, as_of_date DESC);

DROP POLICY IF EXISTS "Companies readable by all" ON public.companies;
CREATE POLICY "Companies readable by all" ON public.companies FOR SELECT USING (true);

DROP POLICY IF EXISTS "Company metrics readable by all" ON public.company_metrics;
CREATE POLICY "Company metrics readable by all" ON public.company_metrics FOR SELECT USING (true);

DROP POLICY IF EXISTS "Company metrics editable by owners/admin" ON public.company_metrics;
CREATE POLICY "Company metrics editable by owners/admin" ON public.company_metrics
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.user_id = created_by)
  )
  WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users read own assumptions" ON public.user_assumptions;
CREATE POLICY "Users read own assumptions" ON public.user_assumptions FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users upsert own assumptions" ON public.user_assumptions;
CREATE POLICY "Users upsert own assumptions" ON public.user_assumptions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Idempotent seed for fixed mining universe.
WITH seed(symbol, name, lifecycle_stage, tier) AS (
  VALUES
  ('B','Barrick Mining','Producer','Major'),
  ('KGC','Kinross Gold','Producer','Major'),
  ('NEM','Newmont','Producer','Major'),
  ('AYA','Aya Gold & Silver Inc','Producer','Mid Tier'),
  ('ASM','Avino Silver & Gold','Producer','Mid Tier'),
  ('AG','First Majestic Silver','Producer','Mid Tier'),
  ('GMIN','G Mining Ventures Corp','Producer','Mid Tier'),
  ('PAAS','Pan American Silver','Producer','Mid Tier'),
  ('CDE','Coeur Mining','Producer','Mid Tier'),
  ('HE','Hecla Mining','Producer','Mid Tier'),
  ('EXK','Endeavour Silver','Producer','Mid Tier'),
  ('JAG','Jaguar Mining','Producer','Mid Tier'),
  ('USA','Americas Gold & Silver','Producer','Emerging Mid Tier'),
  ('TSK','Talisker','Producer','Emerging Mid Tier'),
  ('AGX','Silver X Mining Corp','Producer','Junior'),
  ('GSVR','Guanajuato Silver Company','Producer','Junior'),
  ('SCZ','Santacruz Silver','Producer','Junior'),
  ('BCM','Beer Creek Mining','Producer','Junior'),
  ('EXN','Excellon Resources','Developer Near Term','Near Term'),
  ('VZLA','Vizsla Silver','Developer Near Term','Near Term'),
  ('AGMR','Silver Mountain Resources','Developer Near Term','Near Term'),
  ('GRSL','GR Silver','Developer Near Term','Near Term'),
  ('SSV','Southern Silver','Developer','Late Stage'),
  ('LG','Lahontan Gold Corp','Developer','Late Stage'),
  ('1911','1911 Gold','Developer','Late Stage'),
  ('ABRA','Abrasilver Resource','Developer','Late Stage'),
  ('NEXG','NexGold Mining','Developer','Late Stage'),
  ('CKG','Chesapeake Gold Corp','Developer','Late Stage'),
  ('APGO','Apollo','Developer','Late Stage'),
  ('TUD','Tudor Gold Corp','Developer','Late Stage'),
  ('WGO','White Gold Corp','Developer','Late Stage'),
  ('SIG','Sitka Gold','Explorer','Early Stage'),
  ('SKP','Strikepoint Gold','Explorer','Early Stage'),
  ('HAMR','Silver Hammer Mining','Explorer','Early Stage')
), upsert_assets AS (
  INSERT INTO public.assets (symbol, name, asset_type, currency)
  SELECT symbol, name, 'stock'::public.asset_type, 'USD'
  FROM seed
  ON CONFLICT (symbol) DO UPDATE SET name = EXCLUDED.name
  RETURNING id, symbol
)
INSERT INTO public.companies (asset_id, canonical_symbol, name, lifecycle_stage, tier)
SELECT a.id, s.symbol, s.name, s.lifecycle_stage, s.tier
FROM seed s
JOIN public.assets a ON a.symbol = s.symbol
ON CONFLICT (asset_id) DO UPDATE
SET canonical_symbol = EXCLUDED.canonical_symbol,
    name = EXCLUDED.name,
    lifecycle_stage = EXCLUDED.lifecycle_stage,
    tier = EXCLUDED.tier,
    updated_at = now();

CREATE OR REPLACE FUNCTION public.ai_extract_company_metrics_stub(_symbol TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'enabled', false,
    'symbol', upper(coalesce(_symbol, '')),
    'message', 'AI extraction is disabled in MVP. Submit metrics manually with source URLs.',
    'schema', jsonb_build_object(
      'metric_key', 'text',
      'value_number', 'number',
      'unit', 'text|null',
      'as_of_date', 'YYYY-MM-DD',
      'source_url', 'https://... (required)',
      'source_title', 'text|null'
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ai_extract_company_metrics_stub(TEXT) TO authenticated;
