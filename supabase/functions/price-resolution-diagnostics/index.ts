import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-diagnostic-token",
};

const normalize = (value: string) => value.trim().toUpperCase();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const expectedToken = Deno.env.get("PRICE_DIAGNOSTIC_TOKEN");
  const incomingToken = req.headers.get("x-diagnostic-token");

  if (!expectedToken) {
    return new Response(JSON.stringify({ error: "Diagnostics are not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (!incomingToken || incomingToken !== expectedToken) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const payload = await req.json();
    const inputSymbols = Array.isArray(payload?.symbols) ? payload.symbols : [];
    const symbols = inputSymbols
      .map((entry: unknown) => {
        if (typeof entry === "string") return normalize(entry);
        if (entry && typeof entry === "object") {
          const symbol = normalize(String((entry as Record<string, unknown>).symbol || ""));
          return symbol;
        }
        return "";
      })
      .filter(Boolean);

    if (symbols.length === 0) {
      return new Response(JSON.stringify({ results: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const response = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}`);
    const data = await response.json() as { quoteResponse?: { result?: Array<{ symbol?: string; regularMarketPrice?: number }> } };
    const map = new Map((data.quoteResponse?.result || []).map((item) => [normalize(String(item.symbol || "")), item]));

    const results = symbols.map((symbol) => {
      const item = map.get(symbol);
      const price = Number(item?.regularMarketPrice);
      return {
        symbol,
        resolves: Number.isFinite(price) && price > 0,
        price: Number.isFinite(price) ? price : null,
        status: response.ok ? "ok" : `http_${response.status}`,
        message: null,
      };
    });

    return new Response(JSON.stringify({ dry_run: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
