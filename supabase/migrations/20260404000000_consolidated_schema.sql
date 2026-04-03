-- Consolidated bootstrap schema for fresh databases.
-- Generated from supabase/migrations on 2026-04-03.

-- >>> 20260320000000_initial_schema.sql
-- Initial clean baseline schema for Friends Portfolio Hub.

-- 1) Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
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

-- >>> 20260320010000_import_transactions_rpc.sql
-- Transaction import RPC.

CREATE OR REPLACE FUNCTION public.import_transactions_batch(_portfolio_id UUID, _rows_json JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID := auth.uid();
  v_total_rows INTEGER := 0;
BEGIN
  IF _portfolio_id IS NULL THEN
    RAISE EXCEPTION 'portfolio_id is required';
  END IF;

  IF NOT public.owns_portfolio(_portfolio_id) THEN
    RAISE EXCEPTION 'Not allowed to import into this portfolio';
  END IF;

  CREATE TEMP TABLE tmp_rows (
    broker TEXT,
    trade_id TEXT,
    stable_hash TEXT,
    symbol_raw TEXT,
    traded_at DATE,
    quantity NUMERIC,
    price NUMERIC,
    currency TEXT
  ) ON COMMIT DROP;

  INSERT INTO tmp_rows
  SELECT
    NULLIF(trim(r.broker), ''),
    NULLIF(trim(r.trade_id), ''),
    NULLIF(trim(r.stable_hash), ''),
    NULLIF(upper(trim(r.symbol_raw)), ''),
    r.traded_at,
    COALESCE(r.quantity, 0),
    r.price,
    NULLIF(upper(trim(r.currency)), '')
  FROM jsonb_to_recordset(COALESCE(_rows_json, '[]'::jsonb)) AS r(
    broker TEXT,
    trade_id TEXT,
    stable_hash TEXT,
    symbol_raw TEXT,
    traded_at DATE,
    quantity NUMERIC,
    price NUMERIC,
    currency TEXT
  )
  WHERE COALESCE(r.trade_id, r.stable_hash) IS NOT NULL;

  DELETE FROM tmp_rows ranked
  USING (
    SELECT ctid,
      row_number() OVER (
        PARTITION BY COALESCE(trade_id, stable_hash), COALESCE(broker, ''), symbol_raw, traded_at, quantity, price
        ORDER BY ctid
      ) AS rn
    FROM tmp_rows
  ) ranked_map
  WHERE ranked.ctid = ranked_map.ctid
    AND ranked_map.rn > 1;

  SELECT count(*) INTO v_total_rows FROM tmp_rows;

  INSERT INTO public.assets (symbol, name, asset_type, currency)
  SELECT DISTINCT t.symbol_raw, t.symbol_raw, 'stock'::public.asset_type, COALESCE(t.currency, 'USD')
  FROM tmp_rows t
  WHERE t.symbol_raw IS NOT NULL
  ON CONFLICT (symbol) DO NOTHING;

  INSERT INTO public.transactions (
    portfolio_id, owner_user_id, asset_id, broker, trade_id, stable_hash,
    symbol_raw, traded_at, quantity, price, currency
  )
  SELECT
    _portfolio_id,
    v_owner,
    a.id,
    t.broker,
    t.trade_id,
    t.stable_hash,
    t.symbol_raw,
    t.traded_at,
    t.quantity,
    t.price,
    COALESCE(t.currency, 'USD')
  FROM tmp_rows t
  LEFT JOIN public.assets a ON a.symbol = t.symbol_raw
  WHERE t.trade_id IS NOT NULL
  ON CONFLICT (portfolio_id, broker, trade_id)
  DO UPDATE SET
    asset_id = EXCLUDED.asset_id,
    stable_hash = EXCLUDED.stable_hash,
    symbol_raw = EXCLUDED.symbol_raw,
    traded_at = EXCLUDED.traded_at,
    quantity = EXCLUDED.quantity,
    price = EXCLUDED.price,
    currency = EXCLUDED.currency,
    updated_at = now();


  INSERT INTO public.transactions (
    portfolio_id, owner_user_id, asset_id, broker, trade_id, stable_hash,
    symbol_raw, traded_at, quantity, price, currency
  )
  SELECT
    _portfolio_id,
    v_owner,
    a.id,
    t.broker,
    t.trade_id,
    t.stable_hash,
    t.symbol_raw,
    t.traded_at,
    t.quantity,
    t.price,
    COALESCE(t.currency, 'USD')
  FROM tmp_rows t
  LEFT JOIN public.assets a ON a.symbol = t.symbol_raw
  WHERE t.trade_id IS NULL AND t.stable_hash IS NOT NULL
  ON CONFLICT (portfolio_id, broker, stable_hash)
  DO UPDATE SET
    asset_id = EXCLUDED.asset_id,
    symbol_raw = EXCLUDED.symbol_raw,
    traded_at = EXCLUDED.traded_at,
    quantity = EXCLUDED.quantity,
    price = EXCLUDED.price,
    currency = EXCLUDED.currency,
    updated_at = now();


  PERFORM public.rebuild_holdings(_portfolio_id);

  RETURN jsonb_build_object(
    'received', v_total_rows,
    'processed', v_total_rows,
    'holdings_rebuilt', true
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.import_transactions_batch(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_transactions_batch(UUID, JSONB) TO authenticated, service_role;

-- >>> 20260320020000_price_worker.sql
-- Price worker and cron wiring.

CREATE OR REPLACE FUNCTION public.enqueue_price_worker()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/update-prices',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := '{}'::jsonb
    );
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('update-prices-every-5-minutes');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'update-prices-every-5-minutes',
  '*/5 * * * *',
  $$SELECT public.enqueue_price_worker(); SELECT public.refresh_portfolio_valuations();$$
);

REVOKE EXECUTE ON FUNCTION public.enqueue_price_worker() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_price_worker() TO service_role;

-- >>> 20260320030000_symbol_resolution.sql
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

-- >>> 20260320040000_mining_intelligence.sql
-- Mining intelligence system.

CREATE OR REPLACE FUNCTION public.classify_mining_company(_asset_id UUID)
RETURNS public.mining_stage
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _production NUMERIC;
  _resource NUMERIC;
  _stage public.mining_stage;
BEGIN
  SELECT annual_production_oz, resource_size_oz
  INTO _production, _resource
  FROM public.mining_company_profiles
  WHERE asset_id = _asset_id;

  IF _production IS NOT NULL AND _production > 500000 THEN
    _stage := 'major';
  ELSIF _production IS NOT NULL AND _production >= 100000 THEN
    _stage := 'mid_tier';
  ELSIF _production IS NOT NULL AND _production > 0 THEN
    _stage := 'producer';
  ELSIF _resource IS NOT NULL AND _resource > 0 THEN
    _stage := 'developer';
  ELSE
    _stage := 'explorer';
  END IF;

  UPDATE public.mining_company_profiles
  SET stage = _stage
  WHERE asset_id = _asset_id;

  RETURN _stage;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_mining_valuation_metrics(_asset_id UUID DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.mining_valuation_metrics (asset_id, ev_per_ounce, valuation_rating, created_at, updated_at)
  SELECT
    mcp.asset_id,
    CASE
      WHEN mcp.enterprise_value IS NOT NULL AND mcp.resource_size_oz IS NOT NULL AND mcp.resource_size_oz <> 0
      THEN mcp.enterprise_value / mcp.resource_size_oz
      ELSE NULL
    END,
    CASE
      WHEN mcp.enterprise_value IS NULL OR mcp.resource_size_oz IS NULL OR mcp.resource_size_oz = 0 THEN NULL
      WHEN (mcp.enterprise_value / mcp.resource_size_oz) < 50 THEN 'Deep Value'
      WHEN (mcp.enterprise_value / mcp.resource_size_oz) < 150 THEN 'Value'
      WHEN (mcp.enterprise_value / mcp.resource_size_oz) <= 400 THEN 'Fair'
      ELSE 'Expensive'
    END,
    now(),
    now()
  FROM public.mining_company_profiles mcp
  WHERE _asset_id IS NULL OR mcp.asset_id = _asset_id
  ON CONFLICT (asset_id)
  DO UPDATE SET
    ev_per_ounce = EXCLUDED.ev_per_ounce,
    valuation_rating = EXCLUDED.valuation_rating,
    updated_at = now();
$$;

CREATE OR REPLACE FUNCTION public.refresh_portfolio_mining_snapshot(_portfolio_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _asset_id UUID;
BEGIN
  FOR _asset_id IN
    SELECT DISTINCT h.asset_id
    FROM public.holdings h
    WHERE h.portfolio_id = _portfolio_id
      AND h.quantity <> 0
  LOOP
    PERFORM public.classify_mining_company(_asset_id);
  END LOOP;

  PERFORM public.refresh_mining_valuation_metrics(NULL);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.classify_mining_company(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_mining_valuation_metrics(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_portfolio_mining_snapshot(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classify_mining_company(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_mining_valuation_metrics(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_portfolio_mining_snapshot(UUID) TO authenticated, service_role;

-- >>> 20260320050000_friends_and_leaderboard_rpc.sql
-- Add compatibility RPC for leaderboard queries and missing friends table.

CREATE OR REPLACE FUNCTION public.get_portfolio_leaderboard("limit" INTEGER DEFAULT 50)
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
    lb.portfolio_id,
    lb.portfolio_name,
    lb.total_value,
    lb.total_return,
    lb.return_pct
  FROM public.get_leaderboard('ALL') lb
  LIMIT GREATEST(COALESCE("limit", 50), 1);
$$;

REVOKE ALL ON FUNCTION public.get_portfolio_leaderboard(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_portfolio_leaderboard(INTEGER) TO authenticated, anon, service_role;

CREATE TABLE IF NOT EXISTS public.friends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT friends_not_self CHECK (user_id <> friend_user_id),
  CONSTRAINT friends_unique_pair UNIQUE (user_id, friend_user_id)
);

ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "friends_select_involved" ON public.friends;
CREATE POLICY "friends_select_involved"
ON public.friends
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR auth.uid() = friend_user_id);

DROP POLICY IF EXISTS "friends_insert_owner" ON public.friends;
CREATE POLICY "friends_insert_owner"
ON public.friends
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "friends_delete_owner" ON public.friends;
CREATE POLICY "friends_delete_owner"
ON public.friends
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.friends FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON TABLE public.friends TO authenticated;

-- >>> 20260331090000_fix_public_schema_permissions.sql
-- Ensure public leaderboard RPC is reachable for anonymous users.
-- Some environments may have had schema-level privileges tightened,
-- causing `permission denied for schema public` when calling public RPCs.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Re-assert access to open leaderboard endpoints.
GRANT EXECUTE ON FUNCTION public.get_leaderboard(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_portfolio_leaderboard(INTEGER) TO anon, authenticated, service_role;

-- >>> 20260331100000_fix_portfolio_valuations_permissions.sql
-- Ensure clients can read portfolio valuations table subject to RLS policies.
-- Without explicit table grants, PostgREST requests can fail with:
-- `permission denied for table portfolio_valuations`.

GRANT SELECT ON TABLE public.portfolio_valuations TO authenticated, service_role;

-- >>> 20260331100000_fix_portfolios_table_permissions.sql
-- Fix runtime errors like: `permission denied for table portfolios`
-- Ensure table-level grants are explicitly aligned with RLS policies.

REVOKE ALL ON TABLE public.portfolios FROM PUBLIC;

-- Public portfolio pages need read access for anonymous users.
GRANT SELECT ON TABLE public.portfolios TO anon;

-- Authenticated users can read and manage their own portfolios via RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.portfolios TO authenticated;

-- Service role should have full access for backend jobs.
GRANT ALL ON TABLE public.portfolios TO service_role;

-- >>> 20260331113000_add_broker_columns_to_portfolios.sql
ALTER TABLE public.portfolios ADD COLUMN IF NOT EXISTS broker TEXT;
ALTER TABLE public.portfolios ADD COLUMN IF NOT EXISTS broker_notes TEXT;

-- >>> 20260403120000_add_mining_dashboard_rpc_and_ticker_suggestion_fallbacks.sql
-- Restore mining dashboard RPC for PostgREST schema cache compatibility.

CREATE OR REPLACE FUNCTION public.get_portfolio_mining_dashboard(portfolio_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_authorized BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.portfolios p
    LEFT JOIN public.group_members gm
      ON gm.group_id = p.group_id
     AND gm.user_id = auth.uid()
    WHERE p.id = get_portfolio_mining_dashboard.portfolio_id
      AND (
        auth.role() = 'service_role'
        OR p.owner_user_id = auth.uid()
        OR gm.user_id IS NOT NULL
      )
  )
  INTO v_authorized;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not allowed to view this portfolio dashboard'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN (
    WITH latest_valuation AS (
      SELECT pv.total_value, pv.total_cost, pv.total_return
      FROM public.portfolio_valuations pv
      WHERE pv.portfolio_id = get_portfolio_mining_dashboard.portfolio_id
      ORDER BY pv.valuation_date DESC
      LIMIT 1
    ),
    previous_valuation AS (
      SELECT pv.total_value
      FROM public.portfolio_valuations pv
      WHERE pv.portfolio_id = get_portfolio_mining_dashboard.portfolio_id
      ORDER BY pv.valuation_date DESC
      OFFSET 1
      LIMIT 1
    ),
    exposure_by_metal AS (
      SELECT COALESCE(NULLIF(mcp.primary_metal, ''), 'Other') AS name,
             SUM(h.quantity * COALESCE(alp.price, h.avg_cost, 0)) AS value
      FROM public.holdings h
      JOIN public.assets a ON a.id = h.asset_id
      LEFT JOIN public.mining_company_profiles mcp ON mcp.asset_id = a.id
      LEFT JOIN public.asset_latest_prices alp ON alp.instrument_id = a.instrument_id
      WHERE h.portfolio_id = get_portfolio_mining_dashboard.portfolio_id
      GROUP BY 1
    ),
    exposure_by_jurisdiction AS (
      SELECT COALESCE(NULLIF(mcp.jurisdiction, ''), 'Unknown') AS name,
             SUM(h.quantity * COALESCE(alp.price, h.avg_cost, 0)) AS value
      FROM public.holdings h
      JOIN public.assets a ON a.id = h.asset_id
      LEFT JOIN public.mining_company_profiles mcp ON mcp.asset_id = a.id
      LEFT JOIN public.asset_latest_prices alp ON alp.instrument_id = a.instrument_id
      WHERE h.portfolio_id = get_portfolio_mining_dashboard.portfolio_id
      GROUP BY 1
    ),
    stage_breakdown AS (
      SELECT COALESCE(mcp.stage::text, 'explorer') AS stage,
             COUNT(*)::int AS value
      FROM public.holdings h
      JOIN public.assets a ON a.id = h.asset_id
      LEFT JOIN public.mining_company_profiles mcp ON mcp.asset_id = a.id
      WHERE h.portfolio_id = get_portfolio_mining_dashboard.portfolio_id
      GROUP BY 1
    ),
    holdings_view AS (
      SELECT
        a.symbol,
        COALESCE(NULLIF(a.name, ''), a.symbol) AS name,
        COALESCE(mcp.stage::text, 'explorer') AS stage,
        COALESCE(NULLIF(mcp.primary_metal, ''), 'Other') AS metal,
        COALESCE(NULLIF(mcp.jurisdiction, ''), 'Unknown') AS jurisdiction,
        (h.quantity * COALESCE(alp.price, h.avg_cost, 0))::numeric AS position_value,
        CASE
          WHEN lv.total_value IS NULL OR lv.total_value = 0 THEN 0
          ELSE ((h.quantity * COALESCE(alp.price, h.avg_cost, 0)) / lv.total_value)
        END::numeric AS portfolio_weight,
        COALESCE(mvm.valuation_rating, 'N/A') AS ev_oz_rating
      FROM public.holdings h
      JOIN public.assets a ON a.id = h.asset_id
      LEFT JOIN latest_valuation lv ON true
      LEFT JOIN public.mining_company_profiles mcp ON mcp.asset_id = a.id
      LEFT JOIN public.mining_valuation_metrics mvm ON mvm.asset_id = a.id
      LEFT JOIN public.asset_latest_prices alp ON alp.instrument_id = a.instrument_id
      WHERE h.portfolio_id = get_portfolio_mining_dashboard.portfolio_id
    ),
    insights_view AS (
      SELECT title, description,
             CASE
               WHEN lower(COALESCE(severity::text, '')) IN ('critical', 'high') THEN 'high'
               WHEN lower(COALESCE(severity::text, '')) IN ('medium', 'med') THEN 'medium'
               ELSE 'low'
             END AS severity
      FROM public.mining_insights mi
      WHERE mi.portfolio_id = get_portfolio_mining_dashboard.portfolio_id
      ORDER BY created_at DESC
      LIMIT 20
    ),
    timeline AS (
      SELECT to_char(pv.valuation_date, 'YYYY-MM-DD') AS date,
             COALESCE(pv.total_value, 0) AS value
      FROM public.portfolio_valuations pv
      WHERE pv.portfolio_id = get_portfolio_mining_dashboard.portfolio_id
      ORDER BY pv.valuation_date ASC
      LIMIT 60
    )
    SELECT jsonb_build_object(
      'exposure_by_metal', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'value', value) ORDER BY value DESC) FROM exposure_by_metal), '[]'::jsonb),
      'exposure_by_jurisdiction', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'value', value) ORDER BY value DESC) FROM exposure_by_jurisdiction), '[]'::jsonb),
      'stage_breakdown', COALESCE((SELECT jsonb_agg(jsonb_build_object('stage', stage, 'value', value) ORDER BY value DESC) FROM stage_breakdown), '[]'::jsonb),
      'valuation_summary', jsonb_build_object(
        'portfolio_value', COALESCE((SELECT total_value FROM latest_valuation), 0),
        'daily_change', COALESCE((SELECT total_value FROM latest_valuation), 0) - COALESCE((SELECT total_value FROM previous_valuation), 0),
        'return_30d', COALESCE((SELECT total_return FROM latest_valuation), 0),
        'number_of_holdings', (SELECT COUNT(*) FROM holdings_view),
        'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', date, 'value', value) ORDER BY date ASC) FROM timeline), '[]'::jsonb),
        'deep_value_assets', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('symbol', symbol, 'signal', ev_oz_rating, 'score', CASE WHEN lower(ev_oz_rating) = 'deep value' THEN 100 WHEN lower(ev_oz_rating) = 'value' THEN 80 ELSE 50 END) ORDER BY position_value DESC)
          FROM holdings_view
          WHERE lower(ev_oz_rating) IN ('deep value', 'value')
        ), '[]'::jsonb)
      ),
      'insights', COALESCE((SELECT jsonb_agg(jsonb_build_object('title', title, 'description', description, 'severity', severity)) FROM insights_view), '[]'::jsonb),
      'holdings', COALESCE((SELECT jsonb_agg(jsonb_build_object('symbol', symbol, 'name', name, 'stage', stage, 'metal', metal, 'jurisdiction', jurisdiction, 'position_value', position_value, 'portfolio_weight', portfolio_weight, 'ev_oz_rating', ev_oz_rating) ORDER BY position_value DESC) FROM holdings_view), '[]'::jsonb)
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_portfolio_mining_dashboard(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_portfolio_mining_dashboard(UUID) TO authenticated, service_role;

-- >>> 20260403133000_company_ai_reports.sql
-- Company AI reports and paywall access controls.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_tier TEXT NOT NULL DEFAULT 'free';

CREATE TABLE IF NOT EXISTS public.company_ai_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
  model TEXT,
  report JSONB,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.company_ai_report_sales (
  report_id UUID NOT NULL REFERENCES public.company_ai_reports(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  price_paid NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_company_ai_reports_asset_created_at
  ON public.company_ai_reports (asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_ai_reports_created_by
  ON public.company_ai_reports (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_ai_reports_status
  ON public.company_ai_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_ai_report_sales_user_id
  ON public.company_ai_report_sales (user_id, created_at DESC);

ALTER TABLE public.company_ai_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_ai_report_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_ai_reports_select_auth"
  ON public.company_ai_reports
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "company_ai_reports_insert_auth"
  ON public.company_ai_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "company_ai_reports_update_owner"
  ON public.company_ai_reports
  FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "company_ai_report_sales_select_own"
  ON public.company_ai_report_sales
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.user_has_access_to_report(_user_id UUID, _report_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paywall_enabled BOOLEAN;
  v_created_by UUID;
  v_subscription_tier TEXT;
BEGIN
  v_paywall_enabled := COALESCE(NULLIF(current_setting('app.settings.paywall_enabled', true), ''), 'false')::BOOLEAN;
  IF NOT v_paywall_enabled THEN
    RETURN TRUE;
  END IF;

  SELECT created_by INTO v_created_by
  FROM public.company_ai_reports
  WHERE id = _report_id;

  IF v_created_by IS NULL THEN
    RETURN FALSE;
  END IF;

  IF _user_id = v_created_by THEN
    RETURN TRUE;
  END IF;

  SELECT lower(COALESCE(subscription_tier, 'free')) INTO v_subscription_tier
  FROM public.profiles
  WHERE user_id = _user_id;

  IF v_subscription_tier IN ('pro', 'max') THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.company_ai_report_sales s
    WHERE s.report_id = _report_id
      AND s.user_id = _user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.request_company_ai_report(
  _asset_id UUID,
  _portfolio_id UUID DEFAULT NULL,
  _assumptions JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  INSERT INTO public.company_ai_reports (
    asset_id,
    portfolio_id,
    created_by,
    status,
    assumptions
  ) VALUES (
    _asset_id,
    _portfolio_id,
    auth.uid(),
    'queued',
    COALESCE(_assumptions, '{}'::jsonb)
  )
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

REVOKE ALL ON TABLE public.company_ai_reports FROM PUBLIC;
REVOKE ALL ON TABLE public.company_ai_report_sales FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_has_access_to_report(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_company_ai_report(UUID, UUID, JSONB) FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON TABLE public.company_ai_reports TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.company_ai_report_sales TO service_role;
GRANT SELECT ON TABLE public.company_ai_report_sales TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_access_to_report(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_company_ai_report(UUID, UUID, JSONB) TO authenticated, service_role;

-- >>> 20260403180000_admin_activity_and_audit.sql
-- Add missing audit table/RPC and admin-aware RLS for global activity visibility.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_created_at
  ON public.audit_log (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_emails (
  email TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_emails ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'audit_log' AND policyname = 'audit_log_insert_authenticated'
  ) THEN
    CREATE POLICY "audit_log_insert_authenticated"
      ON public.audit_log
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'audit_log' AND policyname = 'audit_log_select_self_or_admin'
  ) THEN
    CREATE POLICY "audit_log_select_self_or_admin"
      ON public.audit_log
      FOR SELECT
      TO authenticated
      USING (
        auth.uid() = user_id
        OR EXISTS (
          SELECT 1
          FROM public.admin_emails ae
          WHERE lower(ae.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'admin_emails' AND policyname = 'admin_emails_select_admin_only'
  ) THEN
    CREATE POLICY "admin_emails_select_admin_only"
      ON public.admin_emails
      FOR SELECT
      TO authenticated
      USING (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.log_audit_action(
  _action TEXT,
  _entity_type TEXT DEFAULT NULL,
  _entity_id UUID DEFAULT NULL,
  _details JSONB DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), _action, _entity_type, _entity_id, COALESCE(_details, '{}'::jsonb));
END;
$$;

REVOKE ALL ON TABLE public.audit_log FROM PUBLIC;
REVOKE ALL ON TABLE public.admin_emails FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE public.audit_log TO authenticated, service_role;
GRANT SELECT ON TABLE public.admin_emails TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_audit_action(TEXT, TEXT, UUID, JSONB) TO authenticated, service_role;

-- >>> 20260403200000_fix_authenticated_table_and_sequence_grants.sql
-- Restore baseline table/sequence privileges for authenticated users.
-- RLS policies still enforce row-level access, but PostgREST requires
-- table-level grants to avoid `permission denied for table ...` errors.

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON ALL TABLES IN SCHEMA public
TO authenticated;

GRANT USAGE, SELECT
ON ALL SEQUENCES IN SCHEMA public
TO authenticated;

-- Ensure future schema changes inherit the same baseline grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
