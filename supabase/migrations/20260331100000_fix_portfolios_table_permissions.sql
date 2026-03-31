-- Fix runtime errors like: `permission denied for table portfolios`
-- Ensure table-level grants are explicitly aligned with RLS policies.

REVOKE ALL ON TABLE public.portfolios FROM PUBLIC;

-- Public portfolio pages need read access for anonymous users.
GRANT SELECT ON TABLE public.portfolios TO anon;

-- Authenticated users can read and manage their own portfolios via RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.portfolios TO authenticated;

-- Service role should have full access for backend jobs.
GRANT ALL ON TABLE public.portfolios TO service_role;
