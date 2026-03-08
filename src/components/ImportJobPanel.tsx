import { AlertTriangle, CheckCircle2, Clock3, Loader2, XCircle } from "lucide-react";
import { useImportJob } from "@/hooks/useImportJob";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const statusLabel: Record<string, string> = {
  queued: "Queued",
  running: "In progress",
  completed: "Success",
  failed: "Failed",
  canceled: "Canceled",
};

function StatusIcon({ status }: { status?: string }) {
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin" />;
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-destructive" />;
  if (status === "canceled") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  return <Clock3 className="h-4 w-4 text-muted-foreground" />;
}

export function ImportJobPanel({ jobId }: { jobId: string | null | undefined }) {
  const { job, loading, error, refetch } = useImportJob(jobId, { enabled: !!jobId, pollMs: 2500 });

  if (!jobId) return null;

  const processed = Number(job?.progress?.processed || 0);
  const total = Number(job?.progress?.total || 0);
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const inserted = Number(job?.progress?.inserted || 0);
  const skipped = Number(job?.progress?.skipped || 0);

  const cancelJob = async () => {
    if (!job) return;
    const { error: updateError } = await supabase.from("import_jobs").update({ status: "canceled" }).eq("id", job.id);
    if (updateError) return toast.error(`Could not cancel job: ${updateError.message}`);
    toast.success("Import job canceled.");
    refetch();
  };

  const retryJob = async () => {
    if (!job) return;
    const { error: updateError } = await supabase.from("import_jobs").update({ status: "queued", error: null, retry_count: 0 }).eq("id", job.id);
    if (updateError) return toast.error(`Could not retry job: ${updateError.message}`);
    toast.success("Import job re-queued.");
    refetch();
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <StatusIcon status={job?.status} />
          Import job
          <span className="text-muted-foreground">{job ? statusLabel[job.status] || job.status : loading ? "Loading" : "Unknown"}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error && <p className="text-destructive">Could not fetch import status: {error}</p>}
        {!job && !error && <p className="text-muted-foreground">Loading status…</p>}
        {job && (
          <>
            <Progress value={pct} />
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span>Processed: {processed}</span>
              <span>Total: {total || "—"}</span>
              <span>Inserted: {inserted}</span>
              <span>Skipped: {skipped}</span>
            </div>
            <div className="flex gap-2">
              {(job.status === "queued" || job.status === "running") && <Button size="sm" variant="outline" onClick={cancelJob}>Cancel import</Button>}
              {(job.status === "failed" || job.status === "canceled") && <Button size="sm" variant="secondary" onClick={retryJob}>Retry</Button>}
            </div>
            {job.error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
                <p className="font-medium text-destructive">{job.error.message || "Import failed"}</p>
                <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                  {job.error.type && <li>Type: {job.error.type}</li>}
                  {typeof job.error.retriable === "boolean" && <li>Retriable: {String(job.error.retriable)}</li>}
                  {job.error.details && <li>Details: {JSON.stringify(job.error.details)}</li>}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
