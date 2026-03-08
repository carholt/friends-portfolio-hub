-- Fix Supabase RLS policies and table permissions for frontend authenticated access.

-- 1) Ensure Row Level Security is enabled on all relevant tables.
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.prices ENABLE ROW LEVEL SECURITY;

-- 2) Drop existing policies on target tables so policy behavior is deterministic.
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('profiles', 'portfolios', 'assets', 'transactions', 'holdings', 'prices')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END
$$;

-- 3) Profiles: users can read/update only their own profile.
CREATE POLICY "user_can_read_own_profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "user_can_update_own_profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 4) Portfolios: users can CRUD only their own rows.
CREATE POLICY "user_can_read_own_portfolios"
ON public.portfolios
FOR SELECT
TO authenticated
USING (auth.uid() = owner_user_id);

CREATE POLICY "user_can_create_portfolios"
ON public.portfolios
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "user_can_update_own_portfolios"
ON public.portfolios
FOR UPDATE
TO authenticated
USING (auth.uid() = owner_user_id)
WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "user_can_delete_own_portfolios"
ON public.portfolios
FOR DELETE
TO authenticated
USING (auth.uid() = owner_user_id);

-- 5) Transactions: access only through owned portfolios.
CREATE POLICY "user_can_read_own_transactions"
ON public.transactions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.portfolios
    WHERE portfolios.id = transactions.portfolio_id
      AND portfolios.owner_user_id = auth.uid()
  )
);

CREATE POLICY "user_can_insert_own_transactions"
ON public.transactions
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.portfolios
    WHERE portfolios.id = transactions.portfolio_id
      AND portfolios.owner_user_id = auth.uid()
  )
);

CREATE POLICY "user_can_update_own_transactions"
ON public.transactions
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.portfolios
    WHERE portfolios.id = transactions.portfolio_id
      AND portfolios.owner_user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.portfolios
    WHERE portfolios.id = transactions.portfolio_id
      AND portfolios.owner_user_id = auth.uid()
  )
);

CREATE POLICY "user_can_delete_own_transactions"
ON public.transactions
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.portfolios
    WHERE portfolios.id = transactions.portfolio_id
      AND portfolios.owner_user_id = auth.uid()
  )
);

-- 6) Holdings: access only through owned portfolios.
CREATE POLICY "user_can_read_own_holdings"
ON public.holdings
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.portfolios
    WHERE portfolios.id = holdings.portfolio_id
      AND portfolios.owner_user_id = auth.uid()
  )
);

CREATE POLICY "user_can_insert_own_holdings"
ON public.holdings
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.portfolios
    WHERE portfolios.id = holdings.portfolio_id
      AND portfolios.owner_user_id = auth.uid()
  )
);

CREATE POLICY "user_can_update_own_holdings"
ON public.holdings
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.portfolios
    WHERE portfolios.id = holdings.portfolio_id
      AND portfolios.owner_user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.portfolios
    WHERE portfolios.id = holdings.portfolio_id
      AND portfolios.owner_user_id = auth.uid()
  )
);

CREATE POLICY "user_can_delete_own_holdings"
ON public.holdings
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.portfolios
    WHERE portfolios.id = holdings.portfolio_id
      AND portfolios.owner_user_id = auth.uid()
  )
);

-- 7) Assets: public read-only, writes for service_role only.
CREATE POLICY "assets_public_read"
ON public.assets
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "assets_service_role_insert"
ON public.assets
FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "assets_service_role_update"
ON public.assets
FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "assets_service_role_delete"
ON public.assets
FOR DELETE
TO service_role
USING (true);

-- 8) Prices: public read-only, writes for service_role only.
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

-- 9) Grants: lock down then grant only required privileges.
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE ALL ON TABLE public.portfolios FROM anon;
REVOKE ALL ON TABLE public.transactions FROM anon;
REVOKE ALL ON TABLE public.holdings FROM anon;

REVOKE ALL ON TABLE public.profiles FROM authenticated;
REVOKE ALL ON TABLE public.portfolios FROM authenticated;
REVOKE ALL ON TABLE public.transactions FROM authenticated;
REVOKE ALL ON TABLE public.holdings FROM authenticated;
REVOKE ALL ON TABLE public.assets FROM authenticated;
REVOKE ALL ON TABLE public.prices FROM authenticated;

GRANT SELECT ON public.assets TO anon;
GRANT SELECT ON public.prices TO anon;

GRANT SELECT ON public.assets TO authenticated;
GRANT SELECT ON public.prices TO authenticated;

GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portfolios TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.holdings TO authenticated;

-- Keep service_role explicit for operational paths and bypass scenarios.
GRANT ALL PRIVILEGES ON TABLE public.profiles TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.portfolios TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.transactions TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.holdings TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.assets TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.prices TO service_role;

-- 10) Verification queries (run after migration):
-- Audit current grants for required roles/tables.
-- SELECT grantee, privilege_type, table_name
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name IN ('profiles', 'portfolios', 'assets', 'transactions', 'holdings', 'prices')
--   AND grantee IN ('anon', 'authenticated', 'service_role')
-- ORDER BY table_name, grantee, privilege_type;

-- Audit RLS enablement.
-- SELECT relname, relrowsecurity
-- FROM pg_class
-- WHERE relnamespace = 'public'::regnamespace
--   AND relname IN ('profiles', 'portfolios', 'assets', 'transactions', 'holdings', 'prices')
-- ORDER BY relname;

-- Audit policies.
-- SELECT tablename, policyname, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('profiles', 'portfolios', 'assets', 'transactions', 'holdings', 'prices')
-- ORDER BY tablename, policyname;

-- Verify ownership columns exist.
-- SELECT table_name, column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND (
--     (table_name = 'profiles' AND column_name = 'user_id')
--     OR (table_name = 'portfolios' AND column_name = 'owner_user_id')
--     OR (table_name = 'transactions' AND column_name = 'portfolio_id')
--     OR (table_name = 'holdings' AND column_name = 'portfolio_id')
--   )
-- ORDER BY table_name, column_name;

-- Authenticated role smoke tests (execute in SQL editor as authenticated user):
-- SELECT * FROM public.portfolios LIMIT 1;
-- INSERT INTO public.portfolios (name, owner_user_id)
-- VALUES ('Test', auth.uid());
