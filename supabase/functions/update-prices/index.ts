import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Asset = {
  id: string;
  symbol: string;
  asset_type: string;
  currency: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHUNK_SIZE = 8;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const today = new Date().toISOString().split("T")[0];

    const { data: activeHoldings, error: holdingsError } = await supabase
      .from("holdings")
      .select("asset_id")
      .limit(100000);

    if (holdingsError) throw holdingsError;

    const uniqueAssetIds = [...new Set((activeHoldings || []).map((h) => h.asset_id))];
    if (uniqueAssetIds.length === 0) {
      return new Response(JSON.stringify({ message: "No holdings/assets to update", updated: 0, date: today }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: assets, error: assetsError } = await supabase
      .from("assets")
      .select("id, symbol, asset_type, currency")
      .in("id", uniqueAssetIds);

    if (assetsError) throw assetsError;

    const { data: existingPrices } = await supabase
      .from("prices")
      .select("asset_id")
      .eq("as_of_date", today);

    const alreadyPriced = new Set(existingPrices?.map((price) => price.asset_id) || []);
    const assetsToFetch = (assets || []).filter((asset) => !alreadyPriced.has(asset.id));

    const fetchedPrices = new Map<string, number>();
    const missingSymbols: string[] = [];

    for (let i = 0; i < assetsToFetch.length; i += CHUNK_SIZE) {
      const chunk = assetsToFetch.slice(i, i + CHUNK_SIZE) as Asset[];
      const symbols = chunk
        .map((asset) => (asset.asset_type === "metal" ? `${asset.symbol}/USD` : asset.symbol))
        .join(",");

      const response = await fetch(
        `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbols)}&apikey=${TWELVE_DATA_API_KEY}`,
      );
      const payload = await response.json();

      for (const asset of chunk) {
        const key = asset.asset_type === "metal" ? `${asset.symbol}/USD` : asset.symbol;
        const item = chunk.length === 1 ? payload : payload[key];
        const parsedPrice = Number(item?.price);

        if (Number.isFinite(parsedPrice) && parsedPrice > 0) {
          fetchedPrices.set(asset.id, parsedPrice);
        } else {
          missingSymbols.push(asset.symbol);
        }
      }

      if (i + CHUNK_SIZE < assetsToFetch.length) {
        await sleep(1400);
      }
    }

    if (fetchedPrices.size > 0) {
      const rows = [...fetchedPrices.entries()].map(([assetId, price]) => ({
        asset_id: assetId,
        price,
        currency: "USD",
        as_of_date: today,
        source: "twelve_data",
      }));

      const { error: upsertError } = await supabase
        .from("prices")
        .upsert(rows, { onConflict: "asset_id,as_of_date" });

      if (upsertError) throw upsertError;
    }

    const { data: portfolios, error: portfolioError } = await supabase
      .from("portfolios")
      .select("id, base_currency");

    if (portfolioError) throw portfolioError;

    const latestPriceCache = new Map<string, number>();

    for (const portfolio of portfolios || []) {
      const { data: holdings } = await supabase
        .from("holdings")
        .select("asset_id, quantity")
        .eq("portfolio_id", portfolio.id);

      if (!holdings || holdings.length === 0) continue;

      let totalValue = 0;

      for (const holding of holdings) {
        const fromFetch = fetchedPrices.get(holding.asset_id);
        if (fromFetch != null) {
          totalValue += Number(holding.quantity) * fromFetch;
          continue;
        }

        if (latestPriceCache.has(holding.asset_id)) {
          totalValue += Number(holding.quantity) * (latestPriceCache.get(holding.asset_id) || 0);
          continue;
        }

        const { data: latestStoredPrice } = await supabase
          .from("prices")
          .select("price")
          .eq("asset_id", holding.asset_id)
          .order("as_of_date", { ascending: false })
          .limit(1)
          .maybeSingle();

        const fallbackPrice = Number(latestStoredPrice?.price);
        if (Number.isFinite(fallbackPrice) && fallbackPrice > 0) {
          latestPriceCache.set(holding.asset_id, fallbackPrice);
          totalValue += Number(holding.quantity) * fallbackPrice;
        }
      }

      await supabase.from("portfolio_valuations").upsert(
        {
          portfolio_id: portfolio.id,
          total_value: totalValue,
          currency: portfolio.base_currency,
          as_of_date: today,
        },
        { onConflict: "portfolio_id,as_of_date" },
      );
    }

    return new Response(
      JSON.stringify({
        message: "Prices and valuations updated",
        updated: fetchedPrices.size,
        missing: missingSymbols,
        date: today,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("update-prices error", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
