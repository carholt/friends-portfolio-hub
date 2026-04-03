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
