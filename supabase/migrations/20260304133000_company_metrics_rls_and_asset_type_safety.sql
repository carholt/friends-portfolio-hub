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
