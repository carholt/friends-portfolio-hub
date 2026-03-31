-- Ensure clients can read portfolio valuations table subject to RLS policies.
-- Without explicit table grants, PostgREST requests can fail with:
-- `permission denied for table portfolio_valuations`.

GRANT SELECT ON TABLE public.portfolio_valuations TO authenticated, service_role;
