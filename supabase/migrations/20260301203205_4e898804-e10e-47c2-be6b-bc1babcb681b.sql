
-- Enum types
CREATE TYPE public.portfolio_visibility AS ENUM ('private', 'authenticated', 'public', 'group');
CREATE TYPE public.asset_type AS ENUM ('stock', 'etf', 'fund', 'metal', 'other');
CREATE TYPE public.invite_status AS ENUM ('pending', 'accepted', 'declined');
CREATE TYPE public.group_role AS ENUM ('owner', 'member');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  display_name TEXT,
  default_currency TEXT NOT NULL DEFAULT 'SEK',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view profiles" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Groups
CREATE TABLE public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

-- Group members
CREATE TABLE public.group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role group_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, user_id)
);
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

-- Group invites
CREATE TABLE public.group_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  invited_email TEXT,
  invited_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_by_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  token UUID NOT NULL DEFAULT gen_random_uuid(),
  status invite_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ
);
ALTER TABLE public.group_invites ENABLE ROW LEVEL SECURITY;

-- Assets
CREATE TABLE public.assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  asset_type asset_type NOT NULL DEFAULT 'stock',
  exchange TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  metadata_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Assets readable by all" ON public.assets FOR SELECT USING (true);
CREATE POLICY "Authenticated can insert assets" ON public.assets FOR INSERT TO authenticated WITH CHECK (true);

-- Prices
CREATE TABLE public.prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID REFERENCES public.assets(id) ON DELETE CASCADE NOT NULL,
  price NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  as_of_date DATE NOT NULL DEFAULT CURRENT_DATE,
  source TEXT DEFAULT 'twelve_data',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(asset_id, as_of_date)
);
ALTER TABLE public.prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Prices readable by all" ON public.prices FOR SELECT USING (true);

-- Portfolios
CREATE TABLE public.portfolios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  visibility portfolio_visibility NOT NULL DEFAULT 'private',
  group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL,
  public_slug TEXT UNIQUE,
  base_currency TEXT NOT NULL DEFAULT 'SEK',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;

-- Holdings
CREATE TABLE public.holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE CASCADE NOT NULL,
  asset_id UUID REFERENCES public.assets(id) ON DELETE CASCADE NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  avg_cost NUMERIC NOT NULL DEFAULT 0,
  cost_currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.holdings ENABLE ROW LEVEL SECURITY;

-- Portfolio valuations
CREATE TABLE public.portfolio_valuations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE CASCADE NOT NULL,
  total_value NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'SEK',
  as_of_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(portfolio_id, as_of_date)
);
ALTER TABLE public.portfolio_valuations ENABLE ROW LEVEL SECURITY;

-- Audit log
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own audit log" ON public.audit_log FOR SELECT USING (auth.uid() = user_id);

-- Helper functions (security definer to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_group_member(_user_id UUID, _group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE user_id = _user_id AND group_id = _group_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_group_owner(_user_id UUID, _group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.groups
    WHERE id = _group_id AND owner_user_id = _user_id
  );
$$;

-- RLS for groups
CREATE POLICY "Groups readable by members and authenticated" ON public.groups
  FOR SELECT USING (
    owner_user_id = auth.uid()
    OR public.is_group_member(auth.uid(), id)
  );
CREATE POLICY "Owner can create groups" ON public.groups
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "Owner can update groups" ON public.groups
  FOR UPDATE USING (auth.uid() = owner_user_id);
CREATE POLICY "Owner can delete groups" ON public.groups
  FOR DELETE USING (auth.uid() = owner_user_id);

-- Auto-add owner as member
CREATE OR REPLACE FUNCTION public.handle_new_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (NEW.id, NEW.owner_user_id, 'owner');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_group_created
  AFTER INSERT ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_group();

-- RLS for group_members
CREATE POLICY "Members can view group members" ON public.group_members
  FOR SELECT USING (public.is_group_member(auth.uid(), group_id));
CREATE POLICY "Owner can insert members" ON public.group_members
  FOR INSERT TO authenticated WITH CHECK (public.is_group_owner(auth.uid(), group_id));
CREATE POLICY "Owner can delete members" ON public.group_members
  FOR DELETE USING (public.is_group_owner(auth.uid(), group_id) OR user_id = auth.uid());

-- RLS for group_invites
CREATE POLICY "View own invites or group invites" ON public.group_invites
  FOR SELECT USING (
    invited_user_id = auth.uid()
    OR invited_by_user_id = auth.uid()
    OR public.is_group_member(auth.uid(), group_id)
  );
CREATE POLICY "Group owner can create invites" ON public.group_invites
  FOR INSERT TO authenticated WITH CHECK (public.is_group_owner(auth.uid(), group_id));
CREATE POLICY "Invited user can update invite" ON public.group_invites
  FOR UPDATE USING (invited_user_id = auth.uid() AND status = 'pending');

-- RLS for portfolios
CREATE POLICY "View portfolios based on visibility" ON public.portfolios
  FOR SELECT USING (
    owner_user_id = auth.uid()
    OR visibility = 'public'
    OR (visibility = 'authenticated' AND auth.uid() IS NOT NULL)
    OR (visibility = 'group' AND group_id IS NOT NULL AND public.is_group_member(auth.uid(), group_id))
  );
CREATE POLICY "Owner can insert portfolios" ON public.portfolios
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "Owner can update portfolios" ON public.portfolios
  FOR UPDATE USING (auth.uid() = owner_user_id);
CREATE POLICY "Owner can delete portfolios" ON public.portfolios
  FOR DELETE USING (auth.uid() = owner_user_id);

-- RLS for holdings (via portfolio ownership/visibility)
CREATE OR REPLACE FUNCTION public.can_view_portfolio(_portfolio_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.portfolios p
    WHERE p.id = _portfolio_id
    AND (
      p.owner_user_id = auth.uid()
      OR p.visibility = 'public'
      OR (p.visibility = 'authenticated' AND auth.uid() IS NOT NULL)
      OR (p.visibility = 'group' AND p.group_id IS NOT NULL AND public.is_group_member(auth.uid(), p.group_id))
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.owns_portfolio(_portfolio_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.portfolios WHERE id = _portfolio_id AND owner_user_id = auth.uid()
  );
$$;

CREATE POLICY "View holdings via portfolio visibility" ON public.holdings
  FOR SELECT USING (public.can_view_portfolio(portfolio_id));
CREATE POLICY "Owner can insert holdings" ON public.holdings
  FOR INSERT TO authenticated WITH CHECK (public.owns_portfolio(portfolio_id));
CREATE POLICY "Owner can update holdings" ON public.holdings
  FOR UPDATE USING (public.owns_portfolio(portfolio_id));
CREATE POLICY "Owner can delete holdings" ON public.holdings
  FOR DELETE USING (public.owns_portfolio(portfolio_id));

-- RLS for portfolio_valuations
CREATE POLICY "View valuations via portfolio" ON public.portfolio_valuations
  FOR SELECT USING (public.can_view_portfolio(portfolio_id));

-- Prices insert policy for edge functions (service role)
-- Prices are inserted by edge functions using service role key, so no RLS INSERT needed for users

-- Indexes
CREATE INDEX idx_holdings_portfolio ON public.holdings(portfolio_id);
CREATE INDEX idx_holdings_asset ON public.holdings(asset_id);
CREATE INDEX idx_prices_asset_date ON public.prices(asset_id, as_of_date DESC);
CREATE INDEX idx_portfolios_owner ON public.portfolios(owner_user_id);
CREATE INDEX idx_portfolios_visibility ON public.portfolios(visibility);
CREATE INDEX idx_portfolios_slug ON public.portfolios(public_slug);
CREATE INDEX idx_group_members_user ON public.group_members(user_id);
CREATE INDEX idx_group_members_group ON public.group_members(group_id);
CREATE INDEX idx_valuations_portfolio_date ON public.portfolio_valuations(portfolio_id, as_of_date DESC);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_portfolios_updated_at BEFORE UPDATE ON public.portfolios FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_holdings_updated_at BEFORE UPDATE ON public.holdings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
