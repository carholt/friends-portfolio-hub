import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { resolveImportSymbol } from "./resolve-import-symbol.ts";

type ImportJob = {
  id: string;
  owner_user_id: string;
  portfolio_id: string;
  import_kind: string;
  file_type: string;
  storage_bucket: string | null;
  storage_path: string | null;
  mapping: Record<string, unknown>;
  options: Record<string, unknown>;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  attempt_count: number;
  max_attempts: number;
  progress: Record<string, unknown> | null;
};

type WorkerBody = {
  job_id?: string;
  limit?: number;
  chunk_size?: number;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const clean = (value: unknown) => String(value ?? "").trim();

const splitLine = (line: string, delimiter: string): string[] => {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === delimiter && !quoted) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
};

const detectDelimiter = (text: string): ";" | "," | "\t" => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 8);
  const candidates: Array<";" | "," | "\t"> = [";", ",", "\t"];
  const score = (delimiter: ";" | "," | "\t") => lines.reduce((acc, line) => acc + (line.split(delimiter).length - 1), 0);
  return candidates.sort((a, b) => score(b) - score(a))[0] ?? ",";
};

const parseCsvRows = (content: string): Record<string, string>[] => {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const delimiter = detectDelimiter(content);
  const headers = splitLine(lines[0], delimiter).map((header) => clean(header));
  return lines.slice(1).map((line) => {
    const cols = splitLine(line, delimiter);
    return headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = clean(cols[index]);
      return acc;
    }, {});
  });
};

const parseDate = (value: unknown) => {
  const raw = clean(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const svMatch = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (svMatch) {
    const y = svMatch[3].length === 2 ? `20${svMatch[3]}` : svMatch[3];
    return `${y}-${svMatch[2].padStart(2, "0")}-${svMatch[1].padStart(2, "0")}`;
  }
  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString().slice(0, 10);
};

const parseNumber = (raw: unknown, decimal: "," | ".") => {
  const value = clean(raw);
  if (!value) return null;
  const normalized = decimal === "," ? value.replace(/\./g, "").replace(/,/g, ".") : value.replace(/,/g, "");
  const parsed = Number(normalized.replace(/\s/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const mapType = (value: string) => {
  const lower = value.toLowerCase();
  if (["köp", "buy"].includes(lower)) return "buy";
  if (["sälj", "sell"].includes(lower)) return "sell";
  if (["utdelning", "dividend"].includes(lower)) return "dividend";
  if (["courtage", "avgift", "fee"].includes(lower)) return "fee";
  if (["valutaväxling", "fx"].includes(lower)) return "fx";
  return "unknown";
};

function mapRowToTransaction(row: Record<string, string>, mapping: Record<string, unknown>) {
  const columns = (mapping.columns as Record<string, string | undefined>) || {};
  const decimal = (mapping.decimal as "," | ".") || ".";
  const tradeId = clean(row[columns.trade_id || ""]);
  const typeRaw = clean(row[columns.trade_type || ""]);

  return {
    broker: clean((mapping.broker_key as string | undefined) || "unknown") || "unknown",
    trade_id: tradeId || null,
    trade_type: mapType(typeRaw),
    symbol_raw: clean(row[columns.symbol || ""]).toUpperCase() || null,
    isin: clean(row[columns.isin || ""]) || null,
    exchange_raw: clean(row[columns.exchange || ""]) || null,
    traded_at: parseDate(row[columns.date || ""]),
    quantity: parseNumber(row[columns.quantity || ""], decimal) ?? 0,
    price: parseNumber(row[columns.price || ""], decimal),
    currency: clean(row[columns.currency || ""]).toUpperCase() || null,
    fx_rate: null,
    fees: parseNumber(row[columns.fees || ""], decimal),
    raw_row: row,
  };
}

async function processJob(adminClient: ReturnType<typeof createClient>, job: ImportJob, chunkSize: number) {
  if (!job.storage_bucket || !job.storage_path) {
    throw new Error("Job has no storage payload. Expected storage_bucket and storage_path.");
  }

  const { data: objectBlob, error: downloadError } = await adminClient.storage
    .from(job.storage_bucket)
    .download(job.storage_path);

  if (downloadError) throw downloadError;

  const text = await objectBlob.text();
  const rows = job.file_type === "json" ? JSON.parse(text) : parseCsvRows(text);
  const total = Array.isArray(rows) ? rows.length : 0;
  const progress = job.progress || {};
  let cursor = Number(progress.cursor || 0);
  let processed = Number(progress.processed || 0);
  let inserted = Number(progress.inserted || 0);
  let skipped = Number(progress.skipped || 0);

  if (!Array.isArray(rows)) throw new Error("Imported file must resolve to an array of rows");
  if (cursor >= total) {
    const { error: completeError } = await adminClient
      .from("import_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        progress: { ...progress, total, cursor: total, processed, inserted, skipped },
      })
      .eq("id", job.id)
      .eq("status", "running");
    if (completeError) throw completeError;
    return { status: "completed", processed, inserted, skipped, total };
  }

  while (cursor < total) {
    const { data: latestJob, error: latestJobError } = await adminClient
      .from("import_jobs")
      .select("status")
      .eq("id", job.id)
      .single();
    if (latestJobError) throw latestJobError;
    if (latestJob.status === "canceled") {
      return { status: "canceled", processed, inserted, skipped, total };
    }

    const chunkRows = rows.slice(cursor, cursor + chunkSize);
    const mapped = await Promise.all(
      chunkRows.map(async (row) => {
        const transaction = mapRowToTransaction(row as Record<string, string>, job.mapping || {});
        const instrumentId = await resolveImportSymbol(adminClient, {
          symbol: transaction.symbol_raw,
          broker: transaction.broker,
          exchange: transaction.exchange_raw,
          isin: transaction.isin,
          name: clean((row as Record<string, string>).name || (row as Record<string, string>).instrument || ""),
        });

        return {
          ...transaction,
          raw_row: {
            ...(transaction.raw_row as Record<string, unknown>),
            resolved_instrument_id: instrumentId,
          },
        };
      }),
    );

    const { data: rpcResult, error: rpcError } = await adminClient.rpc("import_apply_transaction_batch", {
      _job_id: job.id,
      _rows: mapped,
    });
    if (rpcError) throw rpcError;

    const deltaInserted = Number(rpcResult?.inserted || 0);
    const deltaSkipped = Number(rpcResult?.skipped || 0);
    const deltaProcessed = chunkRows.length;

    cursor += deltaProcessed;
    processed += deltaProcessed;
    inserted += deltaInserted;
    skipped += deltaSkipped;

    const { error: heartbeatError } = await adminClient
      .from("import_jobs")
      .update({
        progress: { cursor, processed, inserted, skipped, total },
        last_heartbeat_at: new Date().toISOString(),
        locked_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("status", "running");

    if (heartbeatError) throw heartbeatError;
  }

  const { error: finishError } = await adminClient
    .from("import_jobs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      progress: { cursor, processed, inserted, skipped, total },
    })
    .eq("id", job.id)
    .eq("status", "running");
  if (finishError) throw finishError;

  return { status: "completed", processed, inserted, skipped, total };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const body = (await req.json().catch(() => ({}))) as WorkerBody;
    const limit = Math.min(Math.max(body.limit || 1, 1), 20);
    const chunkSize = Math.min(Math.max(body.chunk_size || 200, 20), 2000);

    let jobs: ImportJob[] = [];
    if (body.job_id) {
      const { data: selectedJob, error: selectedError } = await adminClient
        .from("import_jobs")
        .select("*")
        .eq("id", body.job_id)
        .single();
      if (selectedError) throw selectedError;

      if (!["queued", "running", "failed"].includes(selectedJob.status)) {
        return new Response(JSON.stringify({ processed_jobs: 0, skipped: [{ id: selectedJob.id, reason: `status=${selectedJob.status}` }] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (selectedJob.status !== "running") {
        const { data: claimedJob, error: claimError } = await adminClient
          .from("import_jobs")
          .update({
            status: "running",
            started_at: selectedJob.started_at || new Date().toISOString(),
            locked_at: new Date().toISOString(),
            locked_by: "import-worker/manual",
            last_heartbeat_at: new Date().toISOString(),
            attempt_count: Number(selectedJob.attempt_count || 0) + 1,
            error: null,
          })
          .eq("id", body.job_id)
          .in("status", ["queued", "failed"])
          .select("*")
          .maybeSingle();

        if (claimError) throw claimError;
        if (claimedJob) {
          jobs = [claimedJob as ImportJob];
        }
      }

      if (!jobs.length) {
        const { data: runningJob, error: runningError } = await adminClient
          .from("import_jobs")
          .select("*")
          .eq("id", body.job_id)
          .eq("status", "running")
          .maybeSingle();
        if (runningError) throw runningError;
        if (runningJob) jobs = [runningJob as ImportJob];
      }
    } else {
      const { data: claimRows, error: claimError } = await adminClient.rpc("claim_import_jobs", {
        _limit: limit,
        _worker: "import-worker/scheduled",
      });
      if (claimError) throw claimError;
      jobs = (claimRows || []) as ImportJob[];
    }

    const results: Array<Record<string, unknown>> = [];

    for (const job of jobs) {
      try {
        const summary = await processJob(adminClient, job, chunkSize);
        results.push({ job_id: job.id, ...summary });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        const shouldRetry = job.attempt_count < job.max_attempts;
        await adminClient
          .from("import_jobs")
          .update({
            status: "failed",
            failed_at: new Date().toISOString(),
            retry_at: shouldRetry ? new Date(Date.now() + 30_000).toISOString() : null,
            locked_at: null,
            locked_by: null,
            error: {
              message,
              type: "worker_error",
              retriable: shouldRetry,
              at: new Date().toISOString(),
            },
          })
          .eq("id", job.id);

        results.push({ job_id: job.id, status: "failed", error: message, retriable: shouldRetry });
      }
    }

    return new Response(JSON.stringify({ processed_jobs: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
