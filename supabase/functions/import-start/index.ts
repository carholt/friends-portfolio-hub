import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ImportStartBody = {
  portfolio_id: string;
  import_kind?: "transactions" | "holdings";
  file_name?: string;
  file_type?: "csv" | "json";
  mapping?: Record<string, unknown>;
  options?: Record<string, unknown>;
  idempotency_key?: string;
  request_upload?: boolean;
  storage_bucket?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });

    const { data: authData } = await userClient.auth.getUser();
    if (!authData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as Partial<ImportStartBody>;
    if (!body.portfolio_id) {
      return new Response(JSON.stringify({ error: "portfolio_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const idempotencyKey = body.idempotency_key?.trim() || null;
    if (idempotencyKey) {
      const { data: existingJob, error: existingError } = await userClient
        .from("import_jobs")
        .select("*")
        .eq("owner_user_id", authData.user.id)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (existingError) throw existingError;
      if (existingJob) {
        return new Response(JSON.stringify({ job: existingJob, upload: null, deduped: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const storageBucket = body.storage_bucket || "imports";
    const normalizedKind = body.import_kind === "holdings" ? "holdings" : "transactions";
    const normalizedType = body.file_type === "json" ? "json" : "csv";

    const { data: job, error: createError } = await userClient
      .from("import_jobs")
      .insert({
        owner_user_id: authData.user.id,
        portfolio_id: body.portfolio_id,
        import_kind: normalizedKind,
        file_name: body.file_name || null,
        file_type: normalizedType,
        mapping: body.mapping || {},
        options: body.options || {},
        idempotency_key: idempotencyKey,
        status: "queued",
        progress: {
          cursor: 0,
          processed: 0,
          inserted: 0,
          skipped: 0,
          total: null,
        },
      })
      .select("*")
      .single();

    if (createError) throw createError;

    let upload: Record<string, unknown> | null = null;
    if (body.request_upload) {
      const ext = normalizedType === "json" ? "json" : "csv";
      const storagePath = `${authData.user.id}/${job.id}.${ext}`;

      const { data: signedUpload, error: uploadError } = await userClient.storage
        .from(storageBucket)
        .createSignedUploadUrl(storagePath);

      if (uploadError) throw uploadError;

      const { error: patchError } = await userClient
        .from("import_jobs")
        .update({ storage_bucket: storageBucket, storage_path: storagePath })
        .eq("id", job.id)
        .eq("owner_user_id", authData.user.id);

      if (patchError) throw patchError;

      upload = {
        bucket: storageBucket,
        path: storagePath,
        token: signedUpload.token,
        signedUrl: signedUpload.signedUrl,
      };
      job.storage_bucket = storageBucket;
      job.storage_path = storagePath;
    }

    return new Response(JSON.stringify({ job, upload, deduped: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
