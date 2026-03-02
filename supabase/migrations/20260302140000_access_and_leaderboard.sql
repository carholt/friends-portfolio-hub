-- Centralized access helper to keep visibility checks consistent in SQL and RLS-aware queries
CREATE OR REPLACE FUNCTION public.can_access_portfolio(_portfolio_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.portfolios p
    WHERE p.id = _portfolio_id
      AND (
        p.owner_user_id = auth.uid()
        OR p.visibility = 'public'
        OR (p.visibility = 'authenticated' AND auth.uid() IS NOT NULL)
        OR (
          p.visibility = 'group'
          AND p.group_id IS NOT NULL
          AND public.is_group_member(auth.uid(), p.group_id)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_portfolio(_portfolio_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_access_portfolio(_portfolio_id);
$$;

-- Server-side leaderboard over accessible portfolios only.
CREATE OR REPLACE FUNCTION public.get_leaderboard(_period TEXT DEFAULT 'ALL')
RETURNS TABLE (
  portfolio_id UUID,
  portfolio_name TEXT,
  visibility public.portfolio_visibility,
  owner_name TEXT,
  start_value NUMERIC,
  end_value NUMERIC,
  return_abs NUMERIC,
  return_pct NUMERIC,
  last_updated DATE
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH params AS (
    SELECT CASE _period
      WHEN '1M' THEN (CURRENT_DATE - INTERVAL '1 month')::date
      WHEN '3M' THEN (CURRENT_DATE - INTERVAL '3 months')::date
      WHEN 'YTD' THEN make_date(EXTRACT(year FROM CURRENT_DATE)::int, 1, 1)
      WHEN '1Y' THEN (CURRENT_DATE - INTERVAL '1 year')::date
      ELSE DATE '2000-01-01'
    END AS period_start
  ),
  accessible AS (
    SELECT p.id, p.name, p.visibility, p.owner_user_id
    FROM public.portfolios p
    WHERE public.can_access_portfolio(p.id)
  ),
  valuation_points AS (
    SELECT
      a.id AS portfolio_id,
      (
        SELECT v.total_value
        FROM public.portfolio_valuations v, params
        WHERE v.portfolio_id = a.id
          AND v.as_of_date >= params.period_start
        ORDER BY v.as_of_date ASC
        LIMIT 1
      ) AS period_start_value,
      (
        SELECT v.total_value
        FROM public.portfolio_valuations v
        WHERE v.portfolio_id = a.id
        ORDER BY v.as_of_date ASC
        LIMIT 1
      ) AS first_ever_value,
      (
        SELECT v.total_value
        FROM public.portfolio_valuations v
        WHERE v.portfolio_id = a.id
        ORDER BY v.as_of_date DESC
        LIMIT 1
      ) AS latest_value,
      (
        SELECT v.as_of_date
        FROM public.portfolio_valuations v
        WHERE v.portfolio_id = a.id
        ORDER BY v.as_of_date DESC
        LIMIT 1
      ) AS latest_date
    FROM accessible a
  )
  SELECT
    a.id AS portfolio_id,
    a.name AS portfolio_name,
    a.visibility,
    COALESCE(pr.display_name, '–') AS owner_name,
    COALESCE(vp.period_start_value, vp.first_ever_value) AS start_value,
    vp.latest_value AS end_value,
    CASE
      WHEN vp.latest_value IS NULL THEN NULL
      ELSE vp.latest_value - COALESCE(vp.period_start_value, vp.first_ever_value)
    END AS return_abs,
    CASE
      WHEN COALESCE(vp.period_start_value, vp.first_ever_value) > 0 AND vp.latest_value IS NOT NULL THEN
        ((vp.latest_value - COALESCE(vp.period_start_value, vp.first_ever_value))
          / COALESCE(vp.period_start_value, vp.first_ever_value)) * 100
      ELSE NULL
    END AS return_pct,
    vp.latest_date AS last_updated
  FROM accessible a
  LEFT JOIN valuation_points vp ON vp.portfolio_id = a.id
  LEFT JOIN public.profiles pr ON pr.user_id = a.owner_user_id
  WHERE vp.latest_value IS NOT NULL
  ORDER BY return_pct DESC NULLS LAST, return_abs DESC NULLS LAST;
$$;
