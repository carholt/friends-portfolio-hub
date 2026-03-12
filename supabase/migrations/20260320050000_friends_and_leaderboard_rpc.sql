-- Add compatibility RPC for leaderboard queries and missing friends table.

CREATE OR REPLACE FUNCTION public.get_portfolio_leaderboard("limit" INTEGER DEFAULT 50)
RETURNS TABLE (
  portfolio_id UUID,
  portfolio_name TEXT,
  total_value NUMERIC,
  total_return NUMERIC,
  return_pct NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    lb.portfolio_id,
    lb.portfolio_name,
    lb.total_value,
    lb.total_return,
    lb.return_pct
  FROM public.get_leaderboard('ALL') lb
  LIMIT GREATEST(COALESCE("limit", 50), 1);
$$;

REVOKE ALL ON FUNCTION public.get_portfolio_leaderboard(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_portfolio_leaderboard(INTEGER) TO authenticated, anon, service_role;

CREATE TABLE IF NOT EXISTS public.friends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT friends_not_self CHECK (user_id <> friend_user_id),
  CONSTRAINT friends_unique_pair UNIQUE (user_id, friend_user_id)
);

ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "friends_select_involved" ON public.friends;
CREATE POLICY "friends_select_involved"
ON public.friends
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR auth.uid() = friend_user_id);

DROP POLICY IF EXISTS "friends_insert_owner" ON public.friends;
CREATE POLICY "friends_insert_owner"
ON public.friends
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "friends_delete_owner" ON public.friends;
CREATE POLICY "friends_delete_owner"
ON public.friends
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.friends FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON TABLE public.friends TO authenticated;
