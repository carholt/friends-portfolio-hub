import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Asset = {
  id: string;
  symbol: string;
  exchange_code: string | null;
  price_symbol: string | null;
};

type SymbolAlias = {
  raw_symbol: string;
  exchange: string;
  canonical_symbol: string;
  price_symbol: string;
};

type LatestPriceStamp = {
  asset_id: string;
  created_at: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_CALLS_PER_SECOND = 8;
const API_DELAY_MS = Math.ceil(1000 / MAX_CALLS_PER_SECOND);
const STALE_AFTER_MS = 10 * 60 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const apiKey = Deno.env.get("TWELVE_DATA_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "TWELVE_DATA_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const today = new Date().toISOString().slice(0, 10);
    const nowMs = Date.now();

    const { data: assets, error: assetsError } = await supabase
      .from("assets")
      .select("id,symbol,exchange_code,price_symbol")
      .not("price_symbol", "is", null);

    if (assetsError) throw assetsError;

    const assetIds = (assets ?? []).map((asset) => asset.id);
    const summary = {
      assets_considered: assetIds.length,
      assets_stale: 0,
      prices_upserted: 0,
      api_errors: 0,
      skipped_missing_price: 0,
    };

    const { data: aliases, error: aliasesError } = await supabase
      .from("symbol_aliases")
      .select("raw_symbol,exchange,canonical_symbol,price_symbol");

    if (aliasesError) throw aliasesError;

    const aliasMap = new Map<string, SymbolAlias>();
    for (const row of (aliases ?? []) as SymbolAlias[]) {
      aliasMap.set(`${row.raw_symbol.toUpperCase()}::${row.exchange.toUpperCase()}`, row);
    }


    if (assetIds.length === 0) {
      return new Response(JSON.stringify({ message: "No assets require updates", summary }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: priceStamps, error: stampError } = await supabase
      .from("prices")
      .select("asset_id,created_at")
      .in("asset_id", assetIds)
      .order("created_at", { ascending: false });

    if (stampError) throw stampError;

    const latestByAsset = new Map<string, string>();
    for (const row of (priceStamps ?? []) as LatestPriceStamp[]) {
      if (!latestByAsset.has(row.asset_id)) latestByAsset.set(row.asset_id, row.created_at);
    }

    const staleAssets = (assets as Asset[]).filter((asset) => {
      const latest = latestByAsset.get(asset.id);
      if (!latest) return true;
      return (nowMs - new Date(latest).getTime()) > STALE_AFTER_MS;
    });

    summary.assets_stale = staleAssets.length;

    const rowsToUpsert: Array<{
      asset_id: string;
      price: number;
      currency: string;
      price_date: string;
      as_of_date: string;
      source: string;
    }> = [];

    for (let i = 0; i < staleAssets.length; i += 1) {
      const asset = staleAssets[i];
      const alias = aliasMap.get(`${asset.symbol.toUpperCase()}::${(asset.exchange_code || "").toUpperCase()}`);
      const symbol = alias?.price_symbol || asset.price_symbol || `${asset.symbol}${asset.exchange_code ? `:${asset.exchange_code}` : ""}`;

      try {
        const response = await fetch(
          `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`,
        );
        const payload = await response.json() as { price?: string; currency?: string };
        const parsedPrice = Number(payload.price);

        if (Number.isFinite(parsedPrice) && parsedPrice > 0) {
          rowsToUpsert.push({
            asset_id: asset.id,
            price: parsedPrice,
            currency: (payload.currency || "USD").toUpperCase(),
            price_date: today,
            as_of_date: today,
            source: "twelve_data",
          });
        } else {
          summary.skipped_missing_price += 1;
        }
      } catch (_error) {
        summary.api_errors += 1;
      }

      if (i < staleAssets.length - 1) await sleep(API_DELAY_MS);
    }

    if (rowsToUpsert.length > 0) {
      const { error: upsertError } = await supabase
        .from("prices")
        .upsert(rowsToUpsert, { onConflict: "asset_id,price_date" });

      if (upsertError) throw upsertError;
      summary.prices_upserted = rowsToUpsert.length;
    }

    const { error: refreshError } = await supabase.rpc("refresh_portfolio_valuations");
    if (refreshError) throw refreshError;

    return new Response(JSON.stringify({ message: "Prices updated", summary }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
