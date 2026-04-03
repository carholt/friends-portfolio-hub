import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const FIGI_API = "https://api.openfigi.com/v3/mapping";

type ResolveResponse = {
  isin: string;
  ticker: string | null;
  name: string | null;
  exchange: string | null;
  source: string;
  error?: string;
};

const jsonResponse = (payload: ResolveResponse, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

serve(async (req) => {
  try {
    const { isin } = await req.json();

    if (!isin) {
      console.log("resolve-isin:", { step: "incoming_isin", data: { isin: null } });
      return jsonResponse({
        isin: "",
        ticker: null,
        name: null,
        exchange: null,
        source: "resolve-isin",
        error: "missing_isin",
      }, 400);
    }
    console.log("resolve-isin:", { step: "incoming_isin", data: { isin } });

    // 1. Check DB cache
    const dbRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/instrument_mappings?isin=eq.${isin}`, {
      headers: {
        apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
    });

    const existing = await dbRes.json();

    if (existing.length > 0 && existing[0].ticker) {
      const payload: ResolveResponse = {
        isin: String(existing[0].isin || isin),
        ticker: String(existing[0].ticker || ""),
        name: existing[0].name ? String(existing[0].name) : null,
        exchange: existing[0].exchange ? String(existing[0].exchange) : null,
        source: String(existing[0].source || "cache"),
      };
      console.log("resolve-isin:", { step: "db_hit", data: payload });
      console.log("resolve-isin:", { step: "final_result", data: payload });
      return jsonResponse(payload);
    }
    console.log("resolve-isin:", { step: "db_miss", data: { isin } });

    // 2. Call OpenFIGI
    console.log("resolve-isin:", { step: "api_request", data: { url: FIGI_API, isin } });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    let figiData: unknown;
    try {
      const figiRes = await fetch(FIGI_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify([{ idType: "ID_ISIN", idValue: isin }]),
        signal: controller.signal,
      });
      figiData = await figiRes.json();
      console.log("resolve-isin:", {
        step: "api_response",
        data: { ok: figiRes.ok, status: figiRes.status, body: figiData },
      });
      if (!figiRes.ok) {
        const failedPayload: ResolveResponse = {
          isin,
          ticker: null,
          name: null,
          exchange: null,
          source: "openfigi",
          error: "lookup_failed",
        };
        console.log("resolve-isin:", { step: "final_result", data: failedPayload });
        return jsonResponse(failedPayload, 502);
      }
    } catch (_error) {
      const failedPayload: ResolveResponse = {
        isin,
        ticker: null,
        name: null,
        exchange: null,
        source: "openfigi",
        error: "lookup_failed",
      };
      console.log("resolve-isin:", { step: "api_response", data: { error: "lookup_failed" } });
      console.log("resolve-isin:", { step: "final_result", data: failedPayload });
      return jsonResponse(failedPayload, 502);
    } finally {
      clearTimeout(timeoutId);
    }

    const match = (figiData as Array<{ data?: Array<Record<string, string>> }> | undefined)?.[0]?.data?.[0];

    if (!match || !match.ticker) {
      const noMatchPayload: ResolveResponse = {
        isin,
        ticker: null,
        name: null,
        exchange: null,
        source: "openfigi",
        error: "no_match",
      };
      console.log("resolve-isin:", { step: "final_result", data: noMatchPayload });
      return jsonResponse(noMatchPayload, 404);
    }

    let ticker = match.ticker;
    const exchange = match.exchCode;
    const name = match.name;

    // Normalize Canadian exchanges
    if (exchange === "TSXV") ticker = `${ticker}.V`;
    if (exchange === "TSX") ticker = `${ticker}.TO`;

    // 3. Store in DB
    await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/instrument_mappings`, {
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
    });

    const finalPayload: ResolveResponse = { isin, ticker, name, exchange, source: "openfigi" };
    console.log("resolve-isin:", { step: "final_result", data: finalPayload });
    return jsonResponse(finalPayload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const failedPayload: ResolveResponse = {
      isin: "",
      ticker: null,
      name: null,
      exchange: null,
      source: "resolve-isin",
      error: message,
    };
    console.log("resolve-isin:", { step: "final_result", data: failedPayload });
    return jsonResponse(failedPayload, 500);
  }
});
