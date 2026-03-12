-- Consolidated baseline migration created from prior migrations.
-- This file is intended for bootstrapping a new database from scratch.
-- ===== BEGIN 20260301203205_4e898804-e10e-47c2-be6b-bc1babcb681b.sql =====

-- Enum types
CREATE TYPE public.portfolio_visibility AS ENUM ('private', 'authenticated', 'public', 'group');
CREATE TYPE public.asset_type AS ENUM ('stock', 'etf', 'fund', 'metal', 'other');
CREATE TYPE public.invite_status AS ENUM ('pending', 'accepted', 'declined');
CREATE TYPE public.group_role AS ENUM ('owner', 'member');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  display_name TEXT,
  default_currency TEXT NOT NULL DEFAULT 'SEK',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view profiles" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Groups
CREATE TABLE public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

-- Group members
CREATE TABLE public.group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role group_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, user_id)
);
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

-- Group invites
CREATE TABLE public.group_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  invited_email TEXT,
  invited_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_by_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  token UUID NOT NULL DEFAULT gen_random_uuid(),
  status invite_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ
);
ALTER TABLE public.group_invites ENABLE ROW LEVEL SECURITY;

-- Assets
CREATE TABLE public.assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  asset_type asset_type NOT NULL DEFAULT 'stock',
  exchange TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  metadata_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Assets readable by all" ON public.assets FOR SELECT USING (true);
CREATE POLICY "Authenticated can insert assets" ON public.assets FOR INSERT TO authenticated WITH CHECK (true);

-- Prices
CREATE TABLE public.prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID REFERENCES public.assets(id) ON DELETE CASCADE NOT NULL,
  price NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  as_of_date DATE NOT NULL DEFAULT CURRENT_DATE,
  source TEXT DEFAULT 'twelve_data',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(asset_id, as_of_date)
);
ALTER TABLE public.prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Prices readable by all" ON public.prices FOR SELECT USING (true);

-- Portfolios
CREATE TABLE public.portfolios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  visibility portfolio_visibility NOT NULL DEFAULT 'private',
  group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL,
  public_slug TEXT UNIQUE,
  base_currency TEXT NOT NULL DEFAULT 'SEK',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;

-- Holdings
CREATE TABLE public.holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE CASCADE NOT NULL,
  asset_id UUID REFERENCES public.assets(id) ON DELETE CASCADE NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  avg_cost NUMERIC NOT NULL DEFAULT 0,
  cost_currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.holdings ENABLE ROW LEVEL SECURITY;

-- Portfolio valuations
CREATE TABLE public.portfolio_valuations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE CASCADE NOT NULL,
  total_value NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'SEK',
  as_of_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(portfolio_id, as_of_date)
);
ALTER TABLE public.portfolio_valuations ENABLE ROW LEVEL SECURITY;

-- Audit log
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own audit log" ON public.audit_log FOR SELECT USING (auth.uid() = user_id);

-- Helper functions (security definer to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_group_member(_user_id UUID, _group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE user_id = _user_id AND group_id = _group_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_group_owner(_user_id UUID, _group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.groups
    WHERE id = _group_id AND owner_user_id = _user_id
  );
$$;

-- RLS for groups
CREATE POLICY "Groups readable by members and authenticated" ON public.groups
  FOR SELECT USING (
    owner_user_id = auth.uid()
    OR public.is_group_member(auth.uid(), id)
  );
CREATE POLICY "Owner can create groups" ON public.groups
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "Owner can update groups" ON public.groups
  FOR UPDATE USING (auth.uid() = owner_user_id);
CREATE POLICY "Owner can delete groups" ON public.groups
  FOR DELETE USING (auth.uid() = owner_user_id);

-- Auto-add owner as member
CREATE OR REPLACE FUNCTION public.handle_new_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (NEW.id, NEW.owner_user_id, 'owner');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_group_created
  AFTER INSERT ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_group();

-- RLS for group_members
CREATE POLICY "Members can view group members" ON public.group_members
  FOR SELECT USING (public.is_group_member(auth.uid(), group_id));
CREATE POLICY "Owner can insert members" ON public.group_members
  FOR INSERT TO authenticated WITH CHECK (public.is_group_owner(auth.uid(), group_id));
CREATE POLICY "Owner can delete members" ON public.group_members
  FOR DELETE USING (public.is_group_owner(auth.uid(), group_id) OR user_id = auth.uid());

-- RLS for group_invites
CREATE POLICY "View own invites or group invites" ON public.group_invites
  FOR SELECT USING (
    invited_user_id = auth.uid()
    OR invited_by_user_id = auth.uid()
    OR public.is_group_member(auth.uid(), group_id)
  );
CREATE POLICY "Group owner can create invites" ON public.group_invites
  FOR INSERT TO authenticated WITH CHECK (public.is_group_owner(auth.uid(), group_id));
CREATE POLICY "Invited user can update invite" ON public.group_invites
  FOR UPDATE USING (invited_user_id = auth.uid() AND status = 'pending');

-- RLS for portfolios
CREATE POLICY "View portfolios based on visibility" ON public.portfolios
  FOR SELECT USING (
    owner_user_id = auth.uid()
    OR visibility = 'public'
    OR (visibility = 'authenticated' AND auth.uid() IS NOT NULL)
    OR (visibility = 'group' AND group_id IS NOT NULL AND public.is_group_member(auth.uid(), group_id))
  );
CREATE POLICY "Owner can insert portfolios" ON public.portfolios
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "Owner can update portfolios" ON public.portfolios
  FOR UPDATE USING (auth.uid() = owner_user_id);
CREATE POLICY "Owner can delete portfolios" ON public.portfolios
  FOR DELETE USING (auth.uid() = owner_user_id);

-- RLS for holdings (via portfolio ownership/visibility)
CREATE OR REPLACE FUNCTION public.can_view_portfolio(_portfolio_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.portfolios p
    WHERE p.id = _portfolio_id
    AND (
      p.owner_user_id = auth.uid()
      OR p.visibility = 'public'
      OR (p.visibility = 'authenticated' AND auth.uid() IS NOT NULL)
      OR (p.visibility = 'group' AND p.group_id IS NOT NULL AND public.is_group_member(auth.uid(), p.group_id))
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.owns_portfolio(_portfolio_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.portfolios WHERE id = _portfolio_id AND owner_user_id = auth.uid()
  );
$$;

CREATE POLICY "View holdings via portfolio visibility" ON public.holdings
  FOR SELECT USING (public.can_view_portfolio(portfolio_id));
CREATE POLICY "Owner can insert holdings" ON public.holdings
  FOR INSERT TO authenticated WITH CHECK (public.owns_portfolio(portfolio_id));
CREATE POLICY "Owner can update holdings" ON public.holdings
  FOR UPDATE USING (public.owns_portfolio(portfolio_id));
CREATE POLICY "Owner can delete holdings" ON public.holdings
  FOR DELETE USING (public.owns_portfolio(portfolio_id));

-- RLS for portfolio_valuations
CREATE POLICY "View valuations via portfolio" ON public.portfolio_valuations
  FOR SELECT USING (public.can_view_portfolio(portfolio_id));

-- Prices insert policy for edge functions (service role)
-- Prices are inserted by edge functions using service role key, so no RLS INSERT needed for users

-- Indexes
CREATE INDEX idx_holdings_portfolio ON public.holdings(portfolio_id);
CREATE INDEX idx_holdings_asset ON public.holdings(asset_id);
CREATE INDEX idx_prices_asset_date ON public.prices(asset_id, as_of_date DESC);
CREATE INDEX idx_portfolios_owner ON public.portfolios(owner_user_id);
CREATE INDEX idx_portfolios_visibility ON public.portfolios(visibility);
CREATE INDEX idx_portfolios_slug ON public.portfolios(public_slug);
CREATE INDEX idx_group_members_user ON public.group_members(user_id);
CREATE INDEX idx_group_members_group ON public.group_members(group_id);
CREATE INDEX idx_valuations_portfolio_date ON public.portfolio_valuations(portfolio_id, as_of_date DESC);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_portfolios_updated_at BEFORE UPDATE ON public.portfolios FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_holdings_updated_at BEFORE UPDATE ON public.holdings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- ===== END 20260301203205_4e898804-e10e-47c2-be6b-bc1babcb681b.sql =====
-- ===== BEGIN 20260302105013_091b68ff-cb11-42ac-aaa8-26de0de3330d.sql =====
-- Enable extensions used by scheduled price updates.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
-- ===== END 20260302105013_091b68ff-cb11-42ac-aaa8-26de0de3330d.sql =====
-- ===== BEGIN 20260302140000_access_and_leaderboard.sql =====
-- Centralized access helper to keep visibility checks consistent in SQL and RLS-aware queries.
CREATE OR REPLACE FUNCTION public.can_access_portfolio(_portfolio_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.portfolios AS p
    WHERE p.id = _portfolio_id
      AND (
        p.owner_user_id = auth.uid()
        OR p.visibility = 'public'
        OR (p.visibility = 'authenticated' AND auth.uid() IS NOT NULL)
        OR (
          p.visibility = 'group'
          AND p.group_id IS NOT NULL
          AND public.is_group_member(auth.uid(), p.group_id)
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_view_portfolio(_portfolio_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT public.can_access_portfolio(_portfolio_id);
$function$;

-- Server-side leaderboard over accessible portfolios only.
CREATE OR REPLACE FUNCTION public.get_leaderboard(_period TEXT DEFAULT 'ALL')
RETURNS TABLE (
  portfolio_id UUID,
  portfolio_name TEXT,
  visibility public.portfolio_visibility,
  owner_name TEXT,
  start_value NUMERIC,
  end_value NUMERIC,
  return_abs NUMERIC,
  return_pct NUMERIC,
  last_updated DATE
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  WITH params AS (
    SELECT
      CASE _period
        WHEN '1M' THEN (CURRENT_DATE - INTERVAL '1 month')::DATE
        WHEN '3M' THEN (CURRENT_DATE - INTERVAL '3 months')::DATE
        WHEN 'YTD' THEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::INT, 1, 1)
        WHEN '1Y' THEN (CURRENT_DATE - INTERVAL '1 year')::DATE
        ELSE DATE '2000-01-01'
      END AS period_start
  ),
  accessible AS (
    SELECT
      p.id,
      p.name,
      p.visibility,
      p.owner_user_id
    FROM public.portfolios AS p
    WHERE public.can_access_portfolio(p.id)
  ),
  valuation_points AS (
    SELECT
      a.id AS portfolio_id,
      (
        SELECT v.total_value
        FROM public.portfolio_valuations AS v, params
        WHERE v.portfolio_id = a.id
          AND v.as_of_date >= params.period_start
        ORDER BY v.as_of_date ASC
        LIMIT 1
      ) AS period_start_value,
      (
        SELECT v.total_value
        FROM public.portfolio_valuations AS v
        WHERE v.portfolio_id = a.id
        ORDER BY v.as_of_date ASC
        LIMIT 1
      ) AS first_ever_value,
      (
        SELECT v.total_value
        FROM public.portfolio_valuations AS v
        WHERE v.portfolio_id = a.id
        ORDER BY v.as_of_date DESC
        LIMIT 1
      ) AS latest_value,
      (
        SELECT v.as_of_date
        FROM public.portfolio_valuations AS v
        WHERE v.portfolio_id = a.id
        ORDER BY v.as_of_date DESC
        LIMIT 1
      ) AS latest_date
    FROM accessible AS a
  )
  SELECT
    a.id AS portfolio_id,
    a.name AS portfolio_name,
    a.visibility,
    COALESCE(pr.display_name, '–') AS owner_name,
    COALESCE(vp.period_start_value, vp.first_ever_value) AS start_value,
    vp.latest_value AS end_value,
    CASE
      WHEN vp.latest_value IS NULL THEN NULL
      ELSE vp.latest_value - COALESCE(vp.period_start_value, vp.first_ever_value)
    END AS return_abs,
    CASE
      WHEN COALESCE(vp.period_start_value, vp.first_ever_value) > 0
        AND vp.latest_value IS NOT NULL
      THEN (
        (
          vp.latest_value - COALESCE(vp.period_start_value, vp.first_ever_value)
        ) / COALESCE(vp.period_start_value, vp.first_ever_value)
      ) * 100
      ELSE NULL
    END AS return_pct,
    vp.latest_date AS last_updated
  FROM accessible AS a
  LEFT JOIN valuation_points AS vp ON vp.portfolio_id = a.id
  LEFT JOIN public.profiles AS pr ON pr.user_id = a.owner_user_id
  WHERE vp.latest_value IS NOT NULL
  ORDER BY return_pct DESC NULLS LAST, return_abs DESC NULLS LAST;
$function$;
-- ===== END 20260302140000_access_and_leaderboard.sql =====
-- ===== BEGIN 20260302153000_access_grants.sql =====
-- Ensure RPC functions are callable by app roles while still constrained by RLS helpers.
DO $do$
BEGIN
  IF to_regprocedure('public.can_access_portfolio(uuid)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.can_access_portfolio(UUID) TO authenticated, anon;
  END IF;

  IF to_regprocedure('public.get_leaderboard(text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_leaderboard(TEXT) TO authenticated;
  END IF;
END;
$do$;
-- ===== END 20260302153000_access_grants.sql =====
-- ===== BEGIN 20260303110000_onboarding_and_audit_rpc.sql =====
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.log_audit_action(
  _action TEXT,
  _entity_type TEXT DEFAULT NULL,
  _entity_id UUID DEFAULT NULL,
  _details JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), _action, _entity_type, _entity_id, COALESCE(_details, '{}'::jsonb));
END;
$$;

REVOKE INSERT ON public.audit_log FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.log_audit_action(TEXT, TEXT, UUID, JSONB) TO authenticated;
-- ===== END 20260303110000_onboarding_and_audit_rpc.sql =====
-- ===== BEGIN 20260303143000_database_hardening.sql =====
-- Database hardening: indexes, constraints, RLS safety, and leaderboard optimization.

-- 1) Data integrity constraints
ALTER TABLE public.holdings
  ADD CONSTRAINT holdings_quantity_non_negative CHECK (quantity >= 0),
  ADD CONSTRAINT holdings_avg_cost_non_negative CHECK (avg_cost >= 0);

ALTER TABLE public.prices
  ADD CONSTRAINT prices_price_positive CHECK (price > 0);

ALTER TABLE public.portfolios
  ADD CONSTRAINT portfolios_group_visibility_requires_group
  CHECK (visibility <> 'group' OR group_id IS NOT NULL);

ALTER TABLE public.holdings
  ADD CONSTRAINT holdings_unique_portfolio_asset UNIQUE (portfolio_id, asset_id);

-- 2) Indexes for common query paths and helper functions.
CREATE INDEX IF NOT EXISTS idx_portfolios_owner_user_id ON public.portfolios(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_portfolios_visibility ON public.portfolios(visibility);
CREATE INDEX IF NOT EXISTS idx_holdings_portfolio_id ON public.holdings(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_holdings_asset_id ON public.holdings(asset_id);
CREATE INDEX IF NOT EXISTS idx_prices_asset_id_as_of_date_desc ON public.prices(asset_id, as_of_date DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_valuations_portfolio_id_as_of_date_desc
  ON public.portfolio_valuations(portfolio_id, as_of_date DESC);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id_group_id ON public.group_members(user_id, group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON public.group_members(group_id);

-- 3) Safe helper functions for latest values.
CREATE OR REPLACE FUNCTION public.latest_portfolio_value(_portfolio_id UUID)
RETURNS TABLE (portfolio_id UUID, total_value NUMERIC, as_of_date DATE)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  SELECT pv.portfolio_id, pv.total_value, pv.as_of_date
  FROM public.portfolio_valuations AS pv
  WHERE pv.portfolio_id = _portfolio_id
  ORDER BY pv.as_of_date DESC
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.latest_price(_asset_id UUID)
RETURNS TABLE (asset_id UUID, price NUMERIC, as_of_date DATE)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  SELECT p.asset_id, p.price, p.as_of_date
  FROM public.prices AS p
  WHERE p.asset_id = _asset_id
  ORDER BY p.as_of_date DESC
  LIMIT 1;
$function$;

-- 4) Leaderboard optimization:
--    - scope to accessible portfolios only
--    - index-driven latest value lookup via helper
--    - index-driven period start lookup via LATERAL
CREATE OR REPLACE FUNCTION public.get_leaderboard(_period TEXT DEFAULT 'ALL')
RETURNS TABLE (
  portfolio_id UUID,
  portfolio_name TEXT,
  visibility public.portfolio_visibility,
  owner_name TEXT,
  start_value NUMERIC,
  end_value NUMERIC,
  return_abs NUMERIC,
  return_pct NUMERIC,
  last_updated DATE
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  WITH params AS (
    SELECT CASE _period
      WHEN '1M' THEN (CURRENT_DATE - INTERVAL '1 month')::DATE
      WHEN '3M' THEN (CURRENT_DATE - INTERVAL '3 months')::DATE
      WHEN 'YTD' THEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::INT, 1, 1)
      WHEN '1Y' THEN (CURRENT_DATE - INTERVAL '1 year')::DATE
      ELSE DATE '2000-01-01'
    END AS period_start
  ),
  accessible AS (
    SELECT p.id, p.name, p.visibility, p.owner_user_id
    FROM public.portfolios AS p
    WHERE public.can_access_portfolio(p.id)
  ),
  computed AS (
    SELECT
      a.id AS portfolio_id,
      a.name AS portfolio_name,
      a.visibility,
      a.owner_user_id,
      lv.total_value AS end_value,
      lv.as_of_date AS last_updated,
      COALESCE(ps.total_value, fe.total_value) AS start_value
    FROM accessible AS a
    LEFT JOIN LATERAL public.latest_portfolio_value(a.id) AS lv ON TRUE
    LEFT JOIN LATERAL (
      SELECT pv.total_value
      FROM public.portfolio_valuations AS pv, params
      WHERE pv.portfolio_id = a.id
        AND pv.as_of_date >= params.period_start
      ORDER BY pv.as_of_date ASC
      LIMIT 1
    ) AS ps ON TRUE
    LEFT JOIN LATERAL (
      SELECT pv.total_value
      FROM public.portfolio_valuations AS pv
      WHERE pv.portfolio_id = a.id
      ORDER BY pv.as_of_date ASC
      LIMIT 1
    ) AS fe ON TRUE
    WHERE lv.total_value IS NOT NULL
  )
  SELECT
    c.portfolio_id,
    c.portfolio_name,
    c.visibility,
    COALESCE(pr.display_name, '–') AS owner_name,
    c.start_value,
    c.end_value,
    c.end_value - c.start_value AS return_abs,
    CASE
      WHEN c.start_value > 0 THEN ((c.end_value - c.start_value) / c.start_value) * 100
      ELSE NULL
    END AS return_pct,
    c.last_updated
  FROM computed AS c
  LEFT JOIN public.profiles AS pr ON pr.user_id = c.owner_user_id
  ORDER BY return_pct DESC NULLS LAST, return_abs DESC NULLS LAST;
$function$;

-- 5) RLS hardening for audit log write-path.
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM authenticated, anon;

-- No direct write policy should exist for clients on audit_log.
DROP POLICY IF EXISTS "Users can insert own audit log" ON public.audit_log;
DROP POLICY IF EXISTS "Users can update own audit log" ON public.audit_log;
DROP POLICY IF EXISTS "Users can delete own audit log" ON public.audit_log;

-- 6) RPC grants
GRANT EXECUTE ON FUNCTION public.latest_portfolio_value(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.latest_price(UUID) TO authenticated, anon;
-- ===== END 20260303143000_database_hardening.sql =====
-- ===== BEGIN 20260304120000_holdings_v2_company_intelligence.sql =====
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
-- ===== END 20260304120000_holdings_v2_company_intelligence.sql =====
-- ===== BEGIN 20260304133000_company_metrics_rls_and_asset_type_safety.sql =====
-- Safety follow-up for holdings_v2 + company intelligence rollout.
-- 1) Add missing enum value in a Postgres-version-safe, idempotent way.
-- 2) Replace company_metrics RLS owner policy with explicit CRUD policies.
-- 3) Auto-populate created_by during inserts when omitted.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'asset_type'
      AND e.enumlabel = 'crypto'
  ) THEN
    ALTER TYPE public.asset_type ADD VALUE 'crypto';
  END IF;
END
$$;

ALTER TABLE public.company_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company metrics editable by owners/admin" ON public.company_metrics;
DROP POLICY IF EXISTS "Company metrics readable by all" ON public.company_metrics;
DROP POLICY IF EXISTS "Company metrics insert by creator" ON public.company_metrics;
DROP POLICY IF EXISTS "Company metrics update by creator" ON public.company_metrics;
DROP POLICY IF EXISTS "Company metrics delete by creator" ON public.company_metrics;

CREATE POLICY "Company metrics readable by all"
  ON public.company_metrics
  FOR SELECT
  USING (true);

CREATE POLICY "Company metrics insert by creator"
  ON public.company_metrics
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Company metrics update by creator"
  ON public.company_metrics
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Company metrics delete by creator"
  ON public.company_metrics
  FOR DELETE
  TO authenticated
  USING (auth.uid() = created_by);

CREATE OR REPLACE FUNCTION public.set_company_metrics_created_by()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_company_metrics_created_by() FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'set_company_metrics_created_by_before_insert'
      AND tgrelid = 'public.company_metrics'::regclass
  ) THEN
    CREATE TRIGGER set_company_metrics_created_by_before_insert
      BEFORE INSERT ON public.company_metrics
      FOR EACH ROW
      EXECUTE FUNCTION public.set_company_metrics_created_by();
  END IF;
END
$$;
-- ===== END 20260304133000_company_metrics_rls_and_asset_type_safety.sql =====
-- ===== BEGIN 20260304150000_transactions_and_group_board.sql =====
-- Transaction-led holdings operations + group board social feed.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_type') THEN
    CREATE TYPE public.transaction_type AS ENUM ('buy', 'sell', 'adjust', 'remove');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  type public.transaction_type NOT NULL,
  quantity NUMERIC NOT NULL,
  price NUMERIC,
  currency TEXT NOT NULL DEFAULT 'USD',
  traded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_transactions_portfolio_asset_time
  ON public.transactions (portfolio_id, asset_id, traded_at, created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON public.transactions (user_id);

DROP POLICY IF EXISTS "View transactions via portfolio visibility" ON public.transactions;
CREATE POLICY "View transactions via portfolio visibility" ON public.transactions
  FOR SELECT USING (public.can_view_portfolio(portfolio_id));

DROP POLICY IF EXISTS "Owner can insert transactions" ON public.transactions;
CREATE POLICY "Owner can insert transactions" ON public.transactions
  FOR INSERT TO authenticated WITH CHECK (public.owns_portfolio(portfolio_id) AND auth.uid() = user_id);

DROP POLICY IF EXISTS "Owner can update transactions" ON public.transactions;
CREATE POLICY "Owner can update transactions" ON public.transactions
  FOR UPDATE TO authenticated USING (public.owns_portfolio(portfolio_id) AND auth.uid() = user_id)
  WITH CHECK (public.owns_portfolio(portfolio_id) AND auth.uid() = user_id);

DROP POLICY IF EXISTS "Owner can delete transactions" ON public.transactions;
CREATE POLICY "Owner can delete transactions" ON public.transactions
  FOR DELETE TO authenticated USING (public.owns_portfolio(portfolio_id) AND auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.normalize_transaction_quantity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_qty NUMERIC := 0;
BEGIN
  IF NEW.quantity IS NULL THEN
    NEW.quantity := 0;
  END IF;

  IF NEW.type = 'buy' THEN
    NEW.quantity := abs(NEW.quantity);
  ELSIF NEW.type = 'sell' THEN
    NEW.quantity := -abs(NEW.quantity);
  ELSIF NEW.type = 'remove' THEN
    SELECT COALESCE(quantity, 0)
      INTO current_qty
    FROM public.holdings
    WHERE portfolio_id = NEW.portfolio_id AND asset_id = NEW.asset_id
    LIMIT 1;
    NEW.quantity := -abs(current_qty);
  END IF;

  IF NEW.type IN ('buy', 'sell') AND NEW.price IS NULL THEN
    RAISE EXCEPTION 'price is required for buy/sell transactions';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_holding_from_transactions(_portfolio_id UUID, _asset_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tx RECORD;
  running_qty NUMERIC := 0;
  running_avg NUMERIC := 0;
  realized NUMERIC := 0;
  qty_after NUMERIC;
BEGIN
  FOR tx IN
    SELECT *
    FROM public.transactions
    WHERE portfolio_id = _portfolio_id AND asset_id = _asset_id
    ORDER BY traded_at, created_at, id
  LOOP
    IF tx.type = 'buy' OR (tx.type = 'adjust' AND tx.quantity > 0) THEN
      IF running_qty + tx.quantity > 0 THEN
        running_avg := ((running_qty * running_avg) + (tx.quantity * COALESCE(tx.price, running_avg, 0))) / (running_qty + tx.quantity);
      END IF;
      running_qty := running_qty + tx.quantity;
    ELSIF tx.type = 'remove' THEN
      running_qty := 0;
      running_avg := 0;
    ELSE
      qty_after := running_qty + tx.quantity;
      IF tx.quantity < 0 AND running_qty > 0 AND COALESCE(tx.price, 0) > 0 THEN
        realized := realized + ((COALESCE(tx.price, 0) - running_avg) * abs(tx.quantity));
      END IF;
      running_qty := GREATEST(qty_after, 0);
      IF running_qty = 0 THEN
        running_avg := 0;
      END IF;
    END IF;
  END LOOP;

  IF running_qty <= 0 THEN
    DELETE FROM public.holdings
    WHERE portfolio_id = _portfolio_id AND asset_id = _asset_id;
  ELSE
    INSERT INTO public.holdings (portfolio_id, asset_id, quantity, avg_cost, cost_currency)
    VALUES (_portfolio_id, _asset_id, running_qty, running_avg, 'USD')
    ON CONFLICT (portfolio_id, asset_id)
    DO UPDATE SET quantity = EXCLUDED.quantity, avg_cost = EXCLUDED.avg_cost, updated_at = now();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_holdings_from_transactions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_holding_from_transactions(OLD.portfolio_id, OLD.asset_id);
    RETURN OLD;
  END IF;

  PERFORM public.recompute_holding_from_transactions(NEW.portfolio_id, NEW.asset_id);

  IF TG_OP = 'UPDATE' AND (OLD.portfolio_id <> NEW.portfolio_id OR OLD.asset_id <> NEW.asset_id) THEN
    PERFORM public.recompute_holding_from_transactions(OLD.portfolio_id, OLD.asset_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_normalize_before ON public.transactions;
CREATE TRIGGER transactions_normalize_before
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.normalize_transaction_quantity();

DROP TRIGGER IF EXISTS transactions_sync_holdings_after ON public.transactions;
CREATE TRIGGER transactions_sync_holdings_after
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.sync_holdings_from_transactions();

CREATE OR REPLACE FUNCTION public.audit_transaction_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID;
BEGIN
  actor := COALESCE(auth.uid(), NEW.user_id, OLD.user_id);

  INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, details)
  VALUES (
    actor,
    'transaction_' || lower(TG_OP),
    'transaction',
    COALESCE(NEW.id, OLD.id),
    jsonb_build_object(
      'portfolio_id', COALESCE(NEW.portfolio_id, OLD.portfolio_id),
      'asset_id', COALESCE(NEW.asset_id, OLD.asset_id),
      'type', COALESCE(NEW.type, OLD.type),
      'quantity', COALESCE(NEW.quantity, OLD.quantity),
      'price', COALESCE(NEW.price, OLD.price),
      'traded_at', COALESCE(NEW.traded_at, OLD.traded_at)
    )
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS transactions_audit_after ON public.transactions;
CREATE TRIGGER transactions_audit_after
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.audit_transaction_mutation();

CREATE TABLE IF NOT EXISTS public.group_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'message' CHECK (type IN ('message','note')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_group_messages_group_created ON public.group_messages (group_id, created_at DESC);

DROP POLICY IF EXISTS "Group members can read messages" ON public.group_messages;
CREATE POLICY "Group members can read messages" ON public.group_messages
  FOR SELECT USING (public.is_group_member(auth.uid(), group_id));

DROP POLICY IF EXISTS "Group members can create messages" ON public.group_messages;
CREATE POLICY "Group members can create messages" ON public.group_messages
  FOR INSERT TO authenticated WITH CHECK (public.is_group_member(auth.uid(), group_id) AND auth.uid() = user_id);

DROP POLICY IF EXISTS "Author or owner can delete message" ON public.group_messages;
CREATE POLICY "Author or owner can delete message" ON public.group_messages
  FOR DELETE TO authenticated USING (
    auth.uid() = user_id OR public.is_group_owner(auth.uid(), group_id)
  );
-- ===== END 20260304150000_transactions_and_group_board.sql =====
-- ===== BEGIN 20260304162000_transaction_constraints_and_exchange_metadata.sql =====
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
-- ===== END 20260304162000_transaction_constraints_and_exchange_metadata.sql =====
-- ===== BEGIN 20260305100000_symbol_resolution_and_pricing.sql =====
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
-- ===== END 20260305100000_symbol_resolution_and_pricing.sql =====
-- ===== BEGIN 20260305113000_transactions_import_and_intelligence.sql =====
-- Transaction import schema expansion + asset research + holdings rebuild rpc.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS broker TEXT,
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS trade_date DATE,
  ADD COLUMN IF NOT EXISTS settle_date DATE,
  ADD COLUMN IF NOT EXISTS isin TEXT,
  ADD COLUMN IF NOT EXISTS symbol TEXT,
  ADD COLUMN IF NOT EXISTS exchange TEXT,
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS price_currency TEXT,
  ADD COLUMN IF NOT EXISTS fx_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS fees NUMERIC,
  ADD COLUMN IF NOT EXISTS fees_currency TEXT,
  ADD COLUMN IF NOT EXISTS total_local NUMERIC,
  ADD COLUMN IF NOT EXISTS total_foreign NUMERIC,
  ADD COLUMN IF NOT EXISTS raw JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.transactions SET owner_user_id = user_id WHERE owner_user_id IS NULL;
ALTER TABLE public.transactions ALTER COLUMN owner_user_id SET NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN asset_id DROP NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN quantity DROP NOT NULL;

-- SAFE enum -> text migration using a new column
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS type_text TEXT;
UPDATE public.transactions SET type_text = type::text WHERE type_text IS NULL;

ALTER TABLE public.transactions ALTER COLUMN type DROP DEFAULT;
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;

-- Remove old enum column and replace with text column
ALTER TABLE public.transactions DROP COLUMN type;
ALTER TABLE public.transactions RENAME COLUMN type_text TO type;
ALTER TABLE public.transactions ALTER COLUMN type SET NOT NULL;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('buy', 'sell', 'dividend', 'fee', 'deposit', 'withdrawal', 'split', 'transfer', 'adjust', 'remove'));

DROP TYPE IF EXISTS public.transaction_type;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_portfolio_broker_external_id
  ON public.transactions(portfolio_id, broker, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_portfolio_trade_date ON public.transactions(portfolio_id, trade_date);
CREATE INDEX IF NOT EXISTS idx_transactions_isin ON public.transactions(isin);
CREATE INDEX IF NOT EXISTS idx_transactions_symbol ON public.transactions(symbol);

DROP TRIGGER IF EXISTS transactions_normalize_before ON public.transactions;
DROP TRIGGER IF EXISTS transactions_sync_holdings_after ON public.transactions;

DROP POLICY IF EXISTS "Owner can insert transactions" ON public.transactions;
CREATE POLICY "Owner can insert transactions" ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.owns_portfolio(portfolio_id) AND auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "Owner can update transactions" ON public.transactions;
CREATE POLICY "Owner can update transactions" ON public.transactions
  FOR UPDATE TO authenticated
  USING (public.owns_portfolio(portfolio_id) AND auth.uid() = owner_user_id)
  WITH CHECK (public.owns_portfolio(portfolio_id) AND auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "Owner can delete transactions" ON public.transactions;
CREATE POLICY "Owner can delete transactions" ON public.transactions
  FOR DELETE TO authenticated
  USING (public.owns_portfolio(portfolio_id) AND auth.uid() = owner_user_id);

CREATE TABLE IF NOT EXISTS public.asset_research (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  bucket TEXT,
  thesis_type TEXT,
  rating TEXT,
  investment_recommendation TEXT,
  projected_price NUMERIC,
  low_valuation_estimate NUMERIC,
  high_valuation_estimate NUMERIC,
  properties_ownership TEXT,
  management_team TEXT,
  share_structure TEXT,
  location TEXT,
  projected_growth TEXT,
  market_buzz TEXT,
  cost_structure_financing TEXT,
  cash_debt_position TEXT,
  assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(portfolio_id, asset_id)
);

ALTER TABLE public.asset_research ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_asset_research_portfolio ON public.asset_research(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_asset_research_asset ON public.asset_research(asset_id);

CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS asset_research_set_updated_at ON public.asset_research;
CREATE TRIGGER asset_research_set_updated_at
  BEFORE UPDATE ON public.asset_research
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

DROP POLICY IF EXISTS "Asset research visible via portfolio visibility" ON public.asset_research;
CREATE POLICY "Asset research visible via portfolio visibility" ON public.asset_research
  FOR SELECT USING (public.can_view_portfolio(portfolio_id));

DROP POLICY IF EXISTS "Asset research owner manage" ON public.asset_research;
CREATE POLICY "Asset research owner manage" ON public.asset_research
  FOR ALL TO authenticated
  USING (public.owns_portfolio(portfolio_id))
  WITH CHECK (public.owns_portfolio(portfolio_id));

CREATE OR REPLACE FUNCTION public.rebuild_holdings(_portfolio_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  tx RECORD;
  running_qty NUMERIC;
  running_avg NUMERIC;
  cost_basis NUMERIC;
  tx_qty NUMERIC;
  tx_price NUMERIC;
  tx_fees NUMERIC;
BEGIN
  FOR r IN
    SELECT DISTINCT asset_id
    FROM public.transactions
    WHERE portfolio_id = _portfolio_id AND asset_id IS NOT NULL
  LOOP
    running_qty := 0;
    running_avg := 0;
    cost_basis := 0;

    FOR tx IN
      SELECT *
      FROM public.transactions
      WHERE portfolio_id = _portfolio_id AND asset_id = r.asset_id
      ORDER BY COALESCE(trade_date, traded_at::date, created_at::date), created_at, id
    LOOP
      tx_qty := GREATEST(COALESCE(tx.quantity, 0), 0);
      tx_price := COALESCE(tx.price, 0);
      tx_fees := COALESCE(tx.fees, 0);

      IF tx.type = 'buy' THEN
        running_qty := running_qty + tx_qty;
        cost_basis := cost_basis + (tx_qty * tx_price + tx_fees);
        running_avg := CASE WHEN running_qty > 0 THEN cost_basis / running_qty ELSE 0 END;
      ELSIF tx.type = 'sell' THEN
        IF running_qty > 0 THEN
          running_qty := GREATEST(running_qty - tx_qty, 0);
          cost_basis := GREATEST(cost_basis - (tx_qty * running_avg), 0);
          running_avg := CASE WHEN running_qty > 0 THEN cost_basis / running_qty ELSE 0 END;
        END IF;
      END IF;
    END LOOP;

    IF running_qty <= 0 THEN
      INSERT INTO public.holdings (portfolio_id, asset_id, quantity, avg_cost, cost_currency)
      VALUES (_portfolio_id, r.asset_id, 0, 0, 'USD')
      ON CONFLICT (portfolio_id, asset_id)
      DO UPDATE SET quantity = 0, avg_cost = 0, updated_at = now();
    ELSE
      INSERT INTO public.holdings (portfolio_id, asset_id, quantity, avg_cost, cost_currency)
      VALUES (_portfolio_id, r.asset_id, running_qty, running_avg, 'USD')
      ON CONFLICT (portfolio_id, asset_id)
      DO UPDATE SET quantity = EXCLUDED.quantity, avg_cost = EXCLUDED.avg_cost, updated_at = now();
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rebuild_holdings(UUID) TO authenticated;
-- ===== END 20260305113000_transactions_import_and_intelligence.sql =====
-- ===== BEGIN 20260305133000_bucket_classification.sql =====
-- Automatic bucket classification with manual overrides + seeded map.

ALTER TABLE public.asset_research
  ADD COLUMN IF NOT EXISTS bucket_override TEXT,
  ADD COLUMN IF NOT EXISTS bucket_computed TEXT NOT NULL DEFAULT 'Unclassified',
  ADD COLUMN IF NOT EXISTS bucket_confidence NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bucket_reason TEXT;

UPDATE public.asset_research
SET bucket_override = bucket
WHERE bucket IS NOT NULL
  AND NULLIF(trim(bucket), '') IS NOT NULL
  AND (bucket_override IS NULL OR NULLIF(trim(bucket_override), '') IS NULL);

ALTER TABLE public.asset_research DROP COLUMN IF EXISTS bucket;

CREATE TABLE IF NOT EXISTS public.asset_bucket_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  exchange_code TEXT,
  bucket TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'seed',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(symbol, exchange_code)
);

CREATE INDEX IF NOT EXISTS idx_asset_bucket_map_symbol ON public.asset_bucket_map(symbol);
CREATE INDEX IF NOT EXISTS idx_asset_bucket_map_symbol_exchange ON public.asset_bucket_map(symbol, exchange_code);

ALTER TABLE public.asset_bucket_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Asset bucket map readable by all" ON public.asset_bucket_map;
CREATE POLICY "Asset bucket map readable by all" ON public.asset_bucket_map FOR SELECT USING (true);

WITH seed(symbol, bucket) AS (
  VALUES
    ('B', 'Major Producer'),
    ('KGC', 'Major Producer'),
    ('NEM', 'Major Producer'),
    ('AYA', 'Mid Tier Producer'),
    ('ASM', 'Mid Tier Producer'),
    ('AG', 'Mid Tier Producer'),
    ('GMIN', 'Mid Tier Producer'),
    ('PAAS', 'Mid Tier Producer'),
    ('CDE', 'Mid Tier Producer'),
    ('HE', 'Mid Tier Producer'),
    ('EXK', 'Mid Tier Producer'),
    ('JAG', 'Mid Tier Producer'),
    ('USA', 'Junior Producer'),
    ('TSK', 'Junior Producer'),
    ('AGX', 'Junior Producer'),
    ('GSVR', 'Junior Producer'),
    ('SCZ', 'Junior Producer'),
    ('BCM', 'Junior Producer'),
    ('EXN', 'Near Term Producer'),
    ('VZLA', 'Near Term Producer'),
    ('AGMR', 'Near Term Producer'),
    ('GRSL', 'Near Term Producer'),
    ('SSV', 'Late Stage Developer'),
    ('LG', 'Late Stage Developer'),
    ('1911', 'Late Stage Developer'),
    ('ABRA', 'Late Stage Developer'),
    ('NEXG', 'Late Stage Developer'),
    ('CKG', 'Late Stage Developer'),
    ('APGO', 'Late Stage Developer'),
    ('TUD', 'Late Stage Developer'),
    ('WGO', 'Late Stage Developer'),
    ('SIG', 'Early Stage Explorer'),
    ('SKP', 'Early Stage Explorer'),
    ('HAMR', 'Early Stage Explorer')
)
INSERT INTO public.asset_bucket_map(symbol, exchange_code, bucket, source)
SELECT symbol, NULL, bucket, 'seed'
FROM seed
ON CONFLICT (symbol, exchange_code)
DO UPDATE SET bucket = EXCLUDED.bucket, source = EXCLUDED.source, updated_at = now();

CREATE OR REPLACE FUNCTION public.refresh_asset_research(_portfolio_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_bucket TEXT;
  v_confidence NUMERIC;
  v_reason TEXT;
  v_market_cap NUMERIC;
  v_revenue NUMERIC;
  v_resource_estimate NUMERIC;
  v_stage TEXT;
BEGIN
  IF _portfolio_id IS NULL THEN
    RAISE EXCEPTION 'portfolio id is required';
  END IF;

  -- Ensure a research row exists for all assets in holdings.
  INSERT INTO public.asset_research (portfolio_id, asset_id)
  SELECT h.portfolio_id, h.asset_id
  FROM public.holdings h
  WHERE h.portfolio_id = _portfolio_id
  ON CONFLICT (portfolio_id, asset_id) DO NOTHING;

  FOR r IN
    SELECT ar.id, ar.bucket_override, ar.assumptions, a.symbol, a.exchange_code
    FROM public.asset_research ar
    JOIN public.assets a ON a.id = ar.asset_id
    WHERE ar.portfolio_id = _portfolio_id
  LOOP
    v_bucket := NULL;
    v_confidence := 0;
    v_reason := NULL;

    IF NULLIF(trim(coalesce(r.bucket_override, '')), '') IS NOT NULL THEN
      v_bucket := trim(r.bucket_override);
      v_confidence := 1.0;
      v_reason := 'Manual override';
    ELSE
      SELECT abm.bucket, 0.95, 'Seeded mapping (symbol + exchange)'
      INTO v_bucket, v_confidence, v_reason
      FROM public.asset_bucket_map abm
      WHERE upper(abm.symbol) = upper(r.symbol)
        AND upper(coalesce(abm.exchange_code, '')) = upper(coalesce(r.exchange_code, ''))
      LIMIT 1;

      IF v_bucket IS NULL THEN
        SELECT abm.bucket, 0.85, 'Seeded mapping (symbol only)'
        INTO v_bucket, v_confidence, v_reason
        FROM public.asset_bucket_map abm
        WHERE upper(abm.symbol) = upper(r.symbol)
          AND abm.exchange_code IS NULL
        LIMIT 1;
      END IF;

      IF v_bucket IS NULL THEN
        v_market_cap := NULLIF(r.assumptions->>'market_cap', '')::NUMERIC;
        v_revenue := NULLIF(r.assumptions->>'revenue', '')::NUMERIC;
        v_resource_estimate := NULLIF(r.assumptions->>'resource_estimate', '')::NUMERIC;
        v_stage := lower(trim(coalesce(r.assumptions->>'stage', '')));

        IF v_market_cap IS NOT NULL AND v_revenue IS NOT NULL AND v_revenue > 0 THEN
          IF v_market_cap >= 10000000000 THEN
            v_bucket := 'Major Producer';
            v_confidence := 0.7;
            v_reason := 'Heuristic: market cap >= 10B and revenue > 0';
          ELSIF v_market_cap >= 2000000000 THEN
            v_bucket := 'Mid Tier Producer';
            v_confidence := 0.65;
            v_reason := 'Heuristic: market cap 2B..10B and revenue > 0';
          ELSE
            v_bucket := 'Junior Producer';
            v_confidence := 0.6;
            v_reason := 'Heuristic: market cap < 2B and revenue > 0';
          END IF;
        ELSIF v_revenue = 0 AND v_resource_estimate IS NOT NULL THEN
          IF v_stage IN ('construction', 'near term', 'near-term', 'near_term', 'development', 'developer', 'late stage', 'late-stage', 'feasibility') THEN
            v_bucket := 'Developer';
            v_confidence := 0.55;
            v_reason := 'Heuristic: revenue = 0 with resource estimate and development stage';
          ELSE
            v_bucket := 'Explorer';
            v_confidence := 0.5;
            v_reason := 'Heuristic: revenue = 0 with resource estimate and no development stage';
          END IF;
        END IF;
      END IF;

      IF v_bucket IS NULL THEN
        v_bucket := 'Unclassified';
        v_confidence := 0.2;
        v_reason := 'Insufficient data';
      END IF;
    END IF;

    UPDATE public.asset_research
    SET
      bucket_computed = v_bucket,
      bucket_confidence = GREATEST(LEAST(v_confidence, 1), 0),
      bucket_reason = v_reason,
      updated_at = now()
    WHERE id = r.id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_asset_research(UUID) TO authenticated;
-- ===== END 20260305133000_bucket_classification.sql =====
-- ===== BEGIN 20260306100000_company_ai_reports_pipeline.sql =====
CREATE TABLE IF NOT EXISTS public.company_ai_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  portfolio_id UUID NULL REFERENCES public.portfolios(id) ON DELETE SET NULL,
  created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL DEFAULT 'v1',
  assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
  report JSONB NULL,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT NULL,
  tokens_in INT NULL,
  tokens_out INT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_company_ai_reports_asset_created
  ON public.company_ai_reports(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_ai_reports_portfolio_created
  ON public.company_ai_reports(portfolio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_ai_reports_status
  ON public.company_ai_reports(status);

ALTER TABLE public.company_ai_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company AI reports readable with portfolio visibility" ON public.company_ai_reports;
CREATE POLICY "Company AI reports readable with portfolio visibility"
ON public.company_ai_reports
FOR SELECT
USING (
  (portfolio_id IS NOT NULL AND public.can_view_portfolio(portfolio_id))
  OR (
    portfolio_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.companies c
      WHERE c.asset_id = company_ai_reports.asset_id
    )
  )
);

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
  _user_id UUID := auth.uid();
  _report_id UUID;
  _force BOOLEAN := COALESCE((_assumptions ->> 'force')::BOOLEAN, FALSE);
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.assets a WHERE a.id = _asset_id) THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  IF _portfolio_id IS NOT NULL AND NOT public.can_view_portfolio(_portfolio_id) THEN
    RAISE EXCEPTION 'Not allowed to access this portfolio';
  END IF;

  IF _portfolio_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.companies c WHERE c.asset_id = _asset_id
  ) THEN
    RAISE EXCEPTION 'Asset does not have a company profile';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM public.company_ai_reports r
    WHERE r.created_by = _user_id
      AND r.created_at >= now() - interval '1 day'
  ) >= 5 THEN
    RAISE EXCEPTION 'Daily report limit reached (5/day)';
  END IF;

  IF NOT _force AND EXISTS (
    SELECT 1
    FROM public.company_ai_reports r
    WHERE r.asset_id = _asset_id
      AND r.status = 'completed'
      AND (_portfolio_id IS NULL OR r.portfolio_id IS NOT DISTINCT FROM _portfolio_id)
      AND r.created_at >= now() - interval '24 hours'
  ) THEN
    RAISE EXCEPTION 'A completed report already exists in the last 24h. Use force=true to regenerate.';
  END IF;

  INSERT INTO public.company_ai_reports (asset_id, portfolio_id, created_by, status, model, prompt_version, assumptions)
  VALUES (
    _asset_id,
    _portfolio_id,
    _user_id,
    'queued',
    COALESCE(_assumptions ->> 'model', 'gpt-4.1-mini'),
    'v1',
    COALESCE(_assumptions, '{}'::jsonb)
  )
  RETURNING id INTO _report_id;

  RETURN _report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_company_ai_report(UUID, UUID, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_latest_company_ai_report(
  _asset_id UUID,
  _portfolio_id UUID DEFAULT NULL
)
RETURNS public.company_ai_reports
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT r.*
  FROM public.company_ai_reports r
  WHERE r.asset_id = _asset_id
    AND r.status = 'completed'
    AND (_portfolio_id IS NULL OR r.portfolio_id IS NOT DISTINCT FROM _portfolio_id)
  ORDER BY r.created_at DESC
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_latest_company_ai_report(UUID, UUID) TO anon, authenticated;
-- ===== END 20260306100000_company_ai_reports_pipeline.sql =====
-- ===== BEGIN 20260307110000_report_paywall.sql =====
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS subscription_tier TEXT NOT NULL DEFAULT 'free';

CREATE TABLE IF NOT EXISTS public.company_ai_report_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.company_ai_reports(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  price_paid NUMERIC NOT NULL,
  currency TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (report_id, user_id),
  UNIQUE (payment_id)
);

CREATE INDEX IF NOT EXISTS idx_company_ai_report_sales_report_user
  ON public.company_ai_report_sales(report_id, user_id);

ALTER TABLE public.company_ai_report_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own report sales" ON public.company_ai_report_sales;
CREATE POLICY "Users can view own report sales"
ON public.company_ai_report_sales
FOR SELECT
USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.user_has_access_to_report(_user_id UUID, _report_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _current_user UUID := auth.uid();
BEGIN
  IF _current_user IS NOT NULL AND _current_user IS DISTINCT FROM _user_id THEN
    RAISE EXCEPTION 'Cannot check report access for another user';
  END IF;

  IF _user_id IS NULL OR _report_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.company_ai_reports r
    WHERE r.id = _report_id
      AND r.created_by = _user_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.company_ai_report_sales s
    WHERE s.report_id = _report_id
      AND s.user_id = _user_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = _user_id
      AND lower(COALESCE(p.subscription_tier, 'free')) = 'pro'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_has_access_to_report(UUID, UUID) TO authenticated;

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
  _user_id UUID := auth.uid();
  _report_id UUID;
  _existing_report_id UUID;
  _force BOOLEAN := COALESCE((_assumptions ->> 'force')::BOOLEAN, FALSE);
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.assets a WHERE a.id = _asset_id) THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;

  IF _portfolio_id IS NOT NULL AND NOT public.can_view_portfolio(_portfolio_id) THEN
    RAISE EXCEPTION 'Not allowed to access this portfolio';
  END IF;

  IF _portfolio_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.companies c WHERE c.asset_id = _asset_id
  ) THEN
    RAISE EXCEPTION 'Asset does not have a company profile';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM public.company_ai_reports r
    WHERE r.created_by = _user_id
      AND r.created_at >= now() - interval '1 day'
  ) >= 5 THEN
    RAISE EXCEPTION 'Daily report limit reached (5/day)';
  END IF;

  IF NOT _force THEN
    SELECT r.id
    INTO _existing_report_id
    FROM public.company_ai_reports r
    WHERE r.asset_id = _asset_id
      AND r.status = 'completed'
      AND (_portfolio_id IS NULL OR r.portfolio_id IS NOT DISTINCT FROM _portfolio_id)
      AND r.created_at >= now() - interval '30 days'
    ORDER BY r.created_at DESC
    LIMIT 1;

    IF _existing_report_id IS NOT NULL THEN
      RETURN _existing_report_id;
    END IF;
  END IF;

  INSERT INTO public.company_ai_reports (asset_id, portfolio_id, created_by, status, model, prompt_version, assumptions)
  VALUES (
    _asset_id,
    _portfolio_id,
    _user_id,
    'queued',
    COALESCE(_assumptions ->> 'model', 'gpt-4.1-mini'),
    'v1',
    COALESCE(_assumptions, '{}'::jsonb)
  )
  RETURNING id INTO _report_id;

  RETURN _report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_company_ai_report(UUID, UUID, JSONB) TO authenticated;
-- ===== END 20260307110000_report_paywall.sql =====
-- ===== BEGIN 20260308100000_friends_mode_paywall_switch.sql =====
CREATE OR REPLACE FUNCTION public.paywall_enabled()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.settings.paywall_enabled', true), ''), 'false')::BOOLEAN;
$$;

ALTER TABLE public.profiles
  ALTER COLUMN subscription_tier DROP DEFAULT;

ALTER TABLE public.profiles
  ALTER COLUMN subscription_tier SET DEFAULT (
    CASE WHEN public.paywall_enabled() THEN 'free' ELSE 'max' END
  );

UPDATE public.profiles
SET subscription_tier = CASE WHEN public.paywall_enabled() THEN 'free' ELSE 'max' END
WHERE subscription_tier IS NULL OR btrim(subscription_tier) = '';

CREATE OR REPLACE FUNCTION public.user_has_access_to_report(_user_id UUID, _report_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _current_user UUID := auth.uid();
BEGIN
  IF _current_user IS NOT NULL AND _current_user IS DISTINCT FROM _user_id THEN
    RAISE EXCEPTION 'Cannot check report access for another user';
  END IF;

  IF NOT public.paywall_enabled() THEN
    RETURN TRUE;
  END IF;

  IF _user_id IS NULL OR _report_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.company_ai_reports r
    WHERE r.id = _report_id
      AND r.created_by = _user_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.company_ai_report_sales s
    WHERE s.report_id = _report_id
      AND s.user_id = _user_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = _user_id
      AND lower(COALESCE(p.subscription_tier, 'free')) IN ('pro', 'max')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, subscription_tier)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    CASE WHEN public.paywall_enabled() THEN 'free' ELSE 'max' END
  );
  RETURN NEW;
END;
$$;
-- ===== END 20260308100000_friends_mode_paywall_switch.sql =====
-- ===== BEGIN 20260308143000_nordea_transactions_and_holdings_recompute.sql =====
-- Nordea transaction import schema and holdings recompute RPC.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS trade_id TEXT,
  ADD COLUMN IF NOT EXISTS trade_type TEXT,
  ADD COLUMN IF NOT EXISTS symbol_raw TEXT,
  ADD COLUMN IF NOT EXISTS exchange_raw TEXT,
  ADD COLUMN IF NOT EXISTS traded_at DATE,
  ADD COLUMN IF NOT EXISTS settle_at DATE,
  ADD COLUMN IF NOT EXISTS trade_currency TEXT,
  ADD COLUMN IF NOT EXISTS gross NUMERIC,
  ADD COLUMN IF NOT EXISTS net NUMERIC,
  ADD COLUMN IF NOT EXISTS base_currency TEXT NOT NULL DEFAULT 'SEK',
  ADD COLUMN IF NOT EXISTS raw_row JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.transactions
SET trade_id = COALESCE(trade_id, external_id),
    trade_type = COALESCE(trade_type, type),
    symbol_raw = COALESCE(symbol_raw, symbol),
    exchange_raw = COALESCE(exchange_raw, exchange),
    traded_at = COALESCE(traded_at, trade_date, traded_at::date),
    settle_at = COALESCE(settle_at, settle_date),
    trade_currency = COALESCE(trade_currency, price_currency, currency),
    gross = COALESCE(gross, total_foreign),
    net = COALESCE(net, total_local),
    raw_row = COALESCE(raw_row, raw, '{}'::jsonb)
WHERE TRUE;

ALTER TABLE public.transactions
  ALTER COLUMN broker SET NOT NULL,
  ALTER COLUMN trade_type SET NOT NULL,
  ALTER COLUMN quantity SET DEFAULT 0,
  ALTER COLUMN quantity SET NOT NULL,
  ALTER COLUMN base_currency SET NOT NULL,
  ALTER COLUMN raw_row SET NOT NULL;

DROP INDEX IF EXISTS idx_transactions_portfolio_broker_external_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_portfolio_broker_trade_id
  ON public.transactions (portfolio_id, broker, trade_id)
  WHERE trade_id IS NOT NULL;

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_trade_type_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_trade_type_check CHECK (trade_type IN ('buy', 'sell', 'dividend', 'fee', 'fx', 'unknown'));

ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS exchange_code TEXT;

CREATE OR REPLACE FUNCTION public.build_provider_symbol(_symbol TEXT, _exchange_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  symbol_clean TEXT := upper(trim(COALESCE(_symbol, '')));
  exchange_clean TEXT := upper(trim(COALESCE(_exchange_code, '')));
BEGIN
  IF symbol_clean = '' THEN
    RETURN NULL;
  END IF;

  IF exchange_clean = 'TSX' THEN
    RETURN symbol_clean || '.TO';
  ELSIF exchange_clean = 'TSXV' THEN
    RETURN symbol_clean || '.V';
  END IF;

  RETURN symbol_clean;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_asset_provider_symbol()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  exchange_value TEXT;
  provider_symbol TEXT;
BEGIN
  exchange_value := upper(COALESCE(NULLIF(NEW.exchange_code, ''), NULLIF(NEW.exchange, ''), NULLIF(NEW.metadata_json->>'exchange_code', '')));
  NEW.exchange_code := exchange_value;

  provider_symbol := public.build_provider_symbol(NEW.symbol, exchange_value);

  NEW.metadata_json := COALESCE(NEW.metadata_json, '{}'::jsonb)
    || jsonb_build_object('exchange_code', exchange_value, 'provider_symbol', provider_symbol);

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_holdings_from_transactions(_portfolio_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  position RECORD;
  tx RECORD;
  running_qty NUMERIC;
  cost_basis NUMERIC;
  running_avg NUMERIC;
  tx_qty NUMERIC;
  tx_price NUMERIC;
  tx_fees NUMERIC;
BEGIN
  IF NOT public.owns_portfolio(_portfolio_id) THEN
    RAISE EXCEPTION 'Not allowed to rebuild holdings for this portfolio';
  END IF;

  CREATE TEMP TABLE tmp_holdings_calc (
    asset_id UUID PRIMARY KEY,
    quantity NUMERIC NOT NULL,
    avg_cost NUMERIC NOT NULL
  ) ON COMMIT DROP;

  FOR position IN
    SELECT DISTINCT asset_id
    FROM public.transactions
    WHERE portfolio_id = _portfolio_id
      AND asset_id IS NOT NULL
  LOOP
    running_qty := 0;
    cost_basis := 0;
    running_avg := 0;

    FOR tx IN
      SELECT *
      FROM public.transactions
      WHERE portfolio_id = _portfolio_id
        AND asset_id = position.asset_id
      ORDER BY COALESCE(traded_at, trade_date, created_at::date), created_at, id
    LOOP
      tx_qty := GREATEST(COALESCE(tx.quantity, 0), 0);
      tx_price := COALESCE(tx.price, 0);
      tx_fees := COALESCE(tx.fees, 0);

      IF tx.trade_type = 'buy' THEN
        running_qty := running_qty + tx_qty;
        cost_basis := cost_basis + (tx_qty * tx_price + tx_fees);
      ELSIF tx.trade_type = 'sell' THEN
        IF running_qty > 0 THEN
          running_avg := cost_basis / running_qty;
          running_qty := GREATEST(running_qty - tx_qty, 0);
          cost_basis := GREATEST(cost_basis - (tx_qty * running_avg), 0);
        END IF;
      END IF;

      IF running_qty > 0 THEN
        running_avg := cost_basis / running_qty;
      ELSE
        running_avg := 0;
      END IF;
    END LOOP;

    IF running_qty > 0 THEN
      INSERT INTO tmp_holdings_calc(asset_id, quantity, avg_cost)
      VALUES (position.asset_id, running_qty, running_avg)
      ON CONFLICT (asset_id) DO UPDATE SET quantity = EXCLUDED.quantity, avg_cost = EXCLUDED.avg_cost;
    END IF;
  END LOOP;

  DELETE FROM public.holdings h
  WHERE h.portfolio_id = _portfolio_id
    AND NOT EXISTS (SELECT 1 FROM tmp_holdings_calc c WHERE c.asset_id = h.asset_id);

  INSERT INTO public.holdings (portfolio_id, asset_id, quantity, avg_cost, cost_currency)
  SELECT _portfolio_id, c.asset_id, c.quantity, c.avg_cost, 'SEK'
  FROM tmp_holdings_calc c
  ON CONFLICT (portfolio_id, asset_id)
  DO UPDATE SET
    quantity = EXCLUDED.quantity,
    avg_cost = EXCLUDED.avg_cost,
    cost_currency = EXCLUDED.cost_currency,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_holdings_from_transactions(UUID) TO authenticated;
-- ===== END 20260308143000_nordea_transactions_and_holdings_recompute.sql =====
-- ===== BEGIN 20260309120000_idiot_proof_import_engine.sql =====
-- Idiot-proof import engine: profiles, robust transactions schema, recompute rpc updates.

CREATE TABLE IF NOT EXISTS public.broker_import_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker_key TEXT NOT NULL DEFAULT 'unknown',
  file_fingerprint TEXT NOT NULL,
  mapping JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id, file_fingerprint)
);

ALTER TABLE public.broker_import_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner can manage own broker import profiles" ON public.broker_import_profiles;
CREATE POLICY "Owner can manage own broker import profiles"
  ON public.broker_import_profiles
  FOR ALL TO authenticated
  USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);

CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker TEXT,
  trade_id TEXT,
  trade_type TEXT,
  symbol_raw TEXT,
  isin TEXT,
  exchange_raw TEXT,
  traded_at DATE,
  quantity NUMERIC,
  price NUMERIC,
  currency TEXT,
  fx_rate NUMERIC,
  fees NUMERIC,
  raw_row JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS broker TEXT,
  ADD COLUMN IF NOT EXISTS trade_id TEXT,
  ADD COLUMN IF NOT EXISTS trade_type TEXT,
  ADD COLUMN IF NOT EXISTS symbol_raw TEXT,
  ADD COLUMN IF NOT EXISTS isin TEXT,
  ADD COLUMN IF NOT EXISTS exchange_raw TEXT,
  ADD COLUMN IF NOT EXISTS traded_at DATE,
  ADD COLUMN IF NOT EXISTS quantity NUMERIC,
  ADD COLUMN IF NOT EXISTS price NUMERIC,
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS fx_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS fees NUMERIC,
  ADD COLUMN IF NOT EXISTS raw_row JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_portfolio_broker_trade_id_v2
  ON public.transactions (portfolio_id, broker, trade_id)
  WHERE trade_id IS NOT NULL;

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS exchange_code TEXT;

CREATE OR REPLACE FUNCTION public.recompute_holdings_from_transactions(_portfolio_id UUID, _method TEXT DEFAULT 'avg_cost')
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  position RECORD;
  tx RECORD;
  running_qty NUMERIC;
  cost_basis NUMERIC;
  running_avg NUMERIC;
  tx_qty NUMERIC;
  tx_price NUMERIC;
  tx_fees NUMERIC;
BEGIN
  IF NOT public.owns_portfolio(_portfolio_id) THEN
    RAISE EXCEPTION 'Not allowed to rebuild holdings for this portfolio';
  END IF;

  CREATE TEMP TABLE tmp_holdings_calc (
    asset_id UUID PRIMARY KEY,
    quantity NUMERIC NOT NULL,
    avg_cost NUMERIC NOT NULL
  ) ON COMMIT DROP;

  FOR position IN
    SELECT DISTINCT asset_id
    FROM public.transactions
    WHERE portfolio_id = _portfolio_id
      AND asset_id IS NOT NULL
  LOOP
    running_qty := 0;
    cost_basis := 0;
    running_avg := 0;

    FOR tx IN
      SELECT *
      FROM public.transactions
      WHERE portfolio_id = _portfolio_id AND asset_id = position.asset_id
      ORDER BY COALESCE(traded_at, trade_date, created_at::date), created_at, id
    LOOP
      tx_qty := GREATEST(COALESCE(tx.quantity, 0), 0);
      tx_price := COALESCE(tx.price, 0);
      tx_fees := COALESCE(tx.fees, 0);

      IF COALESCE(tx.trade_type, tx.type) = 'buy' THEN
        running_qty := running_qty + tx_qty;
        cost_basis := cost_basis + (tx_qty * tx_price + tx_fees);
      ELSIF COALESCE(tx.trade_type, tx.type) = 'sell' THEN
        IF running_qty > 0 THEN
          running_avg := cost_basis / running_qty;
          running_qty := GREATEST(running_qty - tx_qty, 0);
          cost_basis := GREATEST(cost_basis - (tx_qty * running_avg), 0);
        END IF;
      END IF;

      IF running_qty > 0 THEN
        running_avg := cost_basis / running_qty;
      ELSE
        running_avg := 0;
      END IF;
    END LOOP;

    IF running_qty > 0 THEN
      INSERT INTO tmp_holdings_calc(asset_id, quantity, avg_cost)
      VALUES (position.asset_id, running_qty, running_avg)
      ON CONFLICT (asset_id) DO UPDATE SET quantity = EXCLUDED.quantity, avg_cost = EXCLUDED.avg_cost;
    END IF;
  END LOOP;

  DELETE FROM public.holdings h
  WHERE h.portfolio_id = _portfolio_id
    AND NOT EXISTS (SELECT 1 FROM tmp_holdings_calc c WHERE c.asset_id = h.asset_id);

  INSERT INTO public.holdings (portfolio_id, asset_id, quantity, avg_cost, cost_currency)
  SELECT _portfolio_id, c.asset_id, c.quantity, c.avg_cost, 'SEK'
  FROM tmp_holdings_calc c
  ON CONFLICT (portfolio_id, asset_id)
  DO UPDATE SET quantity = EXCLUDED.quantity, avg_cost = EXCLUDED.avg_cost, cost_currency = EXCLUDED.cost_currency, updated_at = now();

  BEGIN
    PERFORM public.log_audit_action('recompute_holdings_from_transactions', jsonb_build_object('portfolio_id', _portfolio_id, 'method', _method), _portfolio_id, 'portfolio');
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_holdings_from_transactions(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_holdings_from_transactions(UUID) TO authenticated;
-- ===== END 20260309120000_idiot_proof_import_engine.sql =====
-- ===== BEGIN 20260310100000_fix_permissions.sql =====
-- Complete Supabase RLS + grants audit for all frontend-accessed tables.
-- Scope: every table queried directly by the frontend via Supabase `.from(...)`.

-- Bootstrap missing import profile table for environments that skipped prior import migrations.
CREATE TABLE IF NOT EXISTS public.broker_import_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker_key TEXT NOT NULL DEFAULT 'unknown',
  file_fingerprint TEXT NOT NULL,
  mapping JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id, file_fingerprint)
);

-- 1) Ensure RLS is enabled on all frontend-accessed tables.
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.portfolio_valuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.company_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.company_ai_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.asset_research ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.broker_import_profiles ENABLE ROW LEVEL SECURITY;

-- 2) Drop existing policies on target tables so behavior is deterministic.
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'profiles',
        'portfolios',
        'assets',
        'prices',
        'holdings',
        'transactions',
        'portfolio_valuations',
        'groups',
        'group_members',
        'group_messages',
        'companies',
        'company_metrics',
        'company_ai_reports',
        'asset_research',
        'broker_import_profiles'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END
$$;

-- 3) Profiles.
CREATE POLICY "profiles_public_read"
ON public.profiles
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "profiles_owner_insert"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "profiles_owner_update"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 4) Portfolios (reuse ownership/visibility model).
CREATE POLICY "portfolios_read_via_visibility"
ON public.portfolios
FOR SELECT
TO anon, authenticated
USING (
  owner_user_id = auth.uid()
  OR visibility = 'public'
  OR (visibility = 'authenticated' AND auth.uid() IS NOT NULL)
  OR (visibility = 'group' AND group_id IS NOT NULL AND public.is_group_member(auth.uid(), group_id))
);

CREATE POLICY "portfolios_owner_insert"
ON public.portfolios
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "portfolios_owner_update"
ON public.portfolios
FOR UPDATE
TO authenticated
USING (auth.uid() = owner_user_id)
WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "portfolios_owner_delete"
ON public.portfolios
FOR DELETE
TO authenticated
USING (auth.uid() = owner_user_id);

-- 5) Holdings + transactions + valuations via portfolio access.
CREATE POLICY "holdings_read_via_portfolio_visibility"
ON public.holdings
FOR SELECT
TO anon, authenticated
USING (public.can_view_portfolio(portfolio_id));

CREATE POLICY "holdings_owner_insert"
ON public.holdings
FOR INSERT
TO authenticated
WITH CHECK (public.owns_portfolio(portfolio_id));

CREATE POLICY "holdings_owner_update"
ON public.holdings
FOR UPDATE
TO authenticated
USING (public.owns_portfolio(portfolio_id))
WITH CHECK (public.owns_portfolio(portfolio_id));

CREATE POLICY "holdings_owner_delete"
ON public.holdings
FOR DELETE
TO authenticated
USING (public.owns_portfolio(portfolio_id));

CREATE POLICY "transactions_read_via_portfolio_visibility"
ON public.transactions
FOR SELECT
TO anon, authenticated
USING (public.can_view_portfolio(portfolio_id));

CREATE POLICY "transactions_owner_insert"
ON public.transactions
FOR INSERT
TO authenticated
WITH CHECK (
  public.owns_portfolio(portfolio_id)
  AND auth.uid() = COALESCE(owner_user_id, user_id)
);

CREATE POLICY "transactions_owner_update"
ON public.transactions
FOR UPDATE
TO authenticated
USING (
  public.owns_portfolio(portfolio_id)
  AND auth.uid() = COALESCE(owner_user_id, user_id)
)
WITH CHECK (
  public.owns_portfolio(portfolio_id)
  AND auth.uid() = COALESCE(owner_user_id, user_id)
);

CREATE POLICY "transactions_owner_delete"
ON public.transactions
FOR DELETE
TO authenticated
USING (
  public.owns_portfolio(portfolio_id)
  AND auth.uid() = COALESCE(owner_user_id, user_id)
);

CREATE POLICY "portfolio_valuations_read_via_portfolio_visibility"
ON public.portfolio_valuations
FOR SELECT
TO anon, authenticated
USING (public.can_view_portfolio(portfolio_id));

-- 6) Group collaboration tables.
CREATE POLICY "groups_read_for_members"
ON public.groups
FOR SELECT
TO authenticated
USING (owner_user_id = auth.uid() OR public.is_group_member(auth.uid(), id));

CREATE POLICY "groups_owner_insert"
ON public.groups
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "groups_owner_update"
ON public.groups
FOR UPDATE
TO authenticated
USING (auth.uid() = owner_user_id)
WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "groups_owner_delete"
ON public.groups
FOR DELETE
TO authenticated
USING (auth.uid() = owner_user_id);

CREATE POLICY "group_members_read_for_members"
ON public.group_members
FOR SELECT
TO authenticated
USING (public.is_group_member(auth.uid(), group_id));

CREATE POLICY "group_members_owner_insert"
ON public.group_members
FOR INSERT
TO authenticated
WITH CHECK (public.is_group_owner(auth.uid(), group_id));

CREATE POLICY "group_members_owner_or_self_delete"
ON public.group_members
FOR DELETE
TO authenticated
USING (public.is_group_owner(auth.uid(), group_id) OR auth.uid() = user_id);

CREATE POLICY "group_messages_read_for_members"
ON public.group_messages
FOR SELECT
TO authenticated
USING (public.is_group_member(auth.uid(), group_id));

CREATE POLICY "group_messages_member_insert"
ON public.group_messages
FOR INSERT
TO authenticated
WITH CHECK (public.is_group_member(auth.uid(), group_id) AND auth.uid() = user_id);

CREATE POLICY "group_messages_author_or_owner_delete"
ON public.group_messages
FOR DELETE
TO authenticated
USING (auth.uid() = user_id OR public.is_group_owner(auth.uid(), group_id));

-- 7) Market/company/report data.
CREATE POLICY "assets_public_read"
ON public.assets
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "assets_authenticated_insert"
ON public.assets
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "assets_service_role_manage"
ON public.assets
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "prices_public_read"
ON public.prices
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "prices_service_role_insert"
ON public.prices
FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "prices_service_role_update"
ON public.prices
FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "companies_public_read"
ON public.companies
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "company_metrics_public_read"
ON public.company_metrics
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "company_metrics_creator_manage"
ON public.company_metrics
FOR ALL
TO authenticated
USING (auth.uid() = created_by)
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "company_ai_reports_read_via_visibility"
ON public.company_ai_reports
FOR SELECT
TO anon, authenticated
USING (
  (portfolio_id IS NOT NULL AND public.can_view_portfolio(portfolio_id))
  OR (
    portfolio_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.companies c
      WHERE c.asset_id = company_ai_reports.asset_id
    )
  )
);

-- 8) Portfolio intelligence/import tables.
CREATE POLICY "asset_research_read_via_portfolio_visibility"
ON public.asset_research
FOR SELECT
TO authenticated
USING (public.can_view_portfolio(portfolio_id));

CREATE POLICY "asset_research_owner_manage"
ON public.asset_research
FOR ALL
TO authenticated
USING (public.owns_portfolio(portfolio_id))
WITH CHECK (public.owns_portfolio(portfolio_id));

CREATE POLICY "broker_import_profiles_owner_manage"
ON public.broker_import_profiles
FOR ALL
TO authenticated
USING (auth.uid() = owner_user_id)
WITH CHECK (auth.uid() = owner_user_id);

-- 9) Explicit table grants.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;
REVOKE ALL ON TABLE public.portfolios FROM anon, authenticated;
REVOKE ALL ON TABLE public.assets FROM anon, authenticated;
REVOKE ALL ON TABLE public.prices FROM anon, authenticated;
REVOKE ALL ON TABLE public.holdings FROM anon, authenticated;
REVOKE ALL ON TABLE public.transactions FROM anon, authenticated;
REVOKE ALL ON TABLE public.portfolio_valuations FROM anon, authenticated;
REVOKE ALL ON TABLE public.groups FROM anon, authenticated;
REVOKE ALL ON TABLE public.group_members FROM anon, authenticated;
REVOKE ALL ON TABLE public.group_messages FROM anon, authenticated;
REVOKE ALL ON TABLE public.companies FROM anon, authenticated;
REVOKE ALL ON TABLE public.company_metrics FROM anon, authenticated;
REVOKE ALL ON TABLE public.company_ai_reports FROM anon, authenticated;
REVOKE ALL ON TABLE public.asset_research FROM anon, authenticated;
REVOKE ALL ON TABLE public.broker_import_profiles FROM anon, authenticated;

GRANT SELECT ON public.profiles TO anon;
GRANT SELECT ON public.portfolios TO anon;
GRANT SELECT ON public.assets TO anon;
GRANT SELECT ON public.prices TO anon;
GRANT SELECT ON public.holdings TO anon;
GRANT SELECT ON public.transactions TO anon;
GRANT SELECT ON public.portfolio_valuations TO anon;
GRANT SELECT ON public.companies TO anon;
GRANT SELECT ON public.company_metrics TO anon;
GRANT SELECT ON public.company_ai_reports TO anon;

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portfolios TO authenticated;
GRANT SELECT, INSERT ON public.assets TO authenticated;
GRANT SELECT ON public.prices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.holdings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;
GRANT SELECT ON public.portfolio_valuations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.groups TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.group_members TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.group_messages TO authenticated;
GRANT SELECT ON public.companies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_metrics TO authenticated;
GRANT SELECT ON public.company_ai_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_research TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broker_import_profiles TO authenticated;

GRANT ALL PRIVILEGES ON TABLE public.profiles TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.portfolios TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.assets TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.prices TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.holdings TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.transactions TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.portfolio_valuations TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.groups TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.group_members TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.group_messages TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.companies TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.company_metrics TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.company_ai_reports TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.asset_research TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.broker_import_profiles TO service_role;

-- 10) Verification: frontend table audit and expected access model.
-- Frontend direct-table usage: 
--  - profiles: public read; owner insert/update.
--  - portfolios: visibility-based read; owner CRUD.
--  - assets: public read; authenticated insert; service_role full manage.
--  - prices: public read; service_role write.
--  - holdings: visibility-based read; owner CRUD.
--  - transactions: visibility-based read; owner CRUD.
--  - portfolio_valuations: visibility-based read.
--  - groups: members read; owner CRUD.
--  - group_members: members read; owner insert; owner/self delete.
--  - group_messages: members read/insert; author/owner delete.
--  - companies: public read.
--  - company_metrics: public read; creator CRUD.
--  - company_ai_reports: read by portfolio visibility or global company report rule.
--  - asset_research: visibility read (authenticated); owner CRUD.
--  - broker_import_profiles: owner CRUD.
--
-- Audit grants:
-- SELECT grantee, table_name, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name IN (
--     'profiles','portfolios','assets','prices','holdings','transactions','portfolio_valuations',
--     'groups','group_members','group_messages','companies','company_metrics','company_ai_reports',
--     'asset_research','broker_import_profiles'
--   )
--   AND grantee IN ('anon','authenticated','service_role')
-- ORDER BY table_name, grantee, privilege_type;
--
-- Audit RLS enablement:
-- SELECT relname, relrowsecurity
-- FROM pg_class
-- WHERE relnamespace = 'public'::regnamespace
--   AND relname IN (
--     'profiles','portfolios','assets','prices','holdings','transactions','portfolio_valuations',
--     'groups','group_members','group_messages','companies','company_metrics','company_ai_reports',
--     'asset_research','broker_import_profiles'
--   )
-- ORDER BY relname;
--
-- Audit policies:
-- SELECT tablename, policyname, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN (
--     'profiles','portfolios','assets','prices','holdings','transactions','portfolio_valuations',
--     'groups','group_members','group_messages','companies','company_metrics','company_ai_reports',
--     'asset_research','broker_import_profiles'
--   )
-- ORDER BY tablename, policyname;
-- ===== END 20260310100000_fix_permissions.sql =====
-- ===== BEGIN 20260310113000_permissions_cleanup.sql =====
-- Cleanup and harden table/function permissions for app-facing roles.
-- This migration is idempotent and complements 20260310100000_fix_permissions.sql.

-- 1) Never rely on PUBLIC defaults for app tables.
REVOKE ALL ON TABLE public.profiles FROM PUBLIC;
REVOKE ALL ON TABLE public.portfolios FROM PUBLIC;
REVOKE ALL ON TABLE public.assets FROM PUBLIC;
REVOKE ALL ON TABLE public.prices FROM PUBLIC;
REVOKE ALL ON TABLE public.holdings FROM PUBLIC;
REVOKE ALL ON TABLE public.transactions FROM PUBLIC;
REVOKE ALL ON TABLE public.portfolio_valuations FROM PUBLIC;
REVOKE ALL ON TABLE public.groups FROM PUBLIC;
REVOKE ALL ON TABLE public.group_members FROM PUBLIC;
REVOKE ALL ON TABLE public.group_messages FROM PUBLIC;
REVOKE ALL ON TABLE public.companies FROM PUBLIC;
REVOKE ALL ON TABLE public.company_metrics FROM PUBLIC;
REVOKE ALL ON TABLE public.company_ai_reports FROM PUBLIC;
REVOKE ALL ON TABLE public.asset_research FROM PUBLIC;
REVOKE ALL ON TABLE public.broker_import_profiles FROM PUBLIC;

-- 2) Lock down function execute permissions before re-granting explicit access.
-- Public visibility helpers / reads allowed for anon + authenticated.
REVOKE EXECUTE ON FUNCTION public.can_access_portfolio(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_portfolio(UUID) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.latest_price(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.latest_price(UUID) TO anon, authenticated;

-- Authenticated-only RPCs used by the frontend.
REVOKE EXECUTE ON FUNCTION public.latest_portfolio_value(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.latest_portfolio_value(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_leaderboard(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.set_asset_resolution(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_asset_resolution(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.user_has_access_to_report(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_access_to_report(UUID, UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.request_company_ai_report(UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_company_ai_report(UUID, UUID, JSONB) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.refresh_asset_research(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_asset_research(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.recompute_holdings_from_transactions(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_holdings_from_transactions(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_holdings_from_transactions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_holdings_from_transactions(UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.log_audit_action(TEXT, TEXT, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_audit_action(TEXT, TEXT, UUID, JSONB) TO authenticated;
-- ===== END 20260310113000_permissions_cleanup.sql =====
-- ===== BEGIN 20260310130000_import_holdings_snapshot_rpc.sql =====
CREATE OR REPLACE FUNCTION public.import_holdings_snapshot(
  _portfolio_id UUID,
  _mode TEXT,
  _rows_json JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _normalized_mode TEXT := lower(coalesce(_mode, ''));
  _inserted_count INTEGER := 0;
  _updated_count INTEGER := 0;
  _skipped_count INTEGER := 0;
BEGIN
  IF NOT public.owns_portfolio(_portfolio_id) THEN
    RAISE EXCEPTION 'Not allowed to import holdings into this portfolio';
  END IF;

  IF _normalized_mode NOT IN ('merge', 'replace') THEN
    RAISE EXCEPTION 'Invalid import mode: %, expected merge|replace', _mode;
  END IF;

  IF _rows_json IS NULL OR jsonb_typeof(_rows_json) <> 'array' THEN
    RAISE EXCEPTION 'rows_json must be a JSON array';
  END IF;

  CREATE TEMP TABLE tmp_import_rows (
    row_order BIGINT NOT NULL,
    symbol TEXT,
    name TEXT,
    asset_type public.asset_type,
    exchange TEXT,
    cost_currency TEXT,
    quantity NUMERIC,
    avg_cost NUMERIC,
    metadata_json JSONB,
    is_valid BOOLEAN NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO tmp_import_rows (
    row_order,
    symbol,
    name,
    asset_type,
    exchange,
    cost_currency,
    quantity,
    avg_cost,
    metadata_json,
    is_valid
  )
  SELECT
    t.row_order,
    upper(nullif(trim(t.symbol), '')),
    nullif(trim(t.name), ''),
    CASE
      WHEN lower(coalesce(t.asset_type, '')) IN ('stock', 'etf', 'fund', 'metal', 'other')
        THEN lower(t.asset_type)::public.asset_type
      ELSE 'other'::public.asset_type
    END,
    nullif(trim(t.exchange), ''),
    upper(coalesce(nullif(trim(t.cost_currency), ''), 'USD')),
    t.quantity,
    greatest(coalesce(t.avg_cost, 0), 0),
    coalesce(t.metadata_json, '{}'::jsonb),
    (
      nullif(trim(t.symbol), '') IS NOT NULL
      AND t.quantity IS NOT NULL
      AND t.quantity > 0
      AND coalesce(t.avg_cost, 0) >= 0
    )
  FROM jsonb_to_recordset(_rows_json) WITH ORDINALITY AS t(
    symbol TEXT,
    name TEXT,
    asset_type TEXT,
    exchange TEXT,
    cost_currency TEXT,
    quantity NUMERIC,
    avg_cost NUMERIC,
    metadata_json JSONB,
    row_order BIGINT
  );

  SELECT count(*) INTO _skipped_count FROM tmp_import_rows WHERE NOT is_valid;

  CREATE TEMP TABLE tmp_import_final (
    asset_id UUID PRIMARY KEY,
    quantity NUMERIC NOT NULL,
    avg_cost NUMERIC NOT NULL,
    cost_currency TEXT NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO public.assets (symbol, name, asset_type, exchange, currency, metadata_json)
  SELECT DISTINCT
    r.symbol,
    coalesce(r.name, r.symbol),
    r.asset_type,
    r.exchange,
    r.cost_currency,
    r.metadata_json
  FROM tmp_import_rows r
  WHERE r.is_valid
  ON CONFLICT (symbol) DO NOTHING;

  IF _normalized_mode = 'merge' THEN
    INSERT INTO tmp_import_final (asset_id, quantity, avg_cost, cost_currency)
    SELECT
      a.id,
      sum(r.quantity) AS quantity,
      CASE
        WHEN sum(r.quantity) <= 0 THEN 0
        ELSE sum(r.quantity * r.avg_cost) / sum(r.quantity)
      END AS avg_cost,
      (array_agg(r.cost_currency ORDER BY r.row_order DESC))[1] AS cost_currency
    FROM tmp_import_rows r
    JOIN public.assets a ON a.symbol = r.symbol
    WHERE r.is_valid
    GROUP BY a.id;
  ELSE
    INSERT INTO tmp_import_final (asset_id, quantity, avg_cost, cost_currency)
    SELECT DISTINCT ON (a.id)
      a.id,
      r.quantity,
      r.avg_cost,
      r.cost_currency
    FROM tmp_import_rows r
    JOIN public.assets a ON a.symbol = r.symbol
    WHERE r.is_valid
    ORDER BY a.id, r.row_order DESC;

    DELETE FROM public.holdings
    WHERE portfolio_id = _portfolio_id;
  END IF;

  SELECT count(*) INTO _updated_count
  FROM tmp_import_final f
  JOIN public.holdings h
    ON h.portfolio_id = _portfolio_id
   AND h.asset_id = f.asset_id;

  SELECT greatest(count(*) - _updated_count, 0) INTO _inserted_count
  FROM tmp_import_final;

  INSERT INTO public.holdings (portfolio_id, asset_id, quantity, avg_cost, cost_currency)
  SELECT _portfolio_id, asset_id, quantity, avg_cost, cost_currency
  FROM tmp_import_final
  ON CONFLICT (portfolio_id, asset_id)
  DO UPDATE SET
    quantity = CASE
      WHEN _normalized_mode = 'merge' THEN public.holdings.quantity + EXCLUDED.quantity
      ELSE EXCLUDED.quantity
    END,
    avg_cost = CASE
      WHEN _normalized_mode = 'merge' THEN
        CASE
          WHEN (public.holdings.quantity + EXCLUDED.quantity) <= 0 THEN 0
          ELSE (
            (public.holdings.quantity * public.holdings.avg_cost)
            + (EXCLUDED.quantity * EXCLUDED.avg_cost)
          ) / (public.holdings.quantity + EXCLUDED.quantity)
        END
      ELSE EXCLUDED.avg_cost
    END,
    cost_currency = EXCLUDED.cost_currency,
    updated_at = now();

  RETURN jsonb_build_object(
    'inserted', _inserted_count,
    'updated', _updated_count,
    'skipped', _skipped_count,
    'errors', 0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_holdings_snapshot(UUID, TEXT, JSONB) TO authenticated;

-- ===== END 20260310130000_import_holdings_snapshot_rpc.sql =====
-- ===== BEGIN 20260310130000_import_jobs_pipeline.sql =====
-- Import jobs queue + worker RPCs for resumable, idempotent batch imports.

CREATE TABLE IF NOT EXISTS public.import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE CASCADE,
  idempotency_key TEXT,
  file_name TEXT,
  file_type TEXT NOT NULL DEFAULT 'csv',
  import_kind TEXT NOT NULL DEFAULT 'transactions',
  storage_bucket TEXT,
  storage_path TEXT,
  mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'canceled')),
  progress JSONB NOT NULL DEFAULT jsonb_build_object('cursor', 0, 'processed', 0, 'inserted', 0, 'skipped', 0, 'total', NULL),
  error JSONB,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  retry_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT import_jobs_owner_idempotency_unique UNIQUE (owner_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_owner_created_at ON public.import_jobs(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_jobs_status_retry_at ON public.import_jobs(status, retry_at, created_at);
CREATE INDEX IF NOT EXISTS idx_import_jobs_portfolio_created_at ON public.import_jobs(portfolio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_jobs_storage_path ON public.import_jobs(storage_bucket, storage_path) WHERE storage_bucket IS NOT NULL AND storage_path IS NOT NULL;

ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "import_jobs_read_own" ON public.import_jobs;
CREATE POLICY "import_jobs_read_own"
ON public.import_jobs
FOR SELECT TO authenticated
USING (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "import_jobs_insert_own" ON public.import_jobs;
CREATE POLICY "import_jobs_insert_own"
ON public.import_jobs
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = owner_user_id
  AND status IN ('queued', 'canceled')
);

DROP POLICY IF EXISTS "import_jobs_update_own" ON public.import_jobs;
CREATE POLICY "import_jobs_update_own"
ON public.import_jobs
FOR UPDATE TO authenticated
USING (auth.uid() = owner_user_id)
WITH CHECK (
  auth.uid() = owner_user_id
  AND (
    status IN ('queued', 'canceled')
    OR (status = 'failed' AND retry_at IS NOT NULL)
    OR (status = 'completed')
  )
);

DROP POLICY IF EXISTS "import_jobs_delete_own" ON public.import_jobs;
CREATE POLICY "import_jobs_delete_own"
ON public.import_jobs
FOR DELETE TO authenticated
USING (auth.uid() = owner_user_id);

DROP TRIGGER IF EXISTS import_jobs_set_updated_at ON public.import_jobs;
CREATE TRIGGER import_jobs_set_updated_at
  BEFORE UPDATE ON public.import_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

CREATE OR REPLACE FUNCTION public.claim_import_jobs(_limit INTEGER DEFAULT 1, _worker TEXT DEFAULT 'import-worker')
RETURNS SETOF public.import_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT j.id
    FROM public.import_jobs j
    WHERE (
      j.status = 'queued'
      OR (j.status = 'failed' AND j.attempt_count < j.max_attempts AND COALESCE(j.retry_at, now()) <= now())
      OR (j.status = 'running' AND j.locked_at < now() - interval '10 minutes')
    )
    ORDER BY j.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(COALESCE(_limit, 1), 1)
  )
  UPDATE public.import_jobs j
    SET status = 'running',
        started_at = COALESCE(j.started_at, now()),
        locked_at = now(),
        locked_by = COALESCE(_worker, 'import-worker'),
        last_heartbeat_at = now(),
        attempt_count = CASE WHEN j.status IN ('queued', 'failed') THEN j.attempt_count + 1 ELSE j.attempt_count END,
        error = NULL
  WHERE j.id IN (SELECT id FROM picked)
  RETURNING j.*;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_import_jobs(INTEGER, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.import_apply_transaction_batch(_job_id UUID, _rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.import_jobs%ROWTYPE;
  v_row JSONB;
  v_inserted INTEGER := 0;
  v_skipped INTEGER := 0;
  v_inserted_id UUID;
BEGIN
  SELECT * INTO v_job FROM public.import_jobs WHERE id = _job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import job not found: %', _job_id;
  END IF;

  IF v_job.status = 'canceled' THEN
    RETURN jsonb_build_object('inserted', 0, 'skipped', COALESCE(jsonb_array_length(_rows), 0), 'canceled', true);
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(_rows, '[]'::jsonb))
  LOOP
    INSERT INTO public.transactions (
      portfolio_id,
      owner_user_id,
      broker,
      trade_id,
      trade_type,
      symbol_raw,
      isin,
      exchange_raw,
      traded_at,
      quantity,
      price,
      currency,
      fx_rate,
      fees,
      raw_row
    ) VALUES (
      v_job.portfolio_id,
      v_job.owner_user_id,
      NULLIF(v_row->>'broker', ''),
      NULLIF(v_row->>'trade_id', ''),
      COALESCE(NULLIF(v_row->>'trade_type', ''), 'unknown'),
      NULLIF(v_row->>'symbol_raw', ''),
      NULLIF(v_row->>'isin', ''),
      NULLIF(v_row->>'exchange_raw', ''),
      NULLIF(v_row->>'traded_at', '')::date,
      COALESCE((v_row->>'quantity')::numeric, 0),
      NULLIF(v_row->>'price', '')::numeric,
      NULLIF(v_row->>'currency', ''),
      NULLIF(v_row->>'fx_rate', '')::numeric,
      NULLIF(v_row->>'fees', '')::numeric,
      COALESCE(v_row->'raw_row', '{}'::jsonb)
    )
    ON CONFLICT (portfolio_id, broker, trade_id) WHERE trade_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_inserted_id;

    IF v_inserted_id IS NULL THEN
      v_skipped := v_skipped + 1;
    ELSE
      v_inserted := v_inserted + 1;
      v_inserted_id := NULL;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'canceled', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_apply_transaction_batch(UUID, JSONB) TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_jobs TO authenticated;
GRANT ALL PRIVILEGES ON public.import_jobs TO service_role;
-- ===== END 20260310130000_import_jobs_pipeline.sql =====
-- ===== BEGIN 20260310133000_transactions_stable_hash_fallback_dedupe.sql =====
-- Add stable hash fallback dedupe key for transaction imports.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS stable_hash TEXT;

WITH computed AS (
  SELECT
    t.id,
    CONCAT(
      'tx-',
      md5(
        lower(COALESCE(t.broker, '')) || '|' ||
        lower(COALESCE(t.trade_type, '')) || '|' ||
        upper(COALESCE(t.symbol_raw, '')) || '|' ||
        upper(COALESCE(t.isin, '')) || '|' ||
        upper(COALESCE(t.exchange_raw, '')) || '|' ||
        COALESCE(t.traded_at::text, '') || '|' ||
        COALESCE(trim(to_char(t.quantity, 'FM999999999999990D99999999')), '') || '|' ||
        COALESCE(trim(to_char(t.price, 'FM999999999999990D99999999')), '') || '|' ||
        upper(COALESCE(t.currency, '')) || '|' ||
        COALESCE(trim(to_char(t.fees, 'FM999999999999990D99999999')), '')
      )
    ) AS next_stable_hash
  FROM public.transactions t
  WHERE t.stable_hash IS NULL
), deduped AS (
  SELECT
    c.id,
    c.next_stable_hash,
    row_number() OVER (
      PARTITION BY t.portfolio_id, COALESCE(t.broker, ''), c.next_stable_hash
      ORDER BY t.created_at, t.id
    ) AS rn
  FROM computed c
  JOIN public.transactions t ON t.id = c.id
)
UPDATE public.transactions t
SET stable_hash = CASE WHEN d.rn = 1 THEN d.next_stable_hash ELSE NULL END
FROM deduped d
WHERE t.id = d.id
  AND t.stable_hash IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_portfolio_broker_stable_hash
  ON public.transactions (portfolio_id, broker, stable_hash)
  WHERE stable_hash IS NOT NULL;
-- ===== END 20260310133000_transactions_stable_hash_fallback_dedupe.sql =====
-- ===== BEGIN 20260310143000_align_stable_hash_algorithm.sql =====
-- Align database backfill stable_hash algorithm with app-side deterministic hash logic.

CREATE OR REPLACE FUNCTION public.compute_transaction_stable_hash(
  _broker TEXT,
  _trade_type TEXT,
  _symbol_raw TEXT,
  _isin TEXT,
  _exchange_raw TEXT,
  _traded_at DATE,
  _quantity NUMERIC,
  _price NUMERIC,
  _currency TEXT,
  _fees NUMERIC
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  exchange_code TEXT;
  stable_input TEXT;
  i INT;
  hash BIGINT := 0;
  ch_code INT;
BEGIN
  exchange_code := CASE
    WHEN upper(COALESCE(_exchange_raw, '')) IN ('TSX', 'TORONTO STOCK EXCHANGE') THEN 'TSX'
    WHEN upper(COALESCE(_exchange_raw, '')) IN ('TSXV', 'TORONTO VENTURE EXCHANGE') THEN 'TSXV'
    WHEN COALESCE(_exchange_raw, '') = '' THEN ''
    ELSE upper(_exchange_raw)
  END;

  stable_input :=
    lower(COALESCE(_broker, '')) || '|' ||
    lower(COALESCE(_trade_type, '')) || '|' ||
    upper(COALESCE(_symbol_raw, '')) || '|' ||
    upper(COALESCE(_isin, '')) || '|' ||
    exchange_code || '|' ||
    COALESCE(_traded_at::text, '') || '|' ||
    CASE WHEN _quantity IS NULL THEN '' ELSE to_char(round(_quantity, 8), 'FM999999999999990D00000000') END || '|' ||
    CASE WHEN _price IS NULL THEN '' ELSE to_char(round(_price, 8), 'FM999999999999990D00000000') END || '|' ||
    upper(COALESCE(_currency, '')) || '|' ||
    CASE WHEN _fees IS NULL THEN '' ELSE to_char(round(_fees, 8), 'FM999999999999990D00000000') END;

  FOR i IN 1..char_length(stable_input) LOOP
    ch_code := ascii(substr(stable_input, i, 1));
    hash := mod((hash * 31 + ch_code), 4294967296);
  END LOOP;

  RETURN 'tx-' || to_hex(hash::bigint);
END;
$$;

WITH computed AS (
  SELECT
    t.id,
    public.compute_transaction_stable_hash(
      t.broker,
      t.trade_type,
      t.symbol_raw,
      t.isin,
      t.exchange_raw,
      t.traded_at,
      t.quantity,
      t.price,
      t.currency,
      t.fees
    ) AS next_stable_hash,
    t.portfolio_id,
    t.broker AS tx_broker,
    t.created_at
  FROM public.transactions t
), deduped AS (
  SELECT
    c.id,
    c.next_stable_hash,
    row_number() OVER (
      PARTITION BY c.portfolio_id, COALESCE(c.tx_broker, ''), c.next_stable_hash
      ORDER BY c.created_at, c.id
    ) AS rn
  FROM computed c
)
UPDATE public.transactions t
SET stable_hash = CASE WHEN d.rn = 1 THEN d.next_stable_hash ELSE NULL END
FROM deduped d
WHERE t.id = d.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_portfolio_broker_stable_hash
  ON public.transactions (portfolio_id, broker, stable_hash)
  WHERE stable_hash IS NOT NULL;
-- ===== END 20260310143000_align_stable_hash_algorithm.sql =====
-- ===== BEGIN 20260311100000_import_transactions_batch_rpc.sql =====
-- High-performance transaction import RPC using set-based SQL and jsonb_to_recordset.

CREATE OR REPLACE FUNCTION public.import_transactions_batch(_portfolio_id UUID, _rows_json JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID := auth.uid();
  v_total_rows INTEGER := 0;
  v_deduped_rows INTEGER := 0;
  v_trade_inserted INTEGER := 0;
  v_trade_updated INTEGER := 0;
  v_stable_inserted INTEGER := 0;
  v_stable_updated INTEGER := 0;
  v_assets_upserted INTEGER := 0;
BEGIN
  IF _portfolio_id IS NULL THEN
    RAISE EXCEPTION 'portfolio_id is required';
  END IF;

  IF NOT public.owns_portfolio(_portfolio_id) THEN
    RAISE EXCEPTION 'Not allowed to import into this portfolio';
  END IF;

  CREATE TEMP TABLE tmp_import_rows (
    ord INTEGER,
    broker TEXT,
    trade_id TEXT,
    stable_hash TEXT,
    trade_type TEXT,
    symbol_raw TEXT,
    isin TEXT,
    exchange_raw TEXT,
    exchange_code TEXT,
    price_symbol TEXT,
    traded_at DATE,
    quantity NUMERIC,
    price NUMERIC,
    currency TEXT,
    fx_rate NUMERIC,
    fees NUMERIC,
    raw_row JSONB
  ) ON COMMIT DROP;

  INSERT INTO tmp_import_rows (
    ord,
    broker,
    trade_id,
    stable_hash,
    trade_type,
    symbol_raw,
    isin,
    exchange_raw,
    exchange_code,
    price_symbol,
    traded_at,
    quantity,
    price,
    currency,
    fx_rate,
    fees,
    raw_row
  )
  SELECT
    row_number() OVER (),
    NULLIF(trim(r.broker), ''),
    NULLIF(trim(r.trade_id), ''),
    NULLIF(trim(r.stable_hash), ''),
    COALESCE(NULLIF(trim(r.trade_type), ''), 'unknown'),
    NULLIF(upper(trim(r.symbol_raw)), ''),
    NULLIF(upper(trim(r.isin)), ''),
    NULLIF(trim(r.exchange_raw), ''),
    NULLIF(upper(trim(r.exchange_code)), ''),
    NULLIF(trim(r.price_symbol), ''),
    r.traded_at,
    COALESCE(r.quantity, 0),
    r.price,
    NULLIF(upper(trim(r.currency)), ''),
    r.fx_rate,
    r.fees,
    COALESCE(r.raw_row, '{}'::jsonb)
  FROM jsonb_to_recordset(COALESCE(_rows_json, '[]'::jsonb)) AS r(
    broker TEXT,
    trade_id TEXT,
    stable_hash TEXT,
    trade_type TEXT,
    symbol_raw TEXT,
    isin TEXT,
    exchange_raw TEXT,
    exchange_code TEXT,
    price_symbol TEXT,
    traded_at DATE,
    quantity NUMERIC,
    price NUMERIC,
    currency TEXT,
    fx_rate NUMERIC,
    fees NUMERIC,
    raw_row JSONB
  )
  WHERE COALESCE(r.trade_id, r.stable_hash) IS NOT NULL;

  SELECT count(*) INTO v_total_rows FROM tmp_import_rows;

  DELETE FROM tmp_import_rows t
  USING (
    SELECT ord
    FROM (
      SELECT
        ord,
        row_number() OVER (
          PARTITION BY COALESCE(broker, ''),
            CASE WHEN trade_id IS NOT NULL THEN 'trade:' || trade_id ELSE 'stable:' || COALESCE(stable_hash, '') END
          ORDER BY ord
        ) AS rn
      FROM tmp_import_rows
    ) ranked
    WHERE ranked.rn > 1
  ) d
  WHERE t.ord = d.ord;

  SELECT count(*) INTO v_deduped_rows FROM tmp_import_rows;

  WITH distinct_assets AS (
    SELECT DISTINCT symbol_raw, exchange_code, price_symbol
    FROM tmp_import_rows
    WHERE symbol_raw IS NOT NULL
  ), upserted AS (
    INSERT INTO public.assets (symbol, name, asset_type, exchange, currency, metadata_json)
    SELECT
      a.symbol_raw,
      a.symbol_raw,
      'stock'::public.asset_type,
      a.exchange_code,
      'USD',
      jsonb_strip_nulls(jsonb_build_object('exchange_code', a.exchange_code, 'price_symbol', a.price_symbol))
    FROM distinct_assets a
    ON CONFLICT (symbol)
    DO UPDATE SET
      exchange = COALESCE(EXCLUDED.exchange, public.assets.exchange),
      metadata_json = COALESCE(public.assets.metadata_json, '{}'::jsonb) || COALESCE(EXCLUDED.metadata_json, '{}'::jsonb)
    RETURNING id
  )
  SELECT count(*) INTO v_assets_upserted FROM upserted;

  CREATE TEMP TABLE tmp_asset_lookup AS
  SELECT
    t.ord,
    a.id AS asset_id
  FROM tmp_import_rows t
  LEFT JOIN LATERAL (
    SELECT a1.id
    FROM public.assets a1
    WHERE upper(a1.symbol) = COALESCE(t.symbol_raw, '')
      AND (
        COALESCE(upper(a1.exchange), '') = COALESCE(t.exchange_code, '')
        OR t.exchange_code IS NULL
      )
    ORDER BY CASE WHEN COALESCE(upper(a1.exchange), '') = COALESCE(t.exchange_code, '') THEN 0 ELSE 1 END, a1.id
    LIMIT 1
  ) a ON TRUE;

  WITH upsert_trade AS (
    INSERT INTO public.transactions (
      portfolio_id,
      owner_user_id,
      broker,
      trade_id,
      stable_hash,
      trade_type,
      symbol_raw,
      isin,
      exchange_raw,
      traded_at,
      quantity,
      price,
      currency,
      fx_rate,
      fees,
      raw_row,
      asset_id,
      metadata_json
    )
    SELECT
      _portfolio_id,
      v_owner,
      t.broker,
      t.trade_id,
      t.stable_hash,
      t.trade_type,
      t.symbol_raw,
      t.isin,
      t.exchange_raw,
      t.traded_at,
      t.quantity,
      t.price,
      t.currency,
      t.fx_rate,
      t.fees,
      t.raw_row,
      l.asset_id,
      jsonb_strip_nulls(jsonb_build_object('exchange_code', t.exchange_code, 'price_symbol', t.price_symbol))
    FROM tmp_import_rows t
    LEFT JOIN tmp_asset_lookup l ON l.ord = t.ord
    WHERE t.trade_id IS NOT NULL
    ON CONFLICT (portfolio_id, broker, trade_id)
    DO UPDATE SET
      stable_hash = EXCLUDED.stable_hash,
      trade_type = EXCLUDED.trade_type,
      symbol_raw = EXCLUDED.symbol_raw,
      isin = EXCLUDED.isin,
      exchange_raw = EXCLUDED.exchange_raw,
      traded_at = EXCLUDED.traded_at,
      quantity = EXCLUDED.quantity,
      price = EXCLUDED.price,
      currency = EXCLUDED.currency,
      fx_rate = EXCLUDED.fx_rate,
      fees = EXCLUDED.fees,
      raw_row = EXCLUDED.raw_row,
      asset_id = EXCLUDED.asset_id,
      metadata_json = EXCLUDED.metadata_json,
      owner_user_id = EXCLUDED.owner_user_id
    RETURNING xmax = 0 AS inserted
  )
  SELECT
    count(*) FILTER (WHERE inserted),
    count(*) FILTER (WHERE NOT inserted)
  INTO v_trade_inserted, v_trade_updated
  FROM upsert_trade;

  WITH upsert_stable AS (
    INSERT INTO public.transactions (
      portfolio_id,
      owner_user_id,
      broker,
      trade_id,
      stable_hash,
      trade_type,
      symbol_raw,
      isin,
      exchange_raw,
      traded_at,
      quantity,
      price,
      currency,
      fx_rate,
      fees,
      raw_row,
      asset_id,
      metadata_json
    )
    SELECT
      _portfolio_id,
      v_owner,
      t.broker,
      NULL,
      t.stable_hash,
      t.trade_type,
      t.symbol_raw,
      t.isin,
      t.exchange_raw,
      t.traded_at,
      t.quantity,
      t.price,
      t.currency,
      t.fx_rate,
      t.fees,
      t.raw_row,
      l.asset_id,
      jsonb_strip_nulls(jsonb_build_object('exchange_code', t.exchange_code, 'price_symbol', t.price_symbol))
    FROM tmp_import_rows t
    LEFT JOIN tmp_asset_lookup l ON l.ord = t.ord
    WHERE t.trade_id IS NULL
      AND t.stable_hash IS NOT NULL
    ON CONFLICT (portfolio_id, broker, stable_hash)
    DO UPDATE SET
      trade_type = EXCLUDED.trade_type,
      symbol_raw = EXCLUDED.symbol_raw,
      isin = EXCLUDED.isin,
      exchange_raw = EXCLUDED.exchange_raw,
      traded_at = EXCLUDED.traded_at,
      quantity = EXCLUDED.quantity,
      price = EXCLUDED.price,
      currency = EXCLUDED.currency,
      fx_rate = EXCLUDED.fx_rate,
      fees = EXCLUDED.fees,
      raw_row = EXCLUDED.raw_row,
      asset_id = EXCLUDED.asset_id,
      metadata_json = EXCLUDED.metadata_json,
      owner_user_id = EXCLUDED.owner_user_id
    RETURNING xmax = 0 AS inserted
  )
  SELECT
    count(*) FILTER (WHERE inserted),
    count(*) FILTER (WHERE NOT inserted)
  INTO v_stable_inserted, v_stable_updated
  FROM upsert_stable;

  PERFORM public.rebuild_holdings(_portfolio_id);

  RETURN jsonb_build_object(
    'received', v_total_rows,
    'deduped', v_deduped_rows,
    'assets_upserted', v_assets_upserted,
    'trade_id', jsonb_build_object('inserted', v_trade_inserted, 'updated', v_trade_updated),
    'stable_hash', jsonb_build_object('inserted', v_stable_inserted, 'updated', v_stable_updated),
    'processed', v_trade_inserted + v_trade_updated + v_stable_inserted + v_stable_updated,
    'skipped', GREATEST(v_total_rows - v_deduped_rows, 0),
    'holdings_rebuilt', true
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.import_transactions_batch(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_transactions_batch(UUID, JSONB) TO authenticated;
-- ===== END 20260311100000_import_transactions_batch_rpc.sql =====
-- ===== BEGIN 20260312120000_price_worker_valuation_cache_leaderboard.sql =====
-- Price updater + valuation cache + leaderboard pipeline.

ALTER TABLE public.prices
  ADD COLUMN IF NOT EXISTS price_date DATE NOT NULL DEFAULT CURRENT_DATE;

UPDATE public.prices
SET price_date = as_of_date
WHERE price_date IS DISTINCT FROM as_of_date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_prices_asset_price_date
  ON public.prices (asset_id, price_date);

ALTER TABLE public.portfolio_valuations
  ADD COLUMN IF NOT EXISTS valuation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_return NUMERIC NOT NULL DEFAULT 0;

UPDATE public.portfolio_valuations
SET valuation_date = as_of_date
WHERE valuation_date IS DISTINCT FROM as_of_date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_valuations_portfolio_date
  ON public.portfolio_valuations (portfolio_id, valuation_date);

CREATE OR REPLACE FUNCTION public.refresh_portfolio_valuations()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_prices AS (
    SELECT DISTINCT ON (p.asset_id)
      p.asset_id,
      p.price
    FROM public.prices p
    ORDER BY p.asset_id, p.price_date DESC, p.created_at DESC
  ),
  per_holding AS (
    SELECT
      h.portfolio_id,
      h.asset_id,
      h.quantity,
      h.avg_cost,
      lp.price,
      (h.quantity * lp.price) AS position_value,
      (h.quantity * h.avg_cost) AS position_cost
    FROM public.holdings h
    JOIN latest_prices lp
      ON lp.asset_id = h.asset_id
    WHERE h.quantity <> 0
  ),
  per_portfolio AS (
    SELECT
      portfolio_id,
      SUM(position_value) AS total_value,
      SUM(position_cost) AS total_cost,
      SUM(position_value - position_cost) AS total_return
    FROM per_holding
    GROUP BY portfolio_id
  )
  INSERT INTO public.portfolio_valuations (
    portfolio_id,
    valuation_date,
    as_of_date,
    total_value,
    total_cost,
    total_return,
    currency
  )
  SELECT
    pp.portfolio_id,
    CURRENT_DATE,
    CURRENT_DATE,
    COALESCE(pp.total_value, 0),
    COALESCE(pp.total_cost, 0),
    COALESCE(pp.total_return, 0),
    'SEK'
  FROM per_portfolio pp
  ON CONFLICT (portfolio_id, valuation_date)
  DO UPDATE SET
    total_value = EXCLUDED.total_value,
    total_cost = EXCLUDED.total_cost,
    total_return = EXCLUDED.total_return,
    as_of_date = EXCLUDED.as_of_date;
$$;

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
  SELECT *
  FROM public.portfolio_valuations
  WHERE portfolio_id = p.id
  ORDER BY valuation_date DESC
  LIMIT 1
) v ON true
ORDER BY return_pct DESC NULLS LAST;

CREATE OR REPLACE FUNCTION public.get_portfolio_leaderboard("limit" INT DEFAULT 50)
RETURNS TABLE (
  portfolio_id UUID,
  portfolio_name TEXT,
  total_value NUMERIC,
  return_pct NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    pl.portfolio_id,
    pl.name AS portfolio_name,
    pl.total_value,
    pl.return_pct
  FROM public.portfolio_leaderboard pl
  LIMIT GREATEST(COALESCE("limit", 50), 1);
$$;

GRANT EXECUTE ON FUNCTION public.refresh_portfolio_valuations() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_portfolio_leaderboard(INT) TO anon, authenticated, service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('update-prices-every-5-minutes');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'update-prices-every-5-minutes',
  '*/5 * * * *',
  $$
  SELECT
    net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/update-prices',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);
-- ===== END 20260312120000_price_worker_valuation_cache_leaderboard.sql =====
-- ===== BEGIN 20260313090000_leaderboard_permissions.sql =====
-- Leaderboard frontend permissions hardening.

GRANT SELECT ON public.portfolio_leaderboard TO authenticated;
GRANT SELECT ON public.portfolio_leaderboard TO anon;
GRANT ALL ON public.portfolio_leaderboard TO service_role;

GRANT EXECUTE ON FUNCTION public.get_portfolio_leaderboard(integer)
TO authenticated, anon;
-- ===== END 20260313090000_leaderboard_permissions.sql =====
-- ===== BEGIN 20260313091000_friend_graph.sql =====
-- Friend graph social layer + privacy integration.

CREATE TABLE IF NOT EXISTS public.friends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT friends_not_self CHECK (user_id <> friend_user_id),
  CONSTRAINT friends_unique UNIQUE (user_id, friend_user_id)
);

CREATE INDEX IF NOT EXISTS idx_friends_user_id ON public.friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend_user_id ON public.friends(friend_user_id);

CREATE TABLE IF NOT EXISTS public.friend_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  CONSTRAINT friend_requests_not_self CHECK (requester_id <> recipient_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_pending_unique
  ON public.friend_requests(requester_id, recipient_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_friend_requests_requester_id ON public.friend_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_recipient_id ON public.friend_requests(recipient_id);

ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "friends_read_own" ON public.friends;
CREATE POLICY "friends_read_own"
ON public.friends
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR auth.uid() = friend_user_id);

DROP POLICY IF EXISTS "friends_insert_own" ON public.friends;
CREATE POLICY "friends_insert_own"
ON public.friends
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "friends_delete_own" ON public.friends;
CREATE POLICY "friends_delete_own"
ON public.friends
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "friend_requests_read_own" ON public.friend_requests;
CREATE POLICY "friend_requests_read_own"
ON public.friend_requests
FOR SELECT
TO authenticated
USING (auth.uid() = requester_id OR auth.uid() = recipient_id);

DROP POLICY IF EXISTS "friend_requests_insert_requester" ON public.friend_requests;
CREATE POLICY "friend_requests_insert_requester"
ON public.friend_requests
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = requester_id AND status = 'pending');

DROP POLICY IF EXISTS "friend_requests_update_participants" ON public.friend_requests;
CREATE POLICY "friend_requests_update_participants"
ON public.friend_requests
FOR UPDATE
TO authenticated
USING (auth.uid() = requester_id OR auth.uid() = recipient_id)
WITH CHECK (auth.uid() = requester_id OR auth.uid() = recipient_id);

CREATE OR REPLACE FUNCTION public.accept_friend_request(_request_id UUID)
RETURNS public.friend_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _request public.friend_requests;
  _user_id UUID := auth.uid();
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO _request
  FROM public.friend_requests
  WHERE id = _request_id;

  IF _request.id IS NULL THEN
    RAISE EXCEPTION 'Friend request not found';
  END IF;

  IF _request.recipient_id <> _user_id THEN
    RAISE EXCEPTION 'Only recipient can accept friend request';
  END IF;

  IF _request.status <> 'pending' THEN
    RETURN _request;
  END IF;

  UPDATE public.friend_requests
  SET status = 'accepted', responded_at = now()
  WHERE id = _request_id
  RETURNING * INTO _request;

  INSERT INTO public.friends(user_id, friend_user_id)
  VALUES (_request.requester_id, _request.recipient_id)
  ON CONFLICT (user_id, friend_user_id) DO NOTHING;

  INSERT INTO public.friends(user_id, friend_user_id)
  VALUES (_request.recipient_id, _request.requester_id)
  ON CONFLICT (user_id, friend_user_id) DO NOTHING;

  RETURN _request;
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_friend_request(_request_id UUID)
RETURNS public.friend_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _request public.friend_requests;
  _user_id UUID := auth.uid();
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.friend_requests
  SET status = 'declined', responded_at = now()
  WHERE id = _request_id
    AND recipient_id = _user_id
    AND status = 'pending'
  RETURNING * INTO _request;

  IF _request.id IS NULL THEN
    RAISE EXCEPTION 'Pending friend request not found';
  END IF;

  RETURN _request;
END;
$$;

CREATE OR REPLACE FUNCTION public.are_friends(_user_id UUID, _other_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.friends f
    WHERE f.user_id = _user_id
      AND f.friend_user_id = _other_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.accept_friend_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_friend_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.are_friends(UUID, UUID) TO authenticated, anon, service_role;
-- ===== END 20260313091000_friend_graph.sql =====
-- ===== BEGIN 20260313091500_add_friends_visibility_enum.sql =====
ALTER TYPE public.portfolio_visibility ADD VALUE IF NOT EXISTS 'friends';
-- ===== END 20260313091500_add_friends_visibility_enum.sql =====
-- ===== BEGIN 20260313092000_social_features_and_ai.sql =====
CREATE OR REPLACE FUNCTION public.compare_portfolios(portfolio_ids UUID[])
RETURNS TABLE (
  portfolio_id UUID,
  name TEXT,
  owner TEXT,
  total_value NUMERIC,
  total_cost NUMERIC,
  return_pct NUMERIC,
  largest_position TEXT,
  risk_score NUMERIC
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH selected_portfolios AS (
    SELECT p.id, p.name, p.owner_user_id
    FROM public.portfolios p
    WHERE p.id = ANY(COALESCE(portfolio_ids, ARRAY[]::UUID[]))
      AND public.can_view_portfolio(p.id)
  ),
  latest_vals AS (
    SELECT DISTINCT ON (v.portfolio_id)
      v.portfolio_id,
      v.total_value,
      v.total_cost,
      v.total_return
    FROM public.portfolio_valuations v
    JOIN selected_portfolios sp ON sp.id = v.portfolio_id
    ORDER BY v.portfolio_id, v.valuation_date DESC, v.created_at DESC
  ),
  latest_prices AS (
    SELECT DISTINCT ON (pr.asset_id)
      pr.asset_id,
      pr.price
    FROM public.prices pr
    ORDER BY pr.asset_id, pr.price_date DESC, pr.created_at DESC
  ),
  position_values AS (
    SELECT
      h.portfolio_id,
      a.symbol,
      (h.quantity * lp.price) AS position_value
    FROM public.holdings h
    JOIN latest_prices lp ON lp.asset_id = h.asset_id
    JOIN public.assets a ON a.id = h.asset_id
    JOIN selected_portfolios sp ON sp.id = h.portfolio_id
    WHERE h.quantity > 0
  ),
  largest AS (
    SELECT DISTINCT ON (pv.portfolio_id)
      pv.portfolio_id,
      pv.symbol,
      pv.position_value
    FROM position_values pv
    ORDER BY pv.portfolio_id, pv.position_value DESC
  ),
  position_weights AS (
    SELECT
      pv.portfolio_id,
      pv.symbol,
      pv.position_value,
      pv.position_value / NULLIF(SUM(pv.position_value) OVER (PARTITION BY pv.portfolio_id), 0) AS weight
    FROM position_values pv
  ),
  concentration AS (
    SELECT
      pw.portfolio_id,
      MAX(pw.weight) AS max_weight
    FROM position_weights pw
    GROUP BY pw.portfolio_id
  )
  SELECT
    sp.id AS portfolio_id,
    sp.name,
    COALESCE(pr.display_name, 'Unknown') AS owner,
    COALESCE(lv.total_value, 0) AS total_value,
    COALESCE(lv.total_cost, 0) AS total_cost,
    CASE
      WHEN COALESCE(lv.total_cost, 0) > 0
      THEN (COALESCE(lv.total_return, 0) / lv.total_cost) * 100
      ELSE 0
    END AS return_pct,
    COALESCE(l.symbol, '-') AS largest_position,
    ROUND((100 - COALESCE(c.max_weight, 1) * 100)::NUMERIC, 2) AS risk_score
  FROM selected_portfolios sp
  LEFT JOIN latest_vals lv ON lv.portfolio_id = sp.id
  LEFT JOIN largest l ON l.portfolio_id = sp.id
  LEFT JOIN concentration c ON c.portfolio_id = sp.id
  LEFT JOIN public.profiles pr ON pr.user_id = sp.owner_user_id
  ORDER BY return_pct DESC;
$$;
-- ===== END 20260313092000_social_features_and_ai.sql =====
-- ===== BEGIN 20260314090000_global_price_cache_and_symbol_overrides.sql =====
-- Global price cache + symbol resolution override system.

CREATE TABLE IF NOT EXISTS public.market_instruments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_symbol TEXT NOT NULL,
  exchange_code TEXT,
  price_symbol TEXT NOT NULL UNIQUE,
  asset_type TEXT,
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  provider TEXT NOT NULL DEFAULT 'twelve_data',
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_price_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_instruments_last_price_at
  ON public.market_instruments(last_price_at);
CREATE INDEX IF NOT EXISTS idx_market_instruments_symbol_exchange
  ON public.market_instruments(canonical_symbol, exchange_code);

CREATE TABLE IF NOT EXISTS public.market_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id UUID NOT NULL REFERENCES public.market_instruments(id) ON DELETE CASCADE,
  price NUMERIC NOT NULL,
  currency TEXT NOT NULL,
  price_timestamp TIMESTAMPTZ NOT NULL,
  price_date DATE GENERATED ALWAYS AS ((price_timestamp AT TIME ZONE 'UTC')::date) STORED,
  source TEXT NOT NULL DEFAULT 'twelve_data',
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_prices_instrument_timestamp_desc
  ON public.market_prices(instrument_id, price_timestamp DESC);

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS instrument_id UUID REFERENCES public.market_instruments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_assets_instrument_id ON public.assets(instrument_id);

CREATE TABLE IF NOT EXISTS public.symbol_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_symbol TEXT NOT NULL,
  exchange TEXT,
  canonical_symbol TEXT NOT NULL,
  price_symbol TEXT NOT NULL,
  instrument_id UUID REFERENCES public.market_instruments(id) ON DELETE SET NULL,
  broker TEXT,
  isin TEXT,
  asset_name_hint TEXT,
  confidence NUMERIC,
  resolution_source TEXT NOT NULL DEFAULT 'auto',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS exchange TEXT;
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS canonical_symbol TEXT;
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS price_symbol TEXT;
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS instrument_id UUID REFERENCES public.market_instruments(id) ON DELETE SET NULL;
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS broker TEXT;
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS isin TEXT;
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS asset_name_hint TEXT;
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS confidence NUMERIC;
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS resolution_source TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.symbol_aliases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.symbol_aliases
SET
  canonical_symbol = COALESCE(NULLIF(canonical_symbol, ''), UPPER(raw_symbol)),
  resolution_source = COALESCE(NULLIF(resolution_source, ''), 'auto'),
  is_active = COALESCE(is_active, true)
WHERE canonical_symbol IS NULL
   OR resolution_source IS NULL
   OR is_active IS NULL;

ALTER TABLE public.symbol_aliases
  ALTER COLUMN canonical_symbol SET NOT NULL,
  ALTER COLUMN price_symbol SET NOT NULL,
  ALTER COLUMN resolution_source SET NOT NULL,
  ALTER COLUMN is_active SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'symbol_aliases_resolution_source_check'
      AND conrelid = 'public.symbol_aliases'::regclass
  ) THEN
    ALTER TABLE public.symbol_aliases
      ADD CONSTRAINT symbol_aliases_resolution_source_check
      CHECK (resolution_source IN ('auto', 'imported', 'manual_override', 'ai_suggestion'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_symbol_aliases_unique_resolution
  ON public.symbol_aliases (
    UPPER(raw_symbol),
    COALESCE(UPPER(exchange), ''),
    COALESCE(LOWER(broker), ''),
    COALESCE(UPPER(isin), '')
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_symbol_aliases_unique_active_override
  ON public.symbol_aliases (
    UPPER(raw_symbol),
    COALESCE(UPPER(exchange), ''),
    COALESCE(LOWER(broker), ''),
    COALESCE(UPPER(isin), ''),
    resolution_source
  )
  WHERE is_active = true;

INSERT INTO public.market_instruments (canonical_symbol, exchange_code, price_symbol, asset_type, currency)
SELECT DISTINCT
  UPPER(COALESCE(NULLIF(a.symbol, ''), split_part(a.price_symbol, ':', 1))) AS canonical_symbol,
  NULLIF(UPPER(COALESCE(NULLIF(a.exchange_code, ''), split_part(a.price_symbol, ':', 2))), '') AS exchange_code,
  UPPER(a.price_symbol) AS price_symbol,
  a.asset_type,
  UPPER(a.currency)
FROM public.assets a
WHERE a.price_symbol IS NOT NULL
  AND trim(a.price_symbol) <> ''
ON CONFLICT (price_symbol) DO UPDATE
SET
  canonical_symbol = EXCLUDED.canonical_symbol,
  exchange_code = COALESCE(public.market_instruments.exchange_code, EXCLUDED.exchange_code),
  asset_type = COALESCE(public.market_instruments.asset_type, EXCLUDED.asset_type),
  currency = COALESCE(public.market_instruments.currency, EXCLUDED.currency),
  updated_at = now();

UPDATE public.assets a
SET instrument_id = mi.id
FROM public.market_instruments mi
WHERE a.price_symbol IS NOT NULL
  AND UPPER(a.price_symbol) = mi.price_symbol
  AND a.instrument_id IS DISTINCT FROM mi.id;

UPDATE public.symbol_aliases sa
SET instrument_id = mi.id,
    updated_at = now()
FROM public.market_instruments mi
WHERE sa.instrument_id IS NULL
  AND UPPER(sa.price_symbol) = mi.price_symbol;

CREATE OR REPLACE FUNCTION public.resolve_symbol_candidates(
  _raw_symbol TEXT,
  _exchange TEXT DEFAULT NULL,
  _broker TEXT DEFAULT NULL,
  _isin TEXT DEFAULT NULL,
  _asset_name_hint TEXT DEFAULT NULL
)
RETURNS TABLE (
  alias_id UUID,
  instrument_id UUID,
  raw_symbol TEXT,
  exchange TEXT,
  canonical_symbol TEXT,
  price_symbol TEXT,
  broker TEXT,
  isin TEXT,
  confidence NUMERIC,
  resolution_source TEXT,
  rank_priority INT,
  rank_score NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH normalized AS (
    SELECT
      UPPER(TRIM(COALESCE(_raw_symbol, ''))) AS raw_symbol,
      NULLIF(UPPER(TRIM(COALESCE(_exchange, ''))), '') AS exchange,
      NULLIF(LOWER(TRIM(COALESCE(_broker, ''))), '') AS broker,
      NULLIF(UPPER(TRIM(COALESCE(_isin, ''))), '') AS isin
  ),
  ranked AS (
    SELECT
      sa.id AS alias_id,
      sa.instrument_id,
      sa.raw_symbol,
      sa.exchange,
      sa.canonical_symbol,
      sa.price_symbol,
      sa.broker,
      sa.isin,
      COALESCE(sa.confidence, 0.5) AS confidence,
      sa.resolution_source,
      CASE
        WHEN sa.resolution_source = 'manual_override' THEN 1
        WHEN sa.broker IS NOT NULL AND sa.broker = (SELECT broker FROM normalized) THEN 2
        WHEN sa.isin IS NOT NULL AND sa.isin = (SELECT isin FROM normalized) THEN 3
        WHEN UPPER(sa.raw_symbol) = (SELECT raw_symbol FROM normalized)
          AND COALESCE(UPPER(sa.exchange), '') = COALESCE((SELECT exchange FROM normalized), '') THEN 4
        WHEN UPPER(sa.canonical_symbol) = (SELECT raw_symbol FROM normalized) THEN 5
        ELSE 99
      END AS rank_priority,
      (
        CASE
          WHEN sa.resolution_source = 'manual_override' THEN 1.0
          WHEN sa.broker IS NOT NULL AND sa.broker = (SELECT broker FROM normalized) THEN 0.95
          WHEN sa.isin IS NOT NULL AND sa.isin = (SELECT isin FROM normalized) THEN 0.9
          WHEN UPPER(sa.raw_symbol) = (SELECT raw_symbol FROM normalized)
            AND COALESCE(UPPER(sa.exchange), '') = COALESCE((SELECT exchange FROM normalized), '') THEN 0.85
          WHEN UPPER(sa.canonical_symbol) = (SELECT raw_symbol FROM normalized) THEN 0.75
          ELSE 0.1
        END
      ) * COALESCE(sa.confidence, 1.0) AS rank_score
    FROM public.symbol_aliases sa
    WHERE sa.is_active = true
      AND (
        UPPER(sa.raw_symbol) = (SELECT raw_symbol FROM normalized)
        OR UPPER(sa.canonical_symbol) = (SELECT raw_symbol FROM normalized)
        OR (sa.isin IS NOT NULL AND sa.isin = (SELECT isin FROM normalized))
      )
  )
  SELECT *
  FROM ranked
  ORDER BY rank_priority ASC, rank_score DESC, confidence DESC, raw_symbol ASC
  LIMIT 10;
$$;

CREATE OR REPLACE VIEW public.asset_latest_prices AS
SELECT
  a.id AS asset_id,
  a.instrument_id,
  lp.price,
  lp.currency,
  lp.price_timestamp
FROM public.assets a
LEFT JOIN LATERAL (
  SELECT mp.price, mp.currency, mp.price_timestamp
  FROM public.market_prices mp
  WHERE mp.instrument_id = a.instrument_id
  ORDER BY mp.price_timestamp DESC
  LIMIT 1
) lp ON true;

CREATE OR REPLACE FUNCTION public.refresh_portfolio_valuations()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_prices AS (
    SELECT alp.asset_id, alp.price
    FROM public.asset_latest_prices alp
    WHERE alp.price IS NOT NULL
  ),
  per_holding AS (
    SELECT
      h.portfolio_id,
      h.asset_id,
      h.quantity,
      h.avg_cost,
      lp.price,
      (h.quantity * lp.price) AS position_value,
      (h.quantity * h.avg_cost) AS position_cost
    FROM public.holdings h
    JOIN latest_prices lp
      ON lp.asset_id = h.asset_id
    WHERE h.quantity <> 0
  ),
  per_portfolio AS (
    SELECT
      portfolio_id,
      SUM(position_value) AS total_value,
      SUM(position_cost) AS total_cost,
      SUM(position_value - position_cost) AS total_return
    FROM per_holding
    GROUP BY portfolio_id
  )
  INSERT INTO public.portfolio_valuations (
    portfolio_id,
    valuation_date,
    as_of_date,
    total_value,
    total_cost,
    total_return,
    currency
  )
  SELECT
    pp.portfolio_id,
    CURRENT_DATE,
    CURRENT_DATE,
    COALESCE(pp.total_value, 0),
    COALESCE(pp.total_cost, 0),
    COALESCE(pp.total_return, 0),
    'SEK'
  FROM per_portfolio pp
  ON CONFLICT (portfolio_id, valuation_date)
  DO UPDATE SET
    total_value = EXCLUDED.total_value,
    total_cost = EXCLUDED.total_cost,
    total_return = EXCLUDED.total_return,
    as_of_date = EXCLUDED.as_of_date;
$$;

ALTER TABLE public.market_instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.symbol_aliases ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='market_instruments' AND policyname='Authenticated users can read market instruments') THEN
    CREATE POLICY "Authenticated users can read market instruments"
      ON public.market_instruments
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='market_prices' AND policyname='Authenticated users can read market prices') THEN
    CREATE POLICY "Authenticated users can read market prices"
      ON public.market_prices
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='symbol_aliases' AND policyname='Authenticated users can read aliases') THEN
    CREATE POLICY "Authenticated users can read aliases"
      ON public.symbol_aliases
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='symbol_aliases' AND policyname='Authenticated users can manage aliases') THEN
    CREATE POLICY "Authenticated users can manage aliases"
      ON public.symbol_aliases
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE public.market_instruments FROM PUBLIC;
REVOKE ALL ON TABLE public.market_prices FROM PUBLIC;
REVOKE ALL ON TABLE public.symbol_aliases FROM PUBLIC;
REVOKE ALL ON VIEW public.asset_latest_prices FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_symbol_candidates(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

GRANT SELECT ON TABLE public.market_instruments TO authenticated;
GRANT SELECT ON TABLE public.market_prices TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.symbol_aliases TO authenticated;
GRANT SELECT ON VIEW public.asset_latest_prices TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_symbol_candidates(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT INSERT, SELECT ON TABLE public.market_prices TO service_role;
GRANT SELECT, UPDATE ON TABLE public.market_instruments TO service_role;
GRANT SELECT ON TABLE public.symbol_aliases TO service_role;

GRANT SELECT ON public.portfolio_leaderboard TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_portfolio_leaderboard(integer) TO authenticated, anon;
-- ===== END 20260314090000_global_price_cache_and_symbol_overrides.sql =====
-- ===== BEGIN 20260314110000_market_prices_import_resolution_and_scheduler.sql =====
-- Market price ingestion hardening, missing symbol detector, valuation refresh, and 12h scheduler.

ALTER TABLE public.market_instruments
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

UPDATE public.market_instruments
SET is_active = CASE WHEN status = 'active' THEN true ELSE false END
WHERE is_active IS DISTINCT FROM (status = 'active');

ALTER TABLE public.market_prices
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_prices_instrument_unique
  ON public.market_prices (instrument_id);

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

CREATE OR REPLACE FUNCTION public.refresh_portfolio_valuations()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_market_prices AS (
    SELECT DISTINCT ON (mp.instrument_id)
      mp.instrument_id,
      mp.price
    FROM public.market_prices mp
    ORDER BY mp.instrument_id, mp.updated_at DESC
  ),
  per_holding AS (
    SELECT
      h.portfolio_id,
      (h.quantity * lmp.price) AS position_value
    FROM public.holdings h
    JOIN public.assets a
      ON a.id = h.asset_id
    JOIN latest_market_prices lmp
      ON lmp.instrument_id = a.instrument_id
    WHERE h.quantity <> 0
  ),
  per_portfolio AS (
    SELECT
      portfolio_id,
      COALESCE(SUM(position_value), 0) AS value
    FROM per_holding
    GROUP BY portfolio_id
  )
  INSERT INTO public.portfolio_valuations (
    portfolio_id,
    total_value,
    currency,
    as_of_date,
    valuation_date,
    total_cost,
    total_return,
    created_at
  )
  SELECT
    p.id,
    COALESCE(pp.value, 0),
    p.base_currency,
    CURRENT_DATE,
    CURRENT_DATE,
    0,
    0,
    now()
  FROM public.portfolios p
  LEFT JOIN per_portfolio pp ON pp.portfolio_id = p.id
  ON CONFLICT (portfolio_id, valuation_date)
  DO UPDATE SET
    total_value = EXCLUDED.total_value,
    currency = EXCLUDED.currency,
    as_of_date = EXCLUDED.as_of_date;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_portfolio_valuations() TO authenticated, service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('portfolio-market-maintenance-12h');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'portfolio-market-maintenance-12h',
  '0 */12 * * *',
  $$
  SELECT
    net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/update-market-prices',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := '{}'::jsonb
    );

  SELECT public.refresh_portfolio_valuations();
  $$
);
-- ===== END 20260314110000_market_prices_import_resolution_and_scheduler.sql =====
-- ===== BEGIN 20260315100000_asset_prices_valuation_refresh.sql =====
-- Dedicated asset price layer + valuation refresh + 12h scheduler.

CREATE TABLE IF NOT EXISTS public.asset_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  price NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  price_date DATE NOT NULL,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, price_date)
);

CREATE INDEX IF NOT EXISTS idx_asset_prices_asset_date
  ON public.asset_prices(asset_id, price_date DESC);

ALTER TABLE public.asset_prices ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'asset_prices'
      AND policyname = 'Asset prices readable by all'
  ) THEN
    CREATE POLICY "Asset prices readable by all"
      ON public.asset_prices
      FOR SELECT
      USING (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_portfolio_valuations()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_asset_prices AS (
    SELECT DISTINCT ON (ap.asset_id)
      ap.asset_id,
      ap.price,
      ap.currency,
      ap.price_date
    FROM public.asset_prices ap
    ORDER BY ap.asset_id, ap.price_date DESC, ap.created_at DESC
  ),
  per_holding AS (
    SELECT
      h.portfolio_id,
      (h.quantity * lap.price) AS position_value,
      lap.currency,
      lap.price_date
    FROM public.holdings_v2 h
    JOIN public.assets a
      ON a.id = h.asset_id
    JOIN latest_asset_prices lap
      ON lap.asset_id = a.id
    WHERE h.quantity <> 0
  ),
  per_portfolio AS (
    SELECT
      portfolio_id,
      COALESCE(SUM(position_value), 0) AS total_value,
      (array_agg(currency ORDER BY price_date DESC))[1] AS currency,
      MAX(price_date) AS as_of_date
    FROM per_holding
    GROUP BY portfolio_id
  )
  INSERT INTO public.portfolio_valuations (
    portfolio_id,
    total_value,
    currency,
    valuation_date,
    as_of_date
  )
  SELECT
    p.id,
    COALESCE(pp.total_value, 0),
    COALESCE(pp.currency, p.base_currency),
    CURRENT_DATE,
    COALESCE(pp.as_of_date, CURRENT_DATE)
  FROM public.portfolios p
  LEFT JOIN per_portfolio pp ON pp.portfolio_id = p.id
  ON CONFLICT (portfolio_id, valuation_date)
  DO UPDATE SET
    total_value = EXCLUDED.total_value,
    currency = EXCLUDED.currency,
    as_of_date = EXCLUDED.as_of_date;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_portfolio_valuations() TO authenticated, service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('update-prices-every-5-minutes');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('portfolio-market-maintenance-12h');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('update-prices-every-12-hours');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'update-prices-every-12-hours',
  '0 */12 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/update-prices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
-- ===== END 20260315100000_asset_prices_valuation_refresh.sql =====
-- ===== BEGIN 20260316100000_mining_intelligence_engine.sql =====
-- Mining Intelligence Engine: metadata, classification, valuation, exposures, and insights.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'mining_stage'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.mining_stage AS ENUM (
      'explorer',
      'developer',
      'near_term_producer',
      'producer',
      'mid_tier',
      'major'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.mining_company_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  primary_metal TEXT,
  secondary_metals TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  jurisdiction TEXT,
  stage public.mining_stage NOT NULL DEFAULT 'explorer',
  market_cap NUMERIC,
  enterprise_value NUMERIC,
  annual_production_oz NUMERIC,
  resource_size_oz NUMERIC,
  all_in_sustaining_cost NUMERIC,
  mine_life_years NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id)
);

CREATE INDEX IF NOT EXISTS idx_mining_company_profiles_asset_id
  ON public.mining_company_profiles(asset_id);
CREATE INDEX IF NOT EXISTS idx_mining_company_profiles_primary_metal
  ON public.mining_company_profiles(primary_metal);
CREATE INDEX IF NOT EXISTS idx_mining_company_profiles_jurisdiction
  ON public.mining_company_profiles(jurisdiction);
CREATE INDEX IF NOT EXISTS idx_mining_company_profiles_stage
  ON public.mining_company_profiles(stage);

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
  SELECT
    mcp.annual_production_oz,
    mcp.resource_size_oz
  INTO _production, _resource
  FROM public.mining_company_profiles mcp
  WHERE mcp.asset_id = _asset_id;

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

CREATE OR REPLACE FUNCTION public.handle_mining_profile_classification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.stage := CASE
    WHEN NEW.annual_production_oz IS NOT NULL AND NEW.annual_production_oz > 500000 THEN 'major'::public.mining_stage
    WHEN NEW.annual_production_oz IS NOT NULL AND NEW.annual_production_oz >= 100000 THEN 'mid_tier'::public.mining_stage
    WHEN NEW.annual_production_oz IS NOT NULL AND NEW.annual_production_oz > 0 THEN 'producer'::public.mining_stage
    WHEN NEW.resource_size_oz IS NOT NULL AND NEW.resource_size_oz > 0 THEN 'developer'::public.mining_stage
    ELSE 'explorer'::public.mining_stage
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mining_profile_classification ON public.mining_company_profiles;
CREATE TRIGGER trg_mining_profile_classification
  BEFORE INSERT OR UPDATE OF annual_production_oz, resource_size_oz
  ON public.mining_company_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_mining_profile_classification();

CREATE TABLE IF NOT EXISTS public.mining_valuation_metrics (
  asset_id UUID PRIMARY KEY REFERENCES public.assets(id) ON DELETE CASCADE,
  ev_per_ounce NUMERIC,
  price_to_nav NUMERIC,
  cash_flow_multiple NUMERIC,
  resource_multiple NUMERIC,
  valuation_rating TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mining_valuation_metrics_rating
  ON public.mining_valuation_metrics(valuation_rating);

CREATE OR REPLACE FUNCTION public.refresh_mining_valuation_metrics(_asset_id UUID DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.mining_valuation_metrics (
    asset_id,
    ev_per_ounce,
    price_to_nav,
    cash_flow_multiple,
    resource_multiple,
    valuation_rating,
    created_at,
    updated_at
  )
  SELECT
    mcp.asset_id,
    CASE
      WHEN mcp.enterprise_value IS NOT NULL
       AND mcp.resource_size_oz IS NOT NULL
       AND mcp.resource_size_oz <> 0
      THEN mcp.enterprise_value / mcp.resource_size_oz
      ELSE NULL
    END AS ev_per_ounce,
    NULL::NUMERIC AS price_to_nav,
    NULL::NUMERIC AS cash_flow_multiple,
    CASE
      WHEN mcp.market_cap IS NOT NULL
       AND mcp.resource_size_oz IS NOT NULL
       AND mcp.resource_size_oz <> 0
      THEN mcp.market_cap / mcp.resource_size_oz
      ELSE NULL
    END AS resource_multiple,
    CASE
      WHEN mcp.enterprise_value IS NULL OR mcp.resource_size_oz IS NULL OR mcp.resource_size_oz = 0 THEN NULL
      WHEN (mcp.enterprise_value / mcp.resource_size_oz) < 50 THEN 'Deep Value'
      WHEN (mcp.enterprise_value / mcp.resource_size_oz) < 150 THEN 'Value'
      WHEN (mcp.enterprise_value / mcp.resource_size_oz) <= 400 THEN 'Fair'
      ELSE 'Expensive'
    END AS valuation_rating,
    now(),
    now()
  FROM public.mining_company_profiles mcp
  WHERE _asset_id IS NULL OR mcp.asset_id = _asset_id
  ON CONFLICT (asset_id)
  DO UPDATE SET
    ev_per_ounce = EXCLUDED.ev_per_ounce,
    price_to_nav = EXCLUDED.price_to_nav,
    cash_flow_multiple = EXCLUDED.cash_flow_multiple,
    resource_multiple = EXCLUDED.resource_multiple,
    valuation_rating = EXCLUDED.valuation_rating,
    updated_at = now();
$$;

CREATE OR REPLACE FUNCTION public.portfolio_metal_exposure(_portfolio_id UUID)
RETURNS TABLE (
  metal TEXT,
  weight_percent NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_prices AS (
    SELECT DISTINCT ON (asset_id)
      asset_id,
      price
    FROM (
      SELECT ap.asset_id, ap.price, ap.price_date AS ts, ap.created_at
      FROM public.asset_prices ap
      UNION ALL
      SELECT p.asset_id, p.price, p.as_of_date AS ts, p.created_at
      FROM public.prices p
    ) x
    ORDER BY asset_id, ts DESC, created_at DESC
  ),
  positions AS (
    SELECT
      h.asset_id,
      COALESCE(NULLIF(lower(mcp.primary_metal), ''), 'other') AS metal,
      (h.quantity * COALESCE(lp.price, 0)) AS position_value
    FROM public.holdings_v2 h
    LEFT JOIN latest_prices lp ON lp.asset_id = h.asset_id
    LEFT JOIN public.mining_company_profiles mcp ON mcp.asset_id = h.asset_id
    WHERE h.portfolio_id = _portfolio_id
      AND h.quantity <> 0
  ),
  agg AS (
    SELECT
      metal,
      SUM(position_value) AS metal_value
    FROM positions
    GROUP BY metal
  )
  SELECT
    metal,
    ROUND((metal_value / NULLIF(SUM(metal_value) OVER (), 0)) * 100, 2) AS weight_percent
  FROM agg
  WHERE metal_value > 0
  ORDER BY weight_percent DESC;
$$;

CREATE TABLE IF NOT EXISTS public.jurisdiction_risk_scores (
  jurisdiction TEXT PRIMARY KEY,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.jurisdiction_risk_scores (jurisdiction, risk_level)
VALUES
  ('canada', 'low'),
  ('usa', 'low'),
  ('mexico', 'medium'),
  ('peru', 'medium'),
  ('morocco', 'medium'),
  ('bolivia', 'high')
ON CONFLICT (jurisdiction)
DO UPDATE SET risk_level = EXCLUDED.risk_level;

CREATE OR REPLACE FUNCTION public.portfolio_jurisdiction_risk(_portfolio_id UUID)
RETURNS TABLE (
  low_risk_percent NUMERIC,
  medium_risk_percent NUMERIC,
  high_risk_percent NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_prices AS (
    SELECT DISTINCT ON (asset_id)
      asset_id,
      price
    FROM (
      SELECT ap.asset_id, ap.price, ap.price_date AS ts, ap.created_at
      FROM public.asset_prices ap
      UNION ALL
      SELECT p.asset_id, p.price, p.as_of_date AS ts, p.created_at
      FROM public.prices p
    ) x
    ORDER BY asset_id, ts DESC, created_at DESC
  ),
  positions AS (
    SELECT
      COALESCE(lower(mcp.jurisdiction), 'unknown') AS jurisdiction,
      (h.quantity * COALESCE(lp.price, 0)) AS position_value
    FROM public.holdings_v2 h
    LEFT JOIN latest_prices lp ON lp.asset_id = h.asset_id
    LEFT JOIN public.mining_company_profiles mcp ON mcp.asset_id = h.asset_id
    WHERE h.portfolio_id = _portfolio_id
      AND h.quantity <> 0
  ),
  scored AS (
    SELECT
      COALESCE(jrs.risk_level, 'medium') AS risk_level,
      SUM(p.position_value) AS risk_value
    FROM positions p
    LEFT JOIN public.jurisdiction_risk_scores jrs
      ON jrs.jurisdiction = p.jurisdiction
    GROUP BY COALESCE(jrs.risk_level, 'medium')
  ),
  totals AS (
    SELECT COALESCE(SUM(risk_value), 0) AS total_value
    FROM scored
  )
  SELECT
    ROUND(COALESCE((SELECT risk_value FROM scored WHERE risk_level = 'low'), 0) / NULLIF(t.total_value, 0) * 100, 2) AS low_risk_percent,
    ROUND(COALESCE((SELECT risk_value FROM scored WHERE risk_level = 'medium'), 0) / NULLIF(t.total_value, 0) * 100, 2) AS medium_risk_percent,
    ROUND(COALESCE((SELECT risk_value FROM scored WHERE risk_level = 'high'), 0) / NULLIF(t.total_value, 0) * 100, 2) AS high_risk_percent
  FROM totals t;
$$;

CREATE TABLE IF NOT EXISTS public.mining_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, insight_type, title)
);

CREATE INDEX IF NOT EXISTS idx_mining_insights_portfolio_created
  ON public.mining_insights(portfolio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mining_insights_type
  ON public.mining_insights(insight_type);

CREATE OR REPLACE FUNCTION public.generate_portfolio_mining_insights(_portfolio_id UUID)
RETURNS SETOF public.mining_insights
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _silver_weight NUMERIC := 0;
  _top_jurisdiction TEXT;
  _top_jurisdiction_weight NUMERIC := 0;
BEGIN
  PERFORM public.refresh_mining_valuation_metrics(NULL);

  SELECT COALESCE(weight_percent, 0)
  INTO _silver_weight
  FROM public.portfolio_metal_exposure(_portfolio_id)
  WHERE metal = 'silver';

  WITH latest_prices AS (
    SELECT DISTINCT ON (asset_id)
      asset_id,
      price
    FROM (
      SELECT ap.asset_id, ap.price, ap.price_date AS ts, ap.created_at
      FROM public.asset_prices ap
      UNION ALL
      SELECT p.asset_id, p.price, p.as_of_date AS ts, p.created_at
      FROM public.prices p
    ) x
    ORDER BY asset_id, ts DESC, created_at DESC
  ),
  exposure AS (
    SELECT
      COALESCE(lower(mcp.jurisdiction), 'unknown') AS jurisdiction,
      SUM(h.quantity * COALESCE(lp.price, 0)) AS position_value
    FROM public.holdings_v2 h
    LEFT JOIN latest_prices lp ON lp.asset_id = h.asset_id
    LEFT JOIN public.mining_company_profiles mcp ON mcp.asset_id = h.asset_id
    WHERE h.portfolio_id = _portfolio_id
      AND h.quantity <> 0
    GROUP BY COALESCE(lower(mcp.jurisdiction), 'unknown')
  ),
  ranked AS (
    SELECT
      jurisdiction,
      position_value,
      (position_value / NULLIF(SUM(position_value) OVER (), 0)) * 100 AS pct
    FROM exposure
  )
  SELECT jurisdiction, COALESCE(pct, 0)
  INTO _top_jurisdiction, _top_jurisdiction_weight
  FROM ranked
  ORDER BY pct DESC NULLS LAST
  LIMIT 1;

  IF _silver_weight > 70 THEN
    INSERT INTO public.mining_insights (portfolio_id, insight_type, title, description, severity)
    VALUES (
      _portfolio_id,
      'metal_exposure',
      'High Silver Leverage',
      format('Silver accounts for %s%% of mining exposure, increasing sensitivity to silver price volatility.', ROUND(_silver_weight, 2)),
      CASE WHEN _silver_weight >= 85 THEN 'high' ELSE 'medium' END
    )
    ON CONFLICT (portfolio_id, insight_type, title)
    DO UPDATE SET
      description = EXCLUDED.description,
      severity = EXCLUDED.severity,
      created_at = now();
  END IF;

  IF _top_jurisdiction_weight > 50 AND _top_jurisdiction IS NOT NULL THEN
    INSERT INTO public.mining_insights (portfolio_id, insight_type, title, description, severity)
    VALUES (
      _portfolio_id,
      'jurisdiction_risk',
      'Jurisdiction Concentration Risk',
      format('%s%% of mining holdings are concentrated in %s.', ROUND(_top_jurisdiction_weight, 2), initcap(_top_jurisdiction)),
      CASE WHEN _top_jurisdiction_weight >= 70 THEN 'high' ELSE 'medium' END
    )
    ON CONFLICT (portfolio_id, insight_type, title)
    DO UPDATE SET
      description = EXCLUDED.description,
      severity = EXCLUDED.severity,
      created_at = now();
  END IF;

  INSERT INTO public.mining_insights (portfolio_id, insight_type, title, description, severity)
  SELECT
    _portfolio_id,
    'valuation',
    'Potential Deep Value Opportunity',
    format('%s trades at EV/oz %.2f, below the deep value threshold.', a.symbol, mvm.ev_per_ounce),
    'low'
  FROM public.holdings_v2 h
  JOIN public.assets a ON a.id = h.asset_id
  JOIN public.mining_valuation_metrics mvm ON mvm.asset_id = h.asset_id
  WHERE h.portfolio_id = _portfolio_id
    AND h.quantity <> 0
    AND mvm.ev_per_ounce < 50
  ON CONFLICT (portfolio_id, insight_type, title)
  DO UPDATE SET
    description = EXCLUDED.description,
    severity = EXCLUDED.severity,
    created_at = now();

  RETURN QUERY
  SELECT mi.*
  FROM public.mining_insights mi
  WHERE mi.portfolio_id = _portfolio_id
  ORDER BY mi.created_at DESC;
END;
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
    FROM public.holdings_v2 h
    WHERE h.portfolio_id = _portfolio_id
      AND h.quantity <> 0
  LOOP
    PERFORM public.classify_mining_company(_asset_id);
  END LOOP;

  PERFORM public.refresh_mining_valuation_metrics(NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_portfolio_mining_dashboard(_portfolio_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_prices AS (
    SELECT DISTINCT ON (asset_id)
      asset_id,
      price
    FROM (
      SELECT ap.asset_id, ap.price, ap.price_date AS ts, ap.created_at
      FROM public.asset_prices ap
      UNION ALL
      SELECT p.asset_id, p.price, p.as_of_date AS ts, p.created_at
      FROM public.prices p
    ) x
    ORDER BY asset_id, ts DESC, created_at DESC
  ),
  positions AS (
    SELECT
      h.asset_id,
      h.quantity,
      COALESCE(lp.price, 0) AS price,
      h.quantity * COALESCE(lp.price, 0) AS position_value,
      COALESCE(NULLIF(lower(mcp.primary_metal), ''), 'other') AS metal,
      COALESCE(NULLIF(lower(mcp.jurisdiction), ''), 'unknown') AS jurisdiction,
      COALESCE(mcp.stage::TEXT, 'explorer') AS stage,
      mvm.ev_per_ounce,
      mvm.valuation_rating
    FROM public.holdings_v2 h
    LEFT JOIN latest_prices lp ON lp.asset_id = h.asset_id
    LEFT JOIN public.mining_company_profiles mcp ON mcp.asset_id = h.asset_id
    LEFT JOIN public.mining_valuation_metrics mvm ON mvm.asset_id = h.asset_id
    WHERE h.portfolio_id = _portfolio_id
      AND h.quantity <> 0
  ),
  metal_exposure AS (
    SELECT
      metal,
      ROUND((SUM(position_value) / NULLIF(SUM(SUM(position_value)) OVER (), 0)) * 100, 2) AS weight_percent
    FROM positions
    GROUP BY metal
  ),
  jurisdiction_exposure AS (
    SELECT
      jurisdiction,
      ROUND((SUM(position_value) / NULLIF(SUM(SUM(position_value)) OVER (), 0)) * 100, 2) AS weight_percent
    FROM positions
    GROUP BY jurisdiction
  ),
  stage_breakdown AS (
    SELECT
      stage,
      COUNT(*)::INT AS holdings_count,
      ROUND((SUM(position_value) / NULLIF(SUM(SUM(position_value)) OVER (), 0)) * 100, 2) AS weight_percent
    FROM positions
    GROUP BY stage
  ),
  valuation_summary AS (
    SELECT jsonb_build_object(
      'avg_ev_per_ounce', ROUND(AVG(ev_per_ounce), 2),
      'deep_value_count', COUNT(*) FILTER (WHERE ev_per_ounce < 50),
      'value_count', COUNT(*) FILTER (WHERE ev_per_ounce >= 50 AND ev_per_ounce < 150),
      'fair_count', COUNT(*) FILTER (WHERE ev_per_ounce >= 150 AND ev_per_ounce <= 400),
      'expensive_count', COUNT(*) FILTER (WHERE ev_per_ounce > 400)
    ) AS summary
    FROM positions
    WHERE ev_per_ounce IS NOT NULL
  )
  SELECT jsonb_build_object(
    'exposure_by_metal', COALESCE((SELECT jsonb_agg(to_jsonb(me) ORDER BY me.weight_percent DESC) FROM metal_exposure me), '[]'::jsonb),
    'exposure_by_jurisdiction', COALESCE((SELECT jsonb_agg(to_jsonb(je) ORDER BY je.weight_percent DESC) FROM jurisdiction_exposure je), '[]'::jsonb),
    'stage_breakdown', COALESCE((SELECT jsonb_agg(to_jsonb(sb) ORDER BY sb.weight_percent DESC) FROM stage_breakdown sb), '[]'::jsonb),
    'valuation_summary', COALESCE((SELECT summary FROM valuation_summary), '{}'::jsonb),
    'insights', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'insight_type', mi.insight_type,
          'title', mi.title,
          'description', mi.description,
          'severity', mi.severity,
          'created_at', mi.created_at
        )
        ORDER BY mi.created_at DESC
      )
      FROM public.mining_insights mi
      WHERE mi.portfolio_id = _portfolio_id
    ), '[]'::jsonb)
  );
$$;

ALTER TABLE public.mining_company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mining_valuation_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jurisdiction_risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mining_insights ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mining_company_profiles' AND policyname = 'Mining company profiles readable by all'
  ) THEN
    CREATE POLICY "Mining company profiles readable by all"
      ON public.mining_company_profiles
      FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mining_company_profiles' AND policyname = 'Mining company profiles writable by authenticated'
  ) THEN
    CREATE POLICY "Mining company profiles writable by authenticated"
      ON public.mining_company_profiles
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mining_valuation_metrics' AND policyname = 'Mining valuation metrics readable by all'
  ) THEN
    CREATE POLICY "Mining valuation metrics readable by all"
      ON public.mining_valuation_metrics
      FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'jurisdiction_risk_scores' AND policyname = 'Jurisdiction risk scores readable by all'
  ) THEN
    CREATE POLICY "Jurisdiction risk scores readable by all"
      ON public.jurisdiction_risk_scores
      FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mining_insights' AND policyname = 'Mining insights visible by portfolio access'
  ) THEN
    CREATE POLICY "Mining insights visible by portfolio access"
      ON public.mining_insights
      FOR SELECT
      USING (public.can_view_portfolio(portfolio_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mining_insights' AND policyname = 'Mining insights writable by portfolio owner'
  ) THEN
    CREATE POLICY "Mining insights writable by portfolio owner"
      ON public.mining_insights
      FOR ALL
      TO authenticated
      USING (public.owns_portfolio(portfolio_id))
      WITH CHECK (public.owns_portfolio(portfolio_id));
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.classify_mining_company(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_mining_valuation_metrics(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portfolio_metal_exposure(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portfolio_jurisdiction_risk(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_portfolio_mining_insights(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_portfolio_mining_snapshot(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_portfolio_mining_dashboard(UUID) TO authenticated, service_role;
-- ===== END 20260316100000_mining_intelligence_engine.sql =====
-- ===== BEGIN 20260317090000_database_connection_repairs.sql =====
-- Repair migration for environments that are missing newer DB objects/RPCs.
-- Keeps everything idempotent and backwards compatible.

-- 1) Compatibility shims for schemas that only have `holdings`/`prices`.
DO $$
BEGIN
  IF to_regclass('public.holdings_v2') IS NULL AND to_regclass('public.holdings') IS NOT NULL THEN
    EXECUTE $v$
      CREATE VIEW public.holdings_v2 AS
      SELECT
        h.id,
        h.portfolio_id,
        h.asset_id,
        h.quantity,
        h.avg_cost,
        h.cost_currency,
        h.created_at,
        h.updated_at
      FROM public.holdings h
    $v$;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.asset_prices') IS NULL AND to_regclass('public.prices') IS NOT NULL THEN
    EXECUTE $v$
      CREATE VIEW public.asset_prices AS
      SELECT
        p.id,
        p.asset_id,
        p.price,
        p.as_of_date::date AS price_date,
        p.created_at
      FROM public.prices p
    $v$;
  END IF;
END $$;

-- 2) Backfill commonly missing company_metrics columns in older DBs.
ALTER TABLE IF EXISTS public.company_metrics
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS source_title TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 3) Mining engine core objects.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'mining_stage'
  ) THEN
    CREATE TYPE public.mining_stage AS ENUM (
      'explorer',
      'developer',
      'near_term_producer',
      'producer',
      'mid_tier',
      'major'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.mining_company_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL UNIQUE REFERENCES public.assets(id) ON DELETE CASCADE,
  primary_metal TEXT,
  secondary_metals TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  jurisdiction TEXT,
  stage public.mining_stage NOT NULL DEFAULT 'explorer',
  market_cap NUMERIC,
  enterprise_value NUMERIC,
  annual_production_oz NUMERIC,
  resource_size_oz NUMERIC,
  all_in_sustaining_cost NUMERIC,
  mine_life_years NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mining_valuation_metrics (
  asset_id UUID PRIMARY KEY REFERENCES public.assets(id) ON DELETE CASCADE,
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

INSERT INTO public.jurisdiction_risk_scores (jurisdiction, risk_level)
VALUES
  ('canada', 'low'),
  ('usa', 'low'),
  ('mexico', 'medium'),
  ('peru', 'medium'),
  ('morocco', 'medium'),
  ('bolivia', 'high')
ON CONFLICT (jurisdiction) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.mining_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, insight_type, title)
);

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

  UPDATE public.mining_company_profiles SET stage = _stage WHERE asset_id = _asset_id;
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
    FROM public.holdings_v2 h
    WHERE h.portfolio_id = _portfolio_id
      AND h.quantity <> 0
  LOOP
    PERFORM public.classify_mining_company(_asset_id);
  END LOOP;

  PERFORM public.refresh_mining_valuation_metrics(NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_portfolio_mining_dashboard(_portfolio_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_prices AS (
    SELECT DISTINCT ON (asset_id)
      asset_id,
      price
    FROM (
      SELECT ap.asset_id, ap.price, ap.price_date::timestamp AS ts, ap.created_at
      FROM public.asset_prices ap
      UNION ALL
      SELECT p.asset_id, p.price, p.as_of_date::timestamp AS ts, p.created_at
      FROM public.prices p
    ) x
    ORDER BY asset_id, ts DESC, created_at DESC
  ),
  positions AS (
    SELECT
      h.asset_id,
      h.quantity,
      COALESCE(lp.price, 0) AS price,
      h.quantity * COALESCE(lp.price, 0) AS position_value,
      COALESCE(NULLIF(lower(mcp.primary_metal), ''), 'other') AS metal,
      COALESCE(NULLIF(lower(mcp.jurisdiction), ''), 'unknown') AS jurisdiction,
      COALESCE(mcp.stage::TEXT, 'explorer') AS stage,
      mvm.ev_per_ounce
    FROM public.holdings_v2 h
    LEFT JOIN latest_prices lp ON lp.asset_id = h.asset_id
    LEFT JOIN public.mining_company_profiles mcp ON mcp.asset_id = h.asset_id
    LEFT JOIN public.mining_valuation_metrics mvm ON mvm.asset_id = h.asset_id
    WHERE h.portfolio_id = _portfolio_id
      AND h.quantity <> 0
  ),
  metal_exposure AS (
    SELECT
      metal,
      ROUND((SUM(position_value) / NULLIF(SUM(SUM(position_value)) OVER (), 0)) * 100, 2) AS weight_percent
    FROM positions
    GROUP BY metal
  ),
  jurisdiction_exposure AS (
    SELECT
      jurisdiction,
      ROUND((SUM(position_value) / NULLIF(SUM(SUM(position_value)) OVER (), 0)) * 100, 2) AS weight_percent
    FROM positions
    GROUP BY jurisdiction
  ),
  stage_breakdown AS (
    SELECT
      stage,
      COUNT(*)::INT AS holdings_count,
      ROUND((SUM(position_value) / NULLIF(SUM(SUM(position_value)) OVER (), 0)) * 100, 2) AS weight_percent
    FROM positions
    GROUP BY stage
  ),
  valuation_summary AS (
    SELECT jsonb_build_object(
      'avg_ev_per_ounce', ROUND(AVG(ev_per_ounce), 2),
      'deep_value_count', COUNT(*) FILTER (WHERE ev_per_ounce < 50),
      'value_count', COUNT(*) FILTER (WHERE ev_per_ounce >= 50 AND ev_per_ounce < 150),
      'fair_count', COUNT(*) FILTER (WHERE ev_per_ounce >= 150 AND ev_per_ounce <= 400),
      'expensive_count', COUNT(*) FILTER (WHERE ev_per_ounce > 400)
    ) AS summary
    FROM positions
    WHERE ev_per_ounce IS NOT NULL
  )
  SELECT jsonb_build_object(
    'exposure_by_metal', COALESCE((SELECT jsonb_agg(to_jsonb(me) ORDER BY me.weight_percent DESC) FROM metal_exposure me), '[]'::jsonb),
    'exposure_by_jurisdiction', COALESCE((SELECT jsonb_agg(to_jsonb(je) ORDER BY je.weight_percent DESC) FROM jurisdiction_exposure je), '[]'::jsonb),
    'stage_breakdown', COALESCE((SELECT jsonb_agg(to_jsonb(sb) ORDER BY sb.weight_percent DESC) FROM stage_breakdown sb), '[]'::jsonb),
    'valuation_summary', COALESCE((SELECT summary FROM valuation_summary), '{}'::jsonb),
    'insights', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'insight_type', mi.insight_type,
          'title', mi.title,
          'description', mi.description,
          'severity', mi.severity,
          'created_at', mi.created_at
        )
        ORDER BY mi.created_at DESC
      )
      FROM public.mining_insights mi
      WHERE mi.portfolio_id = _portfolio_id
    ), '[]'::jsonb)
  );
$$;

-- 4) Missing RPCs referenced by frontend.
CREATE OR REPLACE FUNCTION public.analyze_portfolio(portfolio_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest_prices AS (
    SELECT DISTINCT ON (asset_id)
      asset_id,
      price
    FROM public.prices
    ORDER BY asset_id, as_of_date DESC, created_at DESC
  ),
  positions AS (
    SELECT
      h.asset_id,
      (h.quantity * COALESCE(lp.price, 0)) AS value
    FROM public.holdings h
    LEFT JOIN latest_prices lp ON lp.asset_id = h.asset_id
    WHERE h.portfolio_id = analyze_portfolio.portfolio_id
      AND h.quantity <> 0
  ),
  totals AS (
    SELECT COALESCE(SUM(value), 0) AS total_value, COUNT(*)::INT AS holdings_count FROM positions
  ),
  weights AS (
    SELECT
      value / NULLIF((SELECT total_value FROM totals), 0) AS w
    FROM positions
    WHERE value > 0
  ),
  hhi AS (
    SELECT COALESCE(SUM(w * w), 1) AS concentration FROM weights
  )
  SELECT jsonb_build_object(
    'diversification', ROUND((1 - LEAST((SELECT concentration FROM hhi), 1)) * 100, 2),
    'risk_rating', CASE
      WHEN (SELECT concentration FROM hhi) > 0.35 THEN 'high'
      WHEN (SELECT concentration FROM hhi) > 0.2 THEN 'medium'
      ELSE 'low'
    END,
    'recommendations', to_jsonb(ARRAY[
      CASE WHEN (SELECT holdings_count FROM totals) < 5 THEN 'Öka antalet innehav för bättre diversifiering.' ELSE 'Diversifieringsnivån ser stabil ut.' END,
      'Granska regelbundet positionernas viktning mot din riskprofil.',
      'Säkerställ att likviditetsbehov och tidshorisont matchar portföljens sammansättning.'
    ])
  );
$$;

-- Existing environments may already have ai_scan_companies(jsonb) with a different return type.
DROP FUNCTION IF EXISTS public.ai_scan_companies(JSONB);

CREATE OR REPLACE FUNCTION public.ai_scan_companies(checklist JSONB DEFAULT '[]'::jsonb)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'status', 'ok',
    'message', 'AI bolagsscanning är inte fullaktiverad än. RPC finns nu för stabil appkoppling.',
    'checklist', COALESCE(checklist, '[]'::jsonb),
    'results', '[]'::jsonb
  );
$$;

GRANT EXECUTE ON FUNCTION public.classify_mining_company(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_mining_valuation_metrics(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_portfolio_mining_snapshot(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_portfolio_mining_dashboard(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.analyze_portfolio(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_scan_companies(JSONB) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
-- ===== END 20260317090000_database_connection_repairs.sql =====
-- ===== BEGIN 20260318100000_fix_friend_table_privileges.sql =====
-- Ensure authenticated users can read and manage friend graph rows via PostgREST + RLS.
GRANT SELECT, INSERT, DELETE ON TABLE public.friends TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.friend_requests TO authenticated;
-- ===== END 20260318100000_fix_friend_table_privileges.sql =====
