-- Initial clean baseline schema for Friends Portfolio Hub.

-- 1) Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2) Core types
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'portfolio_visibility') THEN
    CREATE TYPE public.portfolio_visibility AS ENUM ('private', 'authenticated', 'public', 'group');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'asset_type') THEN
    CREATE TYPE public.asset_type AS ENUM ('stock', 'etf', 'fund', 'metal', 'other');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'group_role') THEN
    CREATE TYPE public.group_role AS ENUM ('owner', 'member');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invite_status') THEN
    CREATE TYPE public.invite_status AS ENUM ('pending', 'accepted', 'declined');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mining_stage') THEN
    CREATE TYPE public.mining_stage AS ENUM ('explorer', 'developer', 'producer', 'mid_tier', 'major');
  END IF;
END $$;

-- 3) Base tables
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  display_name TEXT,
  default_currency TEXT NOT NULL DEFAULT 'SEK',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role public.group_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.group_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL,
  invited_email TEXT,
  invited_user_id UUID,
  invited_by_user_id UUID NOT NULL,
  token UUID NOT NULL DEFAULT gen_random_uuid(),
  status public.invite_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.portfolios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  visibility public.portfolio_visibility NOT NULL DEFAULT 'private',
  group_id UUID,
  public_slug TEXT UNIQUE,
  base_currency TEXT NOT NULL DEFAULT 'SEK',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_instruments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_symbol TEXT NOT NULL,
  exchange_code TEXT,
  price_symbol TEXT NOT NULL UNIQUE,
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  provider TEXT NOT NULL DEFAULT 'twelve_data',
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_price_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  asset_type public.asset_type NOT NULL DEFAULT 'stock',
  exchange TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  instrument_id UUID,
  price_symbol TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.market_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id UUID NOT NULL,
  price NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  price_timestamp TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL DEFAULT 'twelve_data',
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instrument_id)
);

CREATE TABLE IF NOT EXISTS public.symbol_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_symbol TEXT NOT NULL,
  exchange TEXT,
  canonical_symbol TEXT NOT NULL,
  price_symbol TEXT NOT NULL,
  instrument_id UUID,
  broker TEXT,
  isin TEXT,
  resolution_source TEXT NOT NULL DEFAULT 'auto',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT symbol_aliases_resolution_source_check CHECK (resolution_source IN ('auto', 'imported', 'manual_override', 'ai_suggestion'))
);

CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL,
  owner_user_id UUID NOT NULL,
  asset_id UUID,
  broker TEXT,
  trade_id TEXT,
  stable_hash TEXT,
  trade_type TEXT NOT NULL DEFAULT 'unknown',
  symbol_raw TEXT,
  isin TEXT,
  exchange_raw TEXT,
  traded_at DATE,
  quantity NUMERIC NOT NULL DEFAULT 0,
  price NUMERIC,
  currency TEXT,
  fx_rate NUMERIC,
  fees NUMERIC,
  raw_row JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, broker, trade_id),
  UNIQUE (portfolio_id, broker, stable_hash)
);

CREATE TABLE IF NOT EXISTS public.holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL,
  asset_id UUID NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  avg_cost NUMERIC NOT NULL DEFAULT 0,
  cost_currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, asset_id)
);

CREATE TABLE IF NOT EXISTS public.portfolio_valuations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL,
  total_value NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  total_return NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'SEK',
  as_of_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valuation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, valuation_date)
);

CREATE TABLE IF NOT EXISTS public.import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL,
  owner_user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  idempotency_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.mining_company_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL UNIQUE,
  primary_metal TEXT,
  secondary_metals TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  jurisdiction TEXT,
  stage public.mining_stage NOT NULL DEFAULT 'explorer',
  market_cap NUMERIC,
  enterprise_value NUMERIC,
  annual_production_oz NUMERIC,
  resource_size_oz NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mining_valuation_metrics (
  asset_id UUID PRIMARY KEY,
  ev_per_ounce NUMERIC,
  valuation_rating TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jurisdiction_risk_scores (
  jurisdiction TEXT PRIMARY KEY,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mining_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL,
  insight_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, insight_type, title)
);

-- 4) Indexes
CREATE INDEX IF NOT EXISTS idx_portfolios_owner ON public.portfolios(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_assets_instrument_id ON public.assets(instrument_id);
CREATE INDEX IF NOT EXISTS idx_market_prices_instrument_ts ON public.market_prices(instrument_id, price_timestamp DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_symbol_aliases_unique_resolution
  ON public.symbol_aliases (upper(raw_symbol), COALESCE(upper(exchange), ''), COALESCE(lower(broker), ''), COALESCE(upper(isin), ''));
CREATE INDEX IF NOT EXISTS idx_transactions_portfolio_traded_at ON public.transactions(portfolio_id, traded_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_asset_id ON public.transactions(asset_id);
CREATE INDEX IF NOT EXISTS idx_holdings_portfolio_id ON public.holdings(portfolio_id);

-- 5) Foreign keys
ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.groups ADD CONSTRAINT groups_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.group_members ADD CONSTRAINT group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;
ALTER TABLE public.group_members ADD CONSTRAINT group_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.group_invites ADD CONSTRAINT group_invites_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;
ALTER TABLE public.group_invites ADD CONSTRAINT group_invites_invited_user_id_fkey FOREIGN KEY (invited_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.group_invites ADD CONSTRAINT group_invites_invited_by_user_id_fkey FOREIGN KEY (invited_by_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.portfolios ADD CONSTRAINT portfolios_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.portfolios ADD CONSTRAINT portfolios_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE SET NULL;
ALTER TABLE public.assets ADD CONSTRAINT assets_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.market_instruments(id) ON DELETE SET NULL;
ALTER TABLE public.market_prices ADD CONSTRAINT market_prices_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.market_instruments(id) ON DELETE CASCADE;
ALTER TABLE public.symbol_aliases ADD CONSTRAINT symbol_aliases_instrument_id_fkey FOREIGN KEY (instrument_id) REFERENCES public.market_instruments(id) ON DELETE SET NULL;
ALTER TABLE public.symbol_aliases ADD CONSTRAINT symbol_aliases_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE SET NULL;
ALTER TABLE public.holdings ADD CONSTRAINT holdings_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE;
ALTER TABLE public.holdings ADD CONSTRAINT holdings_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;
ALTER TABLE public.portfolio_valuations ADD CONSTRAINT portfolio_valuations_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE;
ALTER TABLE public.import_jobs ADD CONSTRAINT import_jobs_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE;
ALTER TABLE public.import_jobs ADD CONSTRAINT import_jobs_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.mining_company_profiles ADD CONSTRAINT mining_company_profiles_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;
ALTER TABLE public.mining_valuation_metrics ADD CONSTRAINT mining_valuation_metrics_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;
ALTER TABLE public.mining_insights ADD CONSTRAINT mining_insights_portfolio_id_fkey FOREIGN KEY (portfolio_id) REFERENCES public.portfolios(id) ON DELETE CASCADE;

-- 6) Views
CREATE OR REPLACE VIEW public.asset_latest_prices AS
SELECT
  mi.id AS instrument_id,
  mi.price_symbol,
  mp.price,
  mp.currency,
  mp.price_timestamp,
  mp.updated_at
FROM public.market_instruments mi
LEFT JOIN public.market_prices mp ON mp.instrument_id = mi.id;

CREATE OR REPLACE VIEW public.portfolio_leaderboard AS
SELECT
  p.id AS portfolio_id,
  p.name,
  v.total_value,
  v.total_cost,
  v.total_return,
  (v.total_return / NULLIF(v.total_cost, 0)) * 100 AS return_pct
FROM public.portfolios p
JOIN LATERAL (
  SELECT pv.*
  FROM public.portfolio_valuations pv
  WHERE pv.portfolio_id = p.id
  ORDER BY pv.valuation_date DESC
  LIMIT 1
) v ON TRUE;

-- 7) Functions
CREATE OR REPLACE FUNCTION public.owns_portfolio(_portfolio_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.portfolios p
    WHERE p.id = _portfolio_id AND p.owner_user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.rebuild_holdings(_portfolio_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.holdings WHERE portfolio_id = _portfolio_id;

  INSERT INTO public.holdings (portfolio_id, asset_id, quantity, avg_cost, cost_currency)
  SELECT
    t.portfolio_id,
    t.asset_id,
    SUM(t.quantity) AS quantity,
    CASE WHEN SUM(t.quantity) = 0 THEN 0 ELSE SUM(COALESCE(t.price, 0) * t.quantity) / NULLIF(SUM(t.quantity), 0) END AS avg_cost,
    COALESCE(MAX(t.currency), 'USD')
  FROM public.transactions t
  WHERE t.portfolio_id = _portfolio_id
    AND t.asset_id IS NOT NULL
  GROUP BY t.portfolio_id, t.asset_id
  HAVING SUM(t.quantity) <> 0;
$$;

CREATE OR REPLACE FUNCTION public.refresh_portfolio_valuations()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH per_portfolio AS (
    SELECT
      h.portfolio_id,
      SUM(h.quantity * COALESCE(alp.price, 0)) AS total_value,
      SUM(h.quantity * h.avg_cost) AS total_cost
    FROM public.holdings h
    JOIN public.assets a ON a.id = h.asset_id
    LEFT JOIN public.asset_latest_prices alp ON alp.instrument_id = a.instrument_id
    GROUP BY h.portfolio_id
  )
  INSERT INTO public.portfolio_valuations (
    portfolio_id,
    total_value,
    total_cost,
    total_return,
    currency,
    as_of_date,
    valuation_date
  )
  SELECT
    p.id,
    COALESCE(pp.total_value, 0),
    COALESCE(pp.total_cost, 0),
    COALESCE(pp.total_value, 0) - COALESCE(pp.total_cost, 0),
    p.base_currency,
    CURRENT_DATE,
    CURRENT_DATE
  FROM public.portfolios p
  LEFT JOIN per_portfolio pp ON pp.portfolio_id = p.id
  ON CONFLICT (portfolio_id, valuation_date)
  DO UPDATE SET
    total_value = EXCLUDED.total_value,
    total_cost = EXCLUDED.total_cost,
    total_return = EXCLUDED.total_return,
    as_of_date = EXCLUDED.as_of_date,
    currency = EXCLUDED.currency;
$$;

CREATE OR REPLACE FUNCTION public.get_leaderboard(_period TEXT DEFAULT 'ALL')
RETURNS TABLE (
  portfolio_id UUID,
  portfolio_name TEXT,
  total_value NUMERIC,
  total_return NUMERIC,
  return_pct NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pl.portfolio_id,
    pl.name,
    pl.total_value,
    pl.total_return,
    pl.return_pct
  FROM public.portfolio_leaderboard pl
  ORDER BY pl.return_pct DESC NULLS LAST, pl.total_value DESC;
$$;

-- 8) RLS policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.symbol_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_valuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mining_company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mining_valuation_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jurisdiction_risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mining_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "portfolios_select_visible" ON public.portfolios FOR SELECT USING (
  owner_user_id = auth.uid() OR visibility = 'public' OR (visibility = 'authenticated' AND auth.uid() IS NOT NULL)
);
CREATE POLICY "portfolios_owner_manage" ON public.portfolios FOR ALL TO authenticated USING (auth.uid() = owner_user_id) WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "assets_select_all" ON public.assets FOR SELECT USING (true);
CREATE POLICY "assets_insert_auth" ON public.assets FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "market_instruments_select_auth" ON public.market_instruments FOR SELECT TO authenticated USING (true);
CREATE POLICY "market_prices_select_auth" ON public.market_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY "symbol_aliases_select_auth" ON public.symbol_aliases FOR SELECT TO authenticated USING (true);
CREATE POLICY "symbol_aliases_manage_auth" ON public.symbol_aliases FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "transactions_owner_manage" ON public.transactions FOR ALL TO authenticated USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY "holdings_owner_read" ON public.holdings FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.portfolios p WHERE p.id = holdings.portfolio_id AND p.owner_user_id = auth.uid())
);
CREATE POLICY "valuations_owner_read" ON public.portfolio_valuations FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.portfolios p WHERE p.id = portfolio_valuations.portfolio_id AND p.owner_user_id = auth.uid())
);
CREATE POLICY "import_jobs_owner_manage" ON public.import_jobs FOR ALL TO authenticated USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());

-- 9) Grants and revokes
REVOKE ALL ON TABLE public.asset_latest_prices FROM PUBLIC;
REVOKE ALL ON TABLE public.portfolio_leaderboard FROM PUBLIC;
REVOKE ALL ON TABLE public.market_prices FROM PUBLIC;
REVOKE ALL ON TABLE public.symbol_aliases FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_portfolio_valuations() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard(TEXT) FROM PUBLIC;

GRANT SELECT ON TABLE public.asset_latest_prices TO authenticated, anon;
GRANT SELECT ON TABLE public.portfolio_leaderboard TO authenticated, anon;
GRANT SELECT ON TABLE public.market_prices TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.symbol_aliases TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_portfolio_valuations() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(TEXT) TO authenticated, anon, service_role;

INSERT INTO public.jurisdiction_risk_scores (jurisdiction, risk_level)
VALUES
  ('canada', 'low'),
  ('usa', 'low'),
  ('mexico', 'medium'),
  ('peru', 'medium'),
  ('bolivia', 'high')
ON CONFLICT (jurisdiction) DO NOTHING;
