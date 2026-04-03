import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const FIGI_API = "https://api.openfigi.com/v3/mapping";

serve(async (req) => {
  try {
    const { isin } = await req.json();

    if (!isin) {
      return new Response(JSON.stringify({ error: "Missing ISIN" }), { status: 400 });
    }

    // 1. Check DB cache
    const dbRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/instrument_mappings?isin=eq.${isin}`, {
      headers: {
        apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
    });

    const existing = await dbRes.json();

    if (existing.length > 0 && existing[0].ticker) {
      return new Response(JSON.stringify(existing[0]));
    }

    // 2. Call OpenFIGI
    const figiRes = await fetch(FIGI_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{ idType: "ID_ISIN", idValue: isin }]),
    });

    const figiData = await figiRes.json();

    const match = figiData?.[0]?.data?.[0];

    if (!match) {
      return new Response(JSON.stringify({ isin, ticker: null }));
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

    return new Response(JSON.stringify({ isin, ticker, name, exchange }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});
