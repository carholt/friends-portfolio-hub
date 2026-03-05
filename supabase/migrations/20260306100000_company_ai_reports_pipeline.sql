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
