export const ALREADY_PROCESSING_STATUS = "already_processing_or_completed" as const;

export type ClaimReportParams = {
  adminClient: {
    from: (table: string) => {
      update: (payload: Record<string, unknown>) => {
        eq: (column: string, value: unknown) => any;
      };
    };
  };
  reportId: string;
  workerId: string;
  nowIso: string;
};

export async function tryClaimQueuedReport({ adminClient, reportId, workerId, nowIso }: ClaimReportParams): Promise<boolean> {
  const { data, error } = await adminClient
    .from("company_ai_reports")
    .update({
      status: "running",
      error: null,
      started_at: nowIso,
      worker_id: workerId,
      retry_count: 0,
    })
    .eq("id", reportId)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}
