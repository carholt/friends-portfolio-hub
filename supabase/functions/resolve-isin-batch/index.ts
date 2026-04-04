import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const OPENFIGI_URL = "https://api.openfigi.com/v3/mapping";
const MAX_ISINS_PER_REQUEST = 100;

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

type OpenFigiMappingItem = {
  ticker?: string;
  name?: string;
  exchCode?: string;
  currency?: string;
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

function normalizeIsin(rawIsin: unknown) {
  return String(rawIsin ?? "").trim().toUpperCase();
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

async function fetchOpenFigiBatch(isins: string[], openFigiApiKey?: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("OpenFIGI timeout"), 5000);

  try {
    const response = await fetch(OPENFIGI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(openFigiApiKey ? { "X-OPENFIGI-APIKEY": openFigiApiKey } : {}),
      },
      body: JSON.stringify(isins.map((isin) => ({ idType: "ID_ISIN", idValue: isin }))),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        error: {
          status: response.status,
          message: `OpenFIGI batch request failed with status ${response.status}`,
          details: await response.text(),
        },
      };
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      return { error: { status: 502, message: "OpenFIGI returned invalid payload" } };
    }

    const resolved = new Map<string, MappingRow>();

    isins.forEach((isin, index) => {
      const entry = payload[index] as { data?: OpenFigiMappingItem[] } | undefined;
      const match = Array.isArray(entry?.data) ? entry?.data?.[0] : undefined;
      if (!match?.ticker) return;

      const exchange = match.exchCode ?? null;
      resolved.set(isin, {
        isin,
        ticker: normalizeTicker(match.ticker ?? null, exchange),
        name: match.name ?? null,
        exchange,
        currency: match.currency ?? null,
        source: "openfigi",
      });
    });

    return { data: resolved };
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

  let body: { isins?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!Array.isArray(body?.isins)) {
    return jsonResponse({ error: "isins must be an array" }, 400);
  }

  const normalizedIsins = Array.from(new Set(body.isins.map(normalizeIsin).filter(Boolean)));

  if (normalizedIsins.length === 0) return jsonResponse([]);
  if (normalizedIsins.length > MAX_ISINS_PER_REQUEST) {
    return jsonResponse({ error: `Max ${MAX_ISINS_PER_REQUEST} ISINs per request` }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: cachedMappings, error: cachedError } = await supabase
    .from("instrument_mappings")
    .select("isin,ticker,name,exchange,currency,source")
    .in("isin", normalizedIsins);

  if (cachedError) {
    return jsonResponse(
      {
        error: "Failed to query instrument_mappings",
        details: cachedError.message,
        code: cachedError.code,
      },
      mapSupabaseErrorStatus(cachedError),
    );
  }

  const resultByIsin = new Map<string, MappingRow>();
  (cachedMappings ?? []).forEach((row) => {
    if (row?.isin) {
      resultByIsin.set(String(row.isin).toUpperCase(), {
        isin: String(row.isin).toUpperCase(),
        ticker: row.ticker,
        name: row.name,
        exchange: row.exchange,
        currency: row.currency,
        source: row.source,
      });
    }
  });

  const missingIsins = normalizedIsins.filter((isin) => !resultByIsin.has(isin));

  if (missingIsins.length > 0) {
    const figiResult = await fetchOpenFigiBatch(missingIsins, openFigiApiKey);
    if (figiResult.error) return jsonResponse(figiResult.error, figiResult.error.status);

    const newMappings = Array.from(figiResult.data.values()).filter((row) => row.ticker);

    if (newMappings.length > 0) {
      const { data: insertedRows, error: insertError } = await supabase
        .from("instrument_mappings")
        .upsert(newMappings, { onConflict: "isin" })
        .select("isin,ticker,name,exchange,currency,source");

      if (insertError) {
        return jsonResponse(
          {
            error: "Failed to insert instrument mappings",
            details: insertError.message,
            code: insertError.code,
          },
          mapSupabaseErrorStatus(insertError),
        );
      }

      (insertedRows ?? []).forEach((row) => {
        if (row?.isin) {
          resultByIsin.set(String(row.isin).toUpperCase(), {
            isin: String(row.isin).toUpperCase(),
            ticker: row.ticker,
            name: row.name,
            exchange: row.exchange,
            currency: row.currency,
            source: row.source,
          });
        }
      });
    }
  }

  return jsonResponse(normalizedIsins.map((isin) => ({
    isin,
    ticker: resultByIsin.get(isin)?.ticker ?? null,
    exchange: resultByIsin.get(isin)?.exchange ?? null,
  })));
});
