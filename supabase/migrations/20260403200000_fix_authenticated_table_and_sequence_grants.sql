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
