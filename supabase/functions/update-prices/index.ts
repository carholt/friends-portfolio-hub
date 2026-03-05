import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Asset = {
  id: string;
  symbol: string;
  asset_type: string;
  currency: string;
  exchange?: string | null;
  exchange_code?: string | null;
  price_symbol?: string | null;
  symbol_resolution_status?: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHUNK_SIZE = 8;
const normalize = (value?: string | null) => (value || "").trim().toUpperCase();
const EXCHANGE_AS_SYMBOL = new Set(["TSX", "TSXV", "NYSE", "NASDAQ"]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const buildPriceSymbol = (asset: Asset) => {
  if (asset.price_symbol) return normalize(asset.price_symbol);
  const exchange = normalize(asset.exchange_code || asset.exchange);
  return exchange ? `${normalize(asset.symbol)}:${exchange}` : normalize(asset.symbol);
};

async function resolveSymbol(apiKey: string, symbol: string, hintCurrency?: string | null) {
  if (EXCHANGE_AS_SYMBOL.has(symbol)) {
    return { status: "invalid", candidate: null, reason: "symbol is exchange code" };
  }
  const response = await fetch(`https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(symbol)}&outputsize=10&apikey=${apiKey}`);
  const payload = await response.json();
  const entries = Array.isArray(payload?.data) ? payload.data : [];
  const scored = entries.map((item: Record<string, unknown>) => {
    const candidateSymbol = normalize(String(item.symbol || ""));
    const exchangeCode = normalize(String(item.exchange || item.exchange_code || "")) || null;
    const currency = normalize(String(item.currency || "")) || null;
    const priceSymbol = exchangeCode ? `${candidateSymbol}:${exchangeCode}` : candidateSymbol;
    let score = candidateSymbol === symbol ? 80 : candidateSymbol.startsWith(symbol) ? 55 : 25;
    if (currency && hintCurrency && currency === normalize(hintCurrency)) score += 12;
    if (exchangeCode) score += 8;
    return { priceSymbol, exchangeCode, currency, score };
  }).sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { status: "invalid", candidate: null, reason: "no candidates" };
  if (scored.length > 1 && scored[0].score - scored[1].score < 8) return { status: "ambiguous", candidate: scored[0], reason: "multiple candidates" };
  return { status: "resolved", candidate: scored[0], reason: "resolved" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const TWELVE_DATA_API_KEY = Deno.env.get("TWELVE_DATA_API_KEY");
  if (!TWELVE_DATA_API_KEY) {
    return new Response(JSON.stringify({ error: "TWELVE_DATA_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const today = new Date().toISOString().split("T")[0];
    const counts = { holdings_assets: 0, resolved_now: 0, priced: 0, skipped_unresolved: 0, skipped_no_price: 0, errors: 0 };
    const skippedSymbols: Array<{ symbol: string; reason: string }> = [];

    const { data: activeHoldings, error: holdingsError } = await supabase.from("holdings").select("asset_id").limit(100000);
    if (holdingsError) throw holdingsError;

    const uniqueAssetIds = [...new Set((activeHoldings || []).map((h) => h.asset_id))];
    counts.holdings_assets = uniqueAssetIds.length;

    if (uniqueAssetIds.length === 0) {
      return new Response(JSON.stringify({ message: "No holdings/assets to update", counts, skipped_symbols: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: assets, error: assetsError } = await supabase
      .from("assets")
      .select("id, symbol, asset_type, currency, exchange, exchange_code, price_symbol, symbol_resolution_status")
      .in("id", uniqueAssetIds);
    if (assetsError) throw assetsError;

    const { data: existingPrices } = await supabase.from("prices").select("asset_id").eq("as_of_date", today);
    const alreadyPriced = new Set(existingPrices?.map((price) => price.asset_id) || []);
    const assetsToFetch = (assets || []).filter((asset) => !alreadyPriced.has(asset.id));

    for (const asset of assetsToFetch as Asset[]) {
      if (!asset.price_symbol && !asset.exchange_code) {
        const resolved = await resolveSymbol(TWELVE_DATA_API_KEY, normalize(asset.symbol), asset.currency);
        await supabase.from("assets").update({
          price_symbol: resolved.candidate?.priceSymbol ?? null,
          exchange_code: resolved.candidate?.exchangeCode ?? null,
          symbol_resolution_status: resolved.status,
          symbol_resolution_notes: resolved.reason,
          last_symbol_resolution_at: new Date().toISOString(),
          price_provider: "twelve_data",
        }).eq("id", asset.id);

        if (resolved.status === "resolved") {
          asset.price_symbol = resolved.candidate?.priceSymbol || null;
          asset.exchange_code = resolved.candidate?.exchangeCode || null;
          counts.resolved_now += 1;
        } else {
          counts.skipped_unresolved += 1;
          if (skippedSymbols.length < 20) skippedSymbols.push({ symbol: asset.symbol, reason: resolved.reason });
        }
      }
    }

    for (let i = 0; i < assetsToFetch.length; i += CHUNK_SIZE) {
      const chunk = (assetsToFetch.slice(i, i + CHUNK_SIZE) as Asset[]).filter((asset) => {
        if (!asset.price_symbol && !asset.exchange_code && asset.symbol_resolution_status !== "resolved") return false;
        return true;
      });

      if (chunk.length === 0) continue;

      const symbols = chunk.map((asset) => (asset.asset_type === "metal" ? `${asset.symbol}/USD` : buildPriceSymbol(asset))).join(",");
      const response = await fetch(`https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbols)}&apikey=${TWELVE_DATA_API_KEY}`);
      const payload = await response.json();

      const rows: Array<{ asset_id: string; price: number; currency: string; as_of_date: string; source: string }> = [];
      for (const asset of chunk) {
        const key = asset.asset_type === "metal" ? `${asset.symbol}/USD` : buildPriceSymbol(asset);
        const item = chunk.length === 1 ? payload : payload[key];
        const parsedPrice = Number(item?.price);
        const quoteCurrency = normalize(String(item?.currency || asset.currency || "")) || "USD";

        if (Number.isFinite(parsedPrice) && parsedPrice > 0 && quoteCurrency) {
          rows.push({ asset_id: asset.id, price: parsedPrice, currency: quoteCurrency, as_of_date: today, source: "twelve_data" });
          counts.priced += 1;
        } else {
          counts.skipped_no_price += 1;
          if (skippedSymbols.length < 20) skippedSymbols.push({ symbol: asset.symbol, reason: "no positive price" });
        }
      }

      if (rows.length > 0) {
        const { error: upsertError } = await supabase.from("prices").upsert(rows, { onConflict: "asset_id,as_of_date" });
        if (upsertError) throw upsertError;
      }
      if (i + CHUNK_SIZE < assetsToFetch.length) await sleep(1400);
    }

    return new Response(JSON.stringify({ message: "Prices update finished", counts, skipped_symbols: skippedSymbols }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("update-prices error", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
