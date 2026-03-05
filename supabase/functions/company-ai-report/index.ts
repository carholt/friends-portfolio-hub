import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const reportSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "ticker", "name", "bucket", "type", "properties_ownership", "management_team", "share_structure", "location",
    "projected_growth", "market_buzz", "cost_structure_financing", "cash_debt_position", "low_valuation_estimate",
    "high_valuation_estimate", "projected_price", "investment_recommendation", "rating", "rationale", "key_risks",
    "key_catalysts", "last_updated", "sources",
  ],
  properties: {
    ticker: { type: "string" },
    name: { type: "string" },
    bucket: { type: "string" },
    type: { type: "string" },
    properties_ownership: { type: "string" },
    management_team: { type: "string" },
    share_structure: { type: "string" },
    location: { type: "string" },
    projected_growth: { type: "string" },
    market_buzz: { type: "string" },
    cost_structure_financing: { type: "string" },
    cash_debt_position: { type: "string" },
    low_valuation_estimate: { type: ["number", "null"] },
    high_valuation_estimate: { type: ["number", "null"] },
    projected_price: { type: ["number", "null"] },
    investment_recommendation: { type: "string" },
    rating: { type: "string" },
    rationale: { type: "string" },
    key_risks: { type: "array", items: { type: "string" } },
    key_catalysts: { type: "array", items: { type: "string" } },
    last_updated: { type: "string" },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url", "snippet"],
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          snippet: { type: "string" },
        },
      },
    },
  },
} as const;

async function fetchWithRetry(url: string, init: RequestInit, attempts = 2, timeoutMs = 35000) {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`OpenAI error ${response.status}: ${await response.text()}`);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (i === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unknown request failure");
}

function extractText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.length > 0) return payload.output_text;
  const parts = payload?.output?.flatMap((item: any) => item?.content ?? []) ?? [];
  const textPart = parts.find((part: any) => part?.type === "output_text" && typeof part?.text === "string");
  return textPart?.text ?? "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  const model = Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini";

  if (!openAiKey) {
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: authData } = await userClient.auth.getUser();
    if (!authData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { report_id } = await req.json();
    if (!report_id) {
      return new Response(JSON.stringify({ error: "report_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: reportRow, error: loadError } = await adminClient
      .from("company_ai_reports")
      .select("id,asset_id,portfolio_id,created_by,status,assumptions,model")
      .eq("id", report_id)
      .maybeSingle();

    if (loadError || !reportRow) throw new Error(loadError?.message || "Report request not found");
    if (reportRow.created_by && reportRow.created_by !== authData.user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: asset } = await adminClient
      .from("assets")
      .select("id,symbol,name,exchange")
      .eq("id", reportRow.asset_id)
      .maybeSingle();
    const { data: company } = await adminClient
      .from("companies")
      .select("id,name,lifecycle_stage,tier,jurisdiction,website,notes")
      .eq("asset_id", reportRow.asset_id)
      .maybeSingle();

    const { data: metrics } = company
      ? await adminClient
          .from("company_metrics")
          .select("metric_key,value_number,unit,as_of_date,source_url,source_title")
          .eq("company_id", company.id)
          .order("as_of_date", { ascending: false })
          .limit(40)
      : { data: [] as any[] };

    const { data: previous } = await adminClient
      .from("company_ai_reports")
      .select("report,created_at")
      .eq("asset_id", reportRow.asset_id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    await adminClient.from("company_ai_reports").update({ status: "running", error: null }).eq("id", report_id);

    const assumptions = (reportRow.assumptions || {}) as Record<string, unknown>;
    const useWebSearch = assumptions.mode !== "quick";

    const prompt = [
      "Create a structured company research report.",
      "Rules:",
      "- If data is missing, set numeric fields to null and use 'Unknown' or 'Not disclosed' for strings.",
      "- Never invent numbers without evidence.",
      "- Include source citations in sources[].",
      "- Rationale must include the sentence: Not financial advice.",
      `Asset context: ${JSON.stringify(asset || {})}`,
      `Company context: ${JSON.stringify(company || {})}`,
      `Metrics context: ${JSON.stringify(metrics || [])}`,
      `Assumptions: ${JSON.stringify(assumptions)}`,
      useWebSearch ? "Use web search for citations where needed." : "Do not use web search. Rely only on provided context and prior report.",
      previous?.report ? `Previous report (for continuity): ${JSON.stringify(previous.report)}` : "",
    ].filter(Boolean).join("\n");

    const openAiResponse = await fetchWithRetry("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model: reportRow.model || model,
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
        tools: useWebSearch ? [{ type: "web_search_preview", search_context_size: "low" }] : [],
        tool_choice: useWebSearch ? "auto" : "none",
        text: {
          format: {
            type: "json_schema",
            name: "company_ai_report",
            schema: reportSchema,
            strict: true,
          },
        },
      }),
    });

    const openAiPayload = await openAiResponse.json();
    const outputText = extractText(openAiPayload);
    if (!outputText) throw new Error("Model returned empty output");

    const parsed = JSON.parse(outputText);
    const sources = Array.isArray(parsed?.sources) ? parsed.sources : [];

    await adminClient
      .from("company_ai_reports")
      .update({
        status: "completed",
        report: parsed,
        sources,
        completed_at: new Date().toISOString(),
        tokens_in: openAiPayload?.usage?.input_tokens ?? null,
        tokens_out: openAiPayload?.usage?.output_tokens ?? null,
        error: null,
      })
      .eq("id", report_id);

    return new Response(JSON.stringify({ ok: true, report_id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const body = await req.clone().json().catch(() => ({}));
    const reportId = body?.report_id;
    if (reportId) {
      await adminClient
        .from("company_ai_reports")
        .update({ status: "failed", error: error instanceof Error ? error.message : "Unknown error" })
        .eq("id", reportId);
    }

    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
