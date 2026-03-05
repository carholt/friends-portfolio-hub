CREATE OR REPLACE FUNCTION public.paywall_enabled()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.settings.paywall_enabled', true), ''), 'false')::BOOLEAN;
$$;

ALTER TABLE public.profiles
  ALTER COLUMN subscription_tier DROP DEFAULT;

ALTER TABLE public.profiles
  ALTER COLUMN subscription_tier SET DEFAULT (
    CASE WHEN public.paywall_enabled() THEN 'free' ELSE 'max' END
  );

UPDATE public.profiles
SET subscription_tier = CASE WHEN public.paywall_enabled() THEN 'free' ELSE 'max' END
WHERE subscription_tier IS NULL OR btrim(subscription_tier) = '';

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

  IF NOT public.paywall_enabled() THEN
    RETURN TRUE;
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
      AND lower(COALESCE(p.subscription_tier, 'free')) IN ('pro', 'max')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, subscription_tier)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    CASE WHEN public.paywall_enabled() THEN 'free' ELSE 'max' END
  );
  RETURN NEW;
END;
$$;
