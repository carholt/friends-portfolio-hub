-- Friend graph social layer + privacy integration.

CREATE TABLE IF NOT EXISTS public.friends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  friend_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT friends_not_self CHECK (user_id <> friend_user_id),
  CONSTRAINT friends_unique UNIQUE (user_id, friend_user_id)
);

CREATE INDEX IF NOT EXISTS idx_friends_user_id ON public.friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend_user_id ON public.friends(friend_user_id);

CREATE TABLE IF NOT EXISTS public.friend_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  CONSTRAINT friend_requests_not_self CHECK (requester_id <> recipient_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_pending_unique
  ON public.friend_requests(requester_id, recipient_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_friend_requests_requester_id ON public.friend_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_recipient_id ON public.friend_requests(recipient_id);

ALTER TABLE public.friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "friends_read_own" ON public.friends;
CREATE POLICY "friends_read_own"
ON public.friends
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR auth.uid() = friend_user_id);

DROP POLICY IF EXISTS "friends_insert_own" ON public.friends;
CREATE POLICY "friends_insert_own"
ON public.friends
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "friends_delete_own" ON public.friends;
CREATE POLICY "friends_delete_own"
ON public.friends
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "friend_requests_read_own" ON public.friend_requests;
CREATE POLICY "friend_requests_read_own"
ON public.friend_requests
FOR SELECT
TO authenticated
USING (auth.uid() = requester_id OR auth.uid() = recipient_id);

DROP POLICY IF EXISTS "friend_requests_insert_requester" ON public.friend_requests;
CREATE POLICY "friend_requests_insert_requester"
ON public.friend_requests
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = requester_id AND status = 'pending');

DROP POLICY IF EXISTS "friend_requests_update_participants" ON public.friend_requests;
CREATE POLICY "friend_requests_update_participants"
ON public.friend_requests
FOR UPDATE
TO authenticated
USING (auth.uid() = requester_id OR auth.uid() = recipient_id)
WITH CHECK (auth.uid() = requester_id OR auth.uid() = recipient_id);

CREATE OR REPLACE FUNCTION public.accept_friend_request(_request_id UUID)
RETURNS public.friend_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _request public.friend_requests;
  _user_id UUID := auth.uid();
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO _request
  FROM public.friend_requests
  WHERE id = _request_id;

  IF _request.id IS NULL THEN
    RAISE EXCEPTION 'Friend request not found';
  END IF;

  IF _request.recipient_id <> _user_id THEN
    RAISE EXCEPTION 'Only recipient can accept friend request';
  END IF;

  IF _request.status <> 'pending' THEN
    RETURN _request;
  END IF;

  UPDATE public.friend_requests
  SET status = 'accepted', responded_at = now()
  WHERE id = _request_id
  RETURNING * INTO _request;

  INSERT INTO public.friends(user_id, friend_user_id)
  VALUES (_request.requester_id, _request.recipient_id)
  ON CONFLICT (user_id, friend_user_id) DO NOTHING;

  INSERT INTO public.friends(user_id, friend_user_id)
  VALUES (_request.recipient_id, _request.requester_id)
  ON CONFLICT (user_id, friend_user_id) DO NOTHING;

  RETURN _request;
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_friend_request(_request_id UUID)
RETURNS public.friend_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _request public.friend_requests;
  _user_id UUID := auth.uid();
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.friend_requests
  SET status = 'declined', responded_at = now()
  WHERE id = _request_id
    AND recipient_id = _user_id
    AND status = 'pending'
  RETURNING * INTO _request;

  IF _request.id IS NULL THEN
    RAISE EXCEPTION 'Pending friend request not found';
  END IF;

  RETURN _request;
END;
$$;

CREATE OR REPLACE FUNCTION public.are_friends(_user_id UUID, _other_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.friends f
    WHERE f.user_id = _user_id
      AND f.friend_user_id = _other_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.accept_friend_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_friend_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.are_friends(UUID, UUID) TO authenticated, anon, service_role;
