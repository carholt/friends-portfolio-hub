import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

type MappingRow = {
  isin: string;
  ticker: string | null;
  name: string | null;
  exchange: string | null;
  currency: string | null;
  source: string | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mapSupabaseErrorStatus(error: { code?: string; message?: string }) {
  if (error.code === "42501" || /permission denied/i.test(error.message ?? "")) return 403;
  return 500;
}

function normalizeTicker(ticker: string | null, exchange: string | null) {
  if (!ticker) return null;

  const cleanTicker = ticker.trim().toUpperCase();
  const cleanExchange = (exchange ?? "").trim().toUpperCase();

  if (cleanExchange === "TSX" && !cleanTicker.endsWith(".TO")) return `${cleanTicker}.TO`;
  if ((cleanExchange === "TSXV" || cleanExchange === "TSXVENTURE") && !cleanTicker.endsWith(".V")) {
    return `${cleanTicker}.V`;
  }

  return cleanTicker;
}

async function fetchOpenFigiMapping(isin: string, openFigiApiKey?: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("OpenFIGI timeout"), 5000);

  try {
    const response = await fetch("https://api.openfigi.com/v3/mapping", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(openFigiApiKey ? { "X-OPENFIGI-APIKEY": openFigiApiKey } : {}),
      },
      body: JSON.stringify([{ idType: "ID_ISIN", idValue: isin }]),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        error: {
          status: response.status,
          message: `OpenFIGI request failed with status ${response.status}`,
          details: await response.text(),
        },
      };
    }

    const payload = await response.json();
    const first = Array.isArray(payload) ? payload[0] : null;

    if (!first || !Array.isArray(first.data) || first.data.length === 0) {
      return { error: { status: 404, message: "No instrument mapping found for provided ISIN" } };
    }

    const figiData = first.data[0];
    const exchange = figiData.exchCode ?? null;
    const ticker = normalizeTicker(figiData.ticker ?? null, exchange);

    const mapping: MappingRow = {
      isin,
      ticker,
      name: figiData.name ?? null,
      exchange,
      currency: figiData.currency ?? null,
      source: "openfigi",
    };

    return { data: mapping };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { error: { status: 504, message: "OpenFIGI request timed out after 5 seconds" } };
    }

    return {
      error: {
        status: 502,
        message: "Failed to call OpenFIGI",
        details: error instanceof Error ? error.message : "Unknown OpenFIGI error",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openFigiApiKey = Deno.env.get("OPENFIGI_API_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured" }, 500);
  }

  let body: { isin?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const isin = body?.isin?.trim();
  if (!isin) return jsonResponse({ error: "Missing required field: isin" }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: existingMapping, error: selectError } = await supabase
    .from("instrument_mappings")
    .select("isin,ticker,name,exchange,currency,source")
    .eq("isin", isin)
    .maybeSingle();

  if (selectError) {
    return jsonResponse(
      {
        error: "Failed to query instrument_mappings",
        details: selectError.message,
        code: selectError.code,
      },
      mapSupabaseErrorStatus(selectError),
    );
  }

  if (existingMapping) return jsonResponse(existingMapping);

  const figiResult = await fetchOpenFigiMapping(isin, openFigiApiKey);
  if (figiResult.error) return jsonResponse(figiResult.error, figiResult.error.status);

  const mapping = figiResult.data;

  const { data: insertedMapping, error: insertError } = await supabase
    .from("instrument_mappings")
    .insert(mapping)
    .select("isin,ticker,name,exchange,currency,source")
    .single();

  if (insertError) {
    return jsonResponse(
      {
        error: "Failed to insert instrument mapping",
        details: insertError.message,
        code: insertError.code,
        mapping,
      },
      mapSupabaseErrorStatus(insertError),
    );
  }

  return jsonResponse(insertedMapping);
});
