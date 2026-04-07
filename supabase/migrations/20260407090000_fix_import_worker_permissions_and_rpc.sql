-- Fix import worker RPC dependencies and storage permissions for import uploads.

-- Ensure imports bucket exists.
insert into storage.buckets (id, name, public)
values ('imports', 'imports', false)
on conflict (id) do nothing;

-- Allow authenticated users to manage objects inside their own imports/<uid>/... prefix.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'imports_objects_select_own'
  ) then
    create policy imports_objects_select_own
      on storage.objects
      for select
      to authenticated
      using (
        bucket_id = 'imports'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'imports_objects_insert_own'
  ) then
    create policy imports_objects_insert_own
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'imports'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'imports_objects_update_own'
  ) then
    create policy imports_objects_update_own
      on storage.objects
      for update
      to authenticated
      using (
        bucket_id = 'imports'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'imports'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'imports_objects_delete_own'
  ) then
    create policy imports_objects_delete_own
      on storage.objects
      for delete
      to authenticated
      using (
        bucket_id = 'imports'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end
$$;

-- Worker claim RPC expected by supabase/functions/import-worker/index.ts.
create or replace function public.claim_import_jobs(_limit integer default 1, _worker text default 'import-worker/scheduled')
returns setof public.import_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select j.id
    from public.import_jobs j
    where (
      j.status = 'queued'
      or (
        j.status = 'failed'
        and (j.retry_at is null or j.retry_at <= now())
        and j.attempt_count < j.max_attempts
      )
    )
    order by j.created_at asc
    limit greatest(coalesce(_limit, 1), 1)
    for update skip locked
  )
  update public.import_jobs j
  set
    status = 'running',
    started_at = coalesce(j.started_at, now()),
    locked_at = now(),
    locked_by = coalesce(nullif(_worker, ''), 'import-worker/scheduled'),
    last_heartbeat_at = now(),
    attempt_count = coalesce(j.attempt_count, 0) + 1,
    error = null
  from candidates c
  where j.id = c.id
  returning j.*;
end;
$$;

revoke execute on function public.claim_import_jobs(integer, text) from public;
grant execute on function public.claim_import_jobs(integer, text) to service_role;

-- Batch apply RPC expected by import worker.
create or replace function public.import_apply_transaction_batch(_job_id uuid, _rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.import_jobs%rowtype;
  v_result jsonb;
  v_inserted integer;
begin
  select * into v_job
  from public.import_jobs
  where id = _job_id;

  if not found then
    raise exception 'Import job % not found', _job_id;
  end if;

  v_result := public.import_transactions_batch(v_job.portfolio_id, coalesce(_rows, '[]'::jsonb));
  v_inserted := coalesce((v_result ->> 'processed')::integer, jsonb_array_length(coalesce(_rows, '[]'::jsonb)));

  return jsonb_build_object(
    'inserted', greatest(v_inserted, 0),
    'skipped', 0
  );
end;
$$;

revoke execute on function public.import_apply_transaction_batch(uuid, jsonb) from public;
grant execute on function public.import_apply_transaction_batch(uuid, jsonb) to service_role;
