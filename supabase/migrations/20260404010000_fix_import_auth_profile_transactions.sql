-- Fix profile schema/query compatibility
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_tier text DEFAULT 'free';

-- Ensure transaction schema supports profile joins by user_id
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS user_id uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'transactions'
      AND column_name = 'owner_user_id'
  ) THEN
    EXECUTE 'UPDATE public.transactions SET user_id = owner_user_id WHERE user_id IS NULL';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transactions_user_id_fkey'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES public.profiles(user_id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);

-- Ensure RLS is enabled
CREATE OR REPLACE FUNCTION public.sync_transactions_user_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.user_id IS NULL AND to_jsonb(NEW) ? 'owner_user_id' THEN
    NEW.user_id := NULLIF(to_jsonb(NEW)->>'owner_user_id', '')::uuid;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_transactions_user_id ON public.transactions;
CREATE TRIGGER trg_sync_transactions_user_id
BEFORE INSERT OR UPDATE ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.sync_transactions_user_id();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Profiles policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'Users can read own profile'
  ) THEN
    CREATE POLICY "Users can read own profile"
      ON public.profiles
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'Users can insert own profile'
  ) THEN
    CREATE POLICY "Users can insert own profile"
      ON public.profiles
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Transaction policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'transactions'
      AND policyname = 'Users can read own transactions'
  ) THEN
    CREATE POLICY "Users can read own transactions"
      ON public.transactions
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'transactions'
      AND policyname = 'Users can insert own transactions'
  ) THEN
    CREATE POLICY "Users can insert own transactions"
      ON public.transactions
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
