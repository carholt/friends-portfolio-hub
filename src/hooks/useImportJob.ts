import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ImportJobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export interface ImportJobRecord {
  id: string;
  status: ImportJobStatus;
  progress: {
    cursor?: number;
    processed?: number;
    inserted?: number;
    skipped?: number;
    total?: number | null;
  } | null;
  error: {
    message?: string;
    type?: string;
    retriable?: boolean;
    details?: Record<string, unknown>;
  } | null;
  updated_at: string;
}

interface UseImportJobOptions {
  enabled?: boolean;
  pollMs?: number;
}

export function useImportJob(jobId: string | null | undefined, options: UseImportJobOptions = {}) {
  const { enabled = true, pollMs = 3000 } = options;
  const [job, setJob] = useState<ImportJobRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!jobId || !enabled) return;
    setLoading(true);
    const { data, error: queryError } = await supabase
      .from("import_jobs")
      .select("id,status,progress,error,updated_at")
      .eq("id", jobId)
      .maybeSingle();

    if (queryError) {
      setError(queryError.message);
    } else {
      setJob((data as ImportJobRecord | null) ?? null);
      setError(null);
    }
    setLoading(false);
  }, [enabled, jobId]);

  useEffect(() => {
    if (!jobId || !enabled) return;
    refetch();
    const timer = window.setInterval(refetch, pollMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [enabled, jobId, pollMs, refetch]);

  const isTerminal = useMemo(() => (job ? ["completed", "failed", "canceled"].includes(job.status) : false), [job]);

  return {
    job,
    loading,
    error,
    isTerminal,
    refetch,
  };
}
