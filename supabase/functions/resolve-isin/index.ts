import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const FIGI_API = "https://api.openfigi.com/v3/mapping";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { isin } = await req.json();

    if (!isin) {
      return jsonResponse({ error: "missing_isin" }, 400);
    }

    // 1. Check cache
    const dbRes = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/rest/v1/instrument_mappings?isin=eq.${isin}`,
      {
        headers: {
          apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
      }
    );

    const existing = await dbRes.json();

    if (existing.length > 0 && existing[0].ticker) {
      return jsonResponse(existing[0]);
    }

    // 2. Call OpenFIGI
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    let figiRes;
    try {
      figiRes = await fetch(FIGI_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify([{ idType: "ID_ISIN", idValue: isin }]),
        signal: controller.signal,
      });
    } catch {
      return jsonResponse({ isin, ticker: null, error: "lookup_failed" }, 502);
    } finally {
      clearTimeout(timeout);
    }

    const figiData = await figiRes.json();
    const match = figiData?.[0]?.data?.[0];

    if (!match || !match.ticker) {
      return jsonResponse({ isin, ticker: null, error: "no_match" }, 404);
    }

    let ticker = match.ticker;
    const exchange = match.exchCode;
    const name = match.name;

    if (exchange === "TSXV") ticker = `${ticker}.V`;
    if (exchange === "TSX") ticker = `${ticker}.TO`;

    // 3. Store result
    await fetch(
      `${Deno.env.get("SUPABASE_URL")}/rest/v1/instrument_mappings`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          isin,
          ticker,
          name,
          exchange,
          source: "openfigi",
        }),
      }
    );

    return jsonResponse({ isin, ticker, name, exchange });

  } catch {
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
