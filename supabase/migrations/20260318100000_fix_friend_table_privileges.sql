-- Ensure authenticated users can read and manage friend graph rows via PostgREST + RLS.
GRANT SELECT, INSERT, DELETE ON TABLE public.friends TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.friend_requests TO authenticated;
