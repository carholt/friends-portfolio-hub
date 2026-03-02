import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const TWELVE_DATA_API_KEY = Deno.env.get("TWELVE_DATA_API_KEY");
  if (!TWELVE_DATA_API_KEY) {
    return new Response(JSON.stringify({ error: "TWELVE_DATA_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Get all unique assets used in holdings
    const { data: assets, error: assetsErr } = await supabase
      .from("assets")
      .select("id, symbol, asset_type, currency");

    if (assetsErr) throw new Error(`Failed to fetch assets: ${assetsErr.message}`);
    if (!assets || assets.length === 0) {
      return new Response(JSON.stringify({ message: "No assets to update", updated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const today = new Date().toISOString().split("T")[0];

    // Check which assets already have prices for today
    const { data: existingPrices } = await supabase
      .from("prices")
      .select("asset_id")
      .eq("as_of_date", today);

    const alreadyPriced = new Set(existingPrices?.map(p => p.asset_id) || []);
    const assetsToFetch = assets.filter(a => !alreadyPriced.has(a.id));

    if (assetsToFetch.length === 0) {
      return new Response(JSON.stringify({ message: "All prices already cached for today", updated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Batch fetch prices from Twelve Data (max 8 per request for free tier)
    const results: { asset_id: string; price: number; currency: string }[] = [];
    const batchSize = 8;

    for (let i = 0; i < assetsToFetch.length; i += batchSize) {
      const batch = assetsToFetch.slice(i, i + batchSize);
      const symbols = batch.map(a => {
        // For metals, Twelve Data uses XAU/USD, XAG/USD format
        if (a.asset_type === "metal") {
          return `${a.symbol}/USD`;
        }
        return a.symbol;
      }).join(",");

      const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbols)}&apikey=${TWELVE_DATA_API_KEY}`;
      const resp = await fetch(url);
      const data = await resp.json();

      if (batch.length === 1) {
        // Single symbol returns flat object
        const asset = batch[0];
        const key = asset.asset_type === "metal" ? `${asset.symbol}/USD` : asset.symbol;
        if (data.price) {
          results.push({ asset_id: asset.id, price: parseFloat(data.price), currency: "USD" });
        } else {
          console.warn(`No price for ${key}:`, data);
        }
      } else {
        // Multiple symbols returns keyed object
        for (const asset of batch) {
          const key = asset.asset_type === "metal" ? `${asset.symbol}/USD` : asset.symbol;
          const priceData = data[key];
          if (priceData?.price) {
            results.push({ asset_id: asset.id, price: parseFloat(priceData.price), currency: "USD" });
          } else {
            console.warn(`No price for ${key}:`, priceData);
          }
        }
      }

      // Rate limit: wait between batches
      if (i + batchSize < assetsToFetch.length) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    // Insert prices
    if (results.length > 0) {
      const priceRows = results.map(r => ({
        asset_id: r.asset_id,
        price: r.price,
        currency: r.currency,
        as_of_date: today,
        source: "twelve_data",
      }));

      const { error: insertErr } = await supabase
        .from("prices")
        .upsert(priceRows, { onConflict: "asset_id,as_of_date" });

      if (insertErr) throw new Error(`Failed to insert prices: ${insertErr.message}`);
    }

    // Recalculate portfolio valuations
    const { data: portfolios } = await supabase
      .from("portfolios")
      .select("id, base_currency");

    if (portfolios) {
      for (const portfolio of portfolios) {
        const { data: holdings } = await supabase
          .from("holdings")
          .select("quantity, asset_id")
          .eq("portfolio_id", portfolio.id);

        if (!holdings || holdings.length === 0) continue;

        let totalValue = 0;
        for (const h of holdings) {
          const priceResult = results.find(r => r.asset_id === h.asset_id);
          if (priceResult) {
            totalValue += Number(h.quantity) * priceResult.price;
          } else {
            // Try to get from existing prices
            const { data: existingPrice } = await supabase
              .from("prices")
              .select("price")
              .eq("asset_id", h.asset_id)
              .order("as_of_date", { ascending: false })
              .limit(1)
              .single();
            if (existingPrice) {
              totalValue += Number(h.quantity) * Number(existingPrice.price);
            }
          }
        }

        await supabase
          .from("portfolio_valuations")
          .upsert({
            portfolio_id: portfolio.id,
            total_value: totalValue,
            currency: portfolio.base_currency,
            as_of_date: today,
          }, { onConflict: "portfolio_id,as_of_date" });
      }
    }

    return new Response(JSON.stringify({
      message: "Prices updated successfully",
      updated: results.length,
      total_assets: assetsToFetch.length,
      date: today,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Price update error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
