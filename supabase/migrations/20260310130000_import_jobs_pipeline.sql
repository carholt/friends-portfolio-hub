-- Import jobs queue + worker RPCs for resumable, idempotent batch imports.

CREATE TABLE IF NOT EXISTS public.import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE CASCADE,
  idempotency_key TEXT,
  file_name TEXT,
  file_type TEXT NOT NULL DEFAULT 'csv',
  import_kind TEXT NOT NULL DEFAULT 'transactions',
  storage_bucket TEXT,
  storage_path TEXT,
  mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'canceled')),
  progress JSONB NOT NULL DEFAULT jsonb_build_object('cursor', 0, 'processed', 0, 'inserted', 0, 'skipped', 0, 'total', NULL),
  error JSONB,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  retry_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT import_jobs_owner_idempotency_unique UNIQUE (owner_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_owner_created_at ON public.import_jobs(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_jobs_status_retry_at ON public.import_jobs(status, retry_at, created_at);
CREATE INDEX IF NOT EXISTS idx_import_jobs_portfolio_created_at ON public.import_jobs(portfolio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_jobs_storage_path ON public.import_jobs(storage_bucket, storage_path) WHERE storage_bucket IS NOT NULL AND storage_path IS NOT NULL;

ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "import_jobs_read_own" ON public.import_jobs;
CREATE POLICY "import_jobs_read_own"
ON public.import_jobs
FOR SELECT TO authenticated
USING (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "import_jobs_insert_own" ON public.import_jobs;
CREATE POLICY "import_jobs_insert_own"
ON public.import_jobs
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = owner_user_id
  AND status IN ('queued', 'canceled')
);

DROP POLICY IF EXISTS "import_jobs_update_own" ON public.import_jobs;
CREATE POLICY "import_jobs_update_own"
ON public.import_jobs
FOR UPDATE TO authenticated
USING (auth.uid() = owner_user_id)
WITH CHECK (
  auth.uid() = owner_user_id
  AND (
    status IN ('queued', 'canceled')
    OR (status = 'failed' AND retry_at IS NOT NULL)
    OR (status = 'completed')
  )
);

DROP POLICY IF EXISTS "import_jobs_delete_own" ON public.import_jobs;
CREATE POLICY "import_jobs_delete_own"
ON public.import_jobs
FOR DELETE TO authenticated
USING (auth.uid() = owner_user_id);

DROP TRIGGER IF EXISTS import_jobs_set_updated_at ON public.import_jobs;
CREATE TRIGGER import_jobs_set_updated_at
  BEFORE UPDATE ON public.import_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

CREATE OR REPLACE FUNCTION public.claim_import_jobs(_limit INTEGER DEFAULT 1, _worker TEXT DEFAULT 'import-worker')
RETURNS SETOF public.import_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT j.id
    FROM public.import_jobs j
    WHERE (
      j.status = 'queued'
      OR (j.status = 'failed' AND j.attempt_count < j.max_attempts AND COALESCE(j.retry_at, now()) <= now())
      OR (j.status = 'running' AND j.locked_at < now() - interval '10 minutes')
    )
    ORDER BY j.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(COALESCE(_limit, 1), 1)
  )
  UPDATE public.import_jobs j
    SET status = 'running',
        started_at = COALESCE(j.started_at, now()),
        locked_at = now(),
        locked_by = COALESCE(_worker, 'import-worker'),
        last_heartbeat_at = now(),
        attempt_count = CASE WHEN j.status IN ('queued', 'failed') THEN j.attempt_count + 1 ELSE j.attempt_count END,
        error = NULL
  WHERE j.id IN (SELECT id FROM picked)
  RETURNING j.*;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_import_jobs(INTEGER, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.import_apply_transaction_batch(_job_id UUID, _rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.import_jobs%ROWTYPE;
  v_row JSONB;
  v_inserted INTEGER := 0;
  v_skipped INTEGER := 0;
  v_inserted_id UUID;
BEGIN
  SELECT * INTO v_job FROM public.import_jobs WHERE id = _job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import job not found: %', _job_id;
  END IF;

  IF v_job.status = 'canceled' THEN
    RETURN jsonb_build_object('inserted', 0, 'skipped', COALESCE(jsonb_array_length(_rows), 0), 'canceled', true);
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(_rows, '[]'::jsonb))
  LOOP
    INSERT INTO public.transactions (
      portfolio_id,
      owner_user_id,
      broker,
      trade_id,
      trade_type,
      symbol_raw,
      isin,
      exchange_raw,
      traded_at,
      quantity,
      price,
      currency,
      fx_rate,
      fees,
      raw_row
    ) VALUES (
      v_job.portfolio_id,
      v_job.owner_user_id,
      NULLIF(v_row->>'broker', ''),
      NULLIF(v_row->>'trade_id', ''),
      COALESCE(NULLIF(v_row->>'trade_type', ''), 'unknown'),
      NULLIF(v_row->>'symbol_raw', ''),
      NULLIF(v_row->>'isin', ''),
      NULLIF(v_row->>'exchange_raw', ''),
      NULLIF(v_row->>'traded_at', '')::date,
      COALESCE((v_row->>'quantity')::numeric, 0),
      NULLIF(v_row->>'price', '')::numeric,
      NULLIF(v_row->>'currency', ''),
      NULLIF(v_row->>'fx_rate', '')::numeric,
      NULLIF(v_row->>'fees', '')::numeric,
      COALESCE(v_row->'raw_row', '{}'::jsonb)
    )
    ON CONFLICT (portfolio_id, broker, trade_id) WHERE trade_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_inserted_id;

    IF v_inserted_id IS NULL THEN
      v_skipped := v_skipped + 1;
    ELSE
      v_inserted := v_inserted + 1;
      v_inserted_id := NULL;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'canceled', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_apply_transaction_batch(UUID, JSONB) TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_jobs TO authenticated;
GRANT ALL PRIVILEGES ON public.import_jobs TO service_role;
