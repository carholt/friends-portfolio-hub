import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type AssetRow = {
  id: string;
  symbol: string;
  price_symbol: string | null;
  price_provider: string | null;
  currency: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_CALLS_PER_SECOND = 8;
const API_DELAY_MS = Math.ceil(1000 / MAX_CALLS_PER_SECOND);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;

  if (typeof error === "object" && error !== null) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) return maybeMessage;

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return typeof error === "string" && error.trim().length > 0 ? error : "Unknown error";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const apiKey = Deno.env.get("TWELVE_DATA_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "TWELVE_DATA_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return new Response(JSON.stringify({ error: "SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    const { data: assets, error: assetsError } = await supabase
      .from("assets")
      .select("id,symbol,price_symbol,price_provider,currency");

    if (assetsError) throw assetsError;

    const priceRows: Array<{
      asset_id: string;
      price: number;
      currency: string;
      price_date: string;
      source: string;
    }> = [];

    const summary = {
      assets_considered: (assets ?? []).length,
      prices_upserted: 0,
      skipped_missing_symbol: 0,
      skipped_missing_price: 0,
      api_errors: 0,
    };

    for (let i = 0; i < (assets ?? []).length; i += 1) {
      const asset = assets![i] as AssetRow;
      const symbol = (asset.price_symbol ?? asset.symbol ?? "").trim();

      if (!symbol) {
        summary.skipped_missing_symbol += 1;
        continue;
      }

      try {
        const response = await fetch(
          `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`,
        );
        const payload = await response.json() as { price?: string; currency?: string };
        const parsedPrice = Number(payload.price);

        if (Number.isFinite(parsedPrice) && parsedPrice > 0) {
          priceRows.push({
            asset_id: asset.id,
            price: parsedPrice,
            currency: (payload.currency ?? asset.currency ?? "USD").toUpperCase(),
            price_date: today,
            source: asset.price_provider ?? "twelve_data",
          });
        } else {
          summary.skipped_missing_price += 1;
        }
      } catch (_error) {
        summary.api_errors += 1;
      }

      if (i < (assets ?? []).length - 1) await sleep(API_DELAY_MS);
    }

    if (priceRows.length > 0) {
      const { error: upsertError } = await supabase
        .from("asset_prices")
        .upsert(priceRows, { onConflict: "asset_id,price_date" });

      if (upsertError) throw upsertError;
      summary.prices_upserted = priceRows.length;
    }

    const { error: refreshError } = await supabase.rpc("refresh_portfolio_valuations");
    if (refreshError) throw refreshError;

    return new Response(JSON.stringify({ message: "Asset prices updated", summary }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("update-prices failed:", message, error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
