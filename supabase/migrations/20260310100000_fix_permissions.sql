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
