ALTER TABLE public.portfolios ADD COLUMN IF NOT EXISTS broker TEXT;
ALTER TABLE public.portfolios ADD COLUMN IF NOT EXISTS broker_notes TEXT;
