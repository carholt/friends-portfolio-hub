import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Asset = {
  id: string;
  symbol: string;
  asset_type: string;
  currency: string;
  exchange?: string | null;
  exchange_code?: string | null;
  metadata_json?: Record<string, unknown> | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHUNK_SIZE = 8;
const normalize = (value?: string | null) => (value || "").trim().toUpperCase();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const buildProviderSymbolFallback = (asset: Asset) => {
  const symbol = normalize(asset.symbol);
  const exchangeCode = normalize(asset.exchange_code || asset.exchange || String(asset.metadata_json?.exchange_code || ""));
  if (exchangeCode === "TSX") return `${symbol}.TO`;
  if (exchangeCode === "TSXV") return `${symbol}.V`;
  return symbol;
};

const resolveProviderSymbol = (asset: Asset) => {
  const fromMetadata = normalize(String(asset.metadata_json?.provider_symbol || ""));
  if (fromMetadata) return fromMetadata;
  return buildProviderSymbolFallback(asset);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const TWELVE_DATA_API_KEY = Deno.env.get("TWELVE_DATA_API_KEY");
  if (!TWELVE_DATA_API_KEY) {
    return new Response(JSON.stringify({ error: "TWELVE_DATA_API_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const today = new Date().toISOString().split("T")[0];
    const counts = { assets_considered: 0, priced: 0, skipped_no_quote: 0, errors: 0 };
    const skippedSymbols: Array<{ symbol: string; reason: string }> = [];

    const { data: activeHoldings, error: holdingsError } = await supabase.from("holdings").select("portfolio_id,asset_id,quantity").gt("quantity", 0).limit(100000);
    if (holdingsError) throw holdingsError;

    const uniqueAssetIds = [...new Set((activeHoldings || []).map((h) => h.asset_id))];
    counts.assets_considered = uniqueAssetIds.length;

    if (uniqueAssetIds.length === 0) {
      return new Response(JSON.stringify({ message: "No holdings/assets to update", counts, skipped_symbols: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: assets, error: assetsError } = await supabase
      .from("assets")
      .select("id, symbol, asset_type, currency, exchange, exchange_code, metadata_json")
      .in("id", uniqueAssetIds);
    if (assetsError) throw assetsError;

    const { data: existingPrices } = await supabase.from("prices").select("asset_id").eq("as_of_date", today);
    const alreadyPriced = new Set(existingPrices?.map((price) => price.asset_id) || []);
    const assetsToFetch = (assets || []).filter((asset) => !alreadyPriced.has(asset.id)) as Asset[];

    for (let i = 0; i < assetsToFetch.length; i += CHUNK_SIZE) {
      const chunk = assetsToFetch.slice(i, i + CHUNK_SIZE);
      const symbols = chunk.map((asset) => (asset.asset_type === "metal" ? `${asset.symbol}/USD` : resolveProviderSymbol(asset))).join(",");
      const response = await fetch(`https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbols)}&apikey=${TWELVE_DATA_API_KEY}`);
      const payload = await response.json();

      const rows: Array<{ asset_id: string; price: number; currency: string; as_of_date: string; source: string }> = [];
      for (const asset of chunk) {
        const key = asset.asset_type === "metal" ? `${asset.symbol}/USD` : resolveProviderSymbol(asset);
        const item = chunk.length === 1 ? payload : payload[key];
        const parsedPrice = Number(item?.price);
        const quoteCurrency = normalize(String(item?.currency || asset.currency || "")) || "USD";

        if (Number.isFinite(parsedPrice) && parsedPrice > 0) {
          rows.push({ asset_id: asset.id, price: parsedPrice, currency: quoteCurrency, as_of_date: today, source: "twelve_data" });
          counts.priced += 1;
        } else {
          counts.skipped_no_quote += 1;
          if (skippedSymbols.length < 50) skippedSymbols.push({ symbol: key, reason: item?.message || "No price source yet" });
        }
      }

      if (rows.length > 0) {
        const { error: upsertError } = await supabase.from("prices").upsert(rows, { onConflict: "asset_id,as_of_date" });
        if (upsertError) throw upsertError;
      }
      if (i + CHUNK_SIZE < assetsToFetch.length) await sleep(1200);
    }

    const portfolioTotals = new Map<string, number>();
    for (const holding of activeHoldings || []) {
      const priceRow = (await supabase.from("prices").select("price").eq("asset_id", holding.asset_id).eq("as_of_date", today).maybeSingle()).data;
      const value = Number(holding.quantity || 0) * Number(priceRow?.price || 0);
      portfolioTotals.set(holding.portfolio_id, (portfolioTotals.get(holding.portfolio_id) || 0) + value);
    }

    const valuationRows = [...portfolioTotals.entries()].map(([portfolio_id, total_value]) => ({ portfolio_id, total_value, currency: "SEK", as_of_date: today }));
    if (valuationRows.length > 0) {
      await supabase.from("portfolio_valuations").upsert(valuationRows, { onConflict: "portfolio_id,as_of_date" });
    }

    return new Response(JSON.stringify({ message: "Prices update finished", summary: counts, skipped_symbols: skippedSymbols }), {
      status: 200,
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
