-- Company AI reports and paywall access controls.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_tier TEXT NOT NULL DEFAULT 'free';

CREATE TABLE IF NOT EXISTS public.company_ai_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
  model TEXT,
  report JSONB,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.company_ai_report_sales (
  report_id UUID NOT NULL REFERENCES public.company_ai_reports(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  price_paid NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_company_ai_reports_asset_created_at
  ON public.company_ai_reports (asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_ai_reports_created_by
  ON public.company_ai_reports (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_ai_reports_status
  ON public.company_ai_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_ai_report_sales_user_id
  ON public.company_ai_report_sales (user_id, created_at DESC);

ALTER TABLE public.company_ai_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_ai_report_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_ai_reports_select_auth"
  ON public.company_ai_reports
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "company_ai_reports_insert_auth"
  ON public.company_ai_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "company_ai_reports_update_owner"
  ON public.company_ai_reports
  FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "company_ai_report_sales_select_own"
  ON public.company_ai_report_sales
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.user_has_access_to_report(_user_id UUID, _report_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paywall_enabled BOOLEAN;
  v_created_by UUID;
  v_subscription_tier TEXT;
BEGIN
  v_paywall_enabled := COALESCE(NULLIF(current_setting('app.settings.paywall_enabled', true), ''), 'false')::BOOLEAN;
  IF NOT v_paywall_enabled THEN
    RETURN TRUE;
  END IF;

  SELECT created_by INTO v_created_by
  FROM public.company_ai_reports
  WHERE id = _report_id;

  IF v_created_by IS NULL THEN
    RETURN FALSE;
  END IF;

  IF _user_id = v_created_by THEN
    RETURN TRUE;
  END IF;

  SELECT lower(COALESCE(subscription_tier, 'free')) INTO v_subscription_tier
  FROM public.profiles
  WHERE user_id = _user_id;

  IF v_subscription_tier IN ('pro', 'max') THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.company_ai_report_sales s
    WHERE s.report_id = _report_id
      AND s.user_id = _user_id
  );
END;
$$;

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
  v_report_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  INSERT INTO public.company_ai_reports (
    asset_id,
    portfolio_id,
    created_by,
    status,
    assumptions
  ) VALUES (
    _asset_id,
    _portfolio_id,
    auth.uid(),
    'queued',
    COALESCE(_assumptions, '{}'::jsonb)
  )
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

REVOKE ALL ON TABLE public.company_ai_reports FROM PUBLIC;
REVOKE ALL ON TABLE public.company_ai_report_sales FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_has_access_to_report(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_company_ai_report(UUID, UUID, JSONB) FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON TABLE public.company_ai_reports TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.company_ai_report_sales TO service_role;
GRANT SELECT ON TABLE public.company_ai_report_sales TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_access_to_report(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_company_ai_report(UUID, UUID, JSONB) TO authenticated, service_role;
