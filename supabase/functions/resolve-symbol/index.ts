import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Candidate = {
  price_symbol: string;
  exchange_code: string | null;
  name: string;
  currency: string | null;
  score: number;
  provider: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXCHANGE_AS_SYMBOL = new Set(["TSX", "TSXV", "NYSE", "NASDAQ"]);

const normalize = (value: string | null | undefined) => (value ?? "").trim().toUpperCase();

function scoreCandidate(inputSymbol: string, hintCurrency: string | null, item: Record<string, unknown>) {
  const candidateSymbol = normalize(String(item.symbol || ""));
  const exchangeCode = normalize(String(item.exchange || item.exchange_code || "")) || null;
  const currency = normalize(String(item.currency || "")) || null;
  let score = 0;

  if (candidateSymbol === inputSymbol) score += 80;
  else if (candidateSymbol.startsWith(inputSymbol)) score += 55;

  if (hintCurrency && currency === hintCurrency) score += 12;
  if (exchangeCode) score += 8;

  if (exchangeCode && candidateSymbol === exchangeCode) score -= 30;

  return score;
}

async function searchSymbol(apiKey: string, symbol: string) {
  const response = await fetch(`https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(symbol)}&outputsize=20&apikey=${apiKey}`);
  const payload = await response.json();
  return Array.isArray(payload?.data) ? payload.data : [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const twelveKey = Deno.env.get("TWELVE_DATA_API_KEY");

    if (!twelveKey) {
      return new Response(JSON.stringify({ error: "TWELVE_DATA_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });

    const { data: authData } = await userClient.auth.getUser();
    if (!authData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const symbol = normalize(String(body?.symbol || body?._symbol || ""));
    const hintCurrency = normalize(String(body?.hint_currency || body?._hint_currency || "")) || null;

    if (!symbol) {
      return new Response(JSON.stringify({ error: "symbol required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (EXCHANGE_AS_SYMBOL.has(symbol)) {
      return new Response(JSON.stringify({ candidates: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await searchSymbol(twelveKey, symbol);
    const candidates: Candidate[] = data
      .map((item: Record<string, unknown>) => {
        const candidateSymbol = normalize(String(item.symbol || ""));
        if (!candidateSymbol) return null;
        const exchangeCode = normalize(String(item.exchange || item.exchange_code || "")) || null;
        const currency = normalize(String(item.currency || "")) || null;
        const price_symbol = exchangeCode ? `${candidateSymbol}:${exchangeCode}` : candidateSymbol;
        return {
          price_symbol,
          exchange_code: exchangeCode,
          name: String(item.instrument_name || item.name || candidateSymbol),
          currency,
          score: scoreCandidate(symbol, hintCurrency, item),
          provider: "twelve_data",
        } as Candidate;
      })
      .filter((item): item is Candidate => !!item)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    return new Response(JSON.stringify({ candidates }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
