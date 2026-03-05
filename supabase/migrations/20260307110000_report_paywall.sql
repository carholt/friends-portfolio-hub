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
