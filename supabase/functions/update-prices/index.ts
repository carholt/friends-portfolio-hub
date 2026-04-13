import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type AssetRow = {
  id: string;
  symbol: string;
  price_symbol: string | null;
  price_provider: string | null;
  currency: string | null;
  exchange: string | null;
};

type YahooQuote = {
  symbol?: string;
  regularMarketPrice?: number;
  currency?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const YAHOO_QUOTE_ENDPOINT = "https://query1.finance.yahoo.com/v7/finance/quote";
const YAHOO_BATCH_SIZE = 50;

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

function normalizeYahooSymbol(symbol: string, exchange?: string | null) {
  if (!symbol) return symbol;

  const s = symbol.toUpperCase().trim();
  const normalizedExchange = String(exchange || "").toUpperCase().trim();

  if (normalizedExchange === "XTSX" || normalizedExchange === "XTSE") return `${s}.TO`;
  if (normalizedExchange === "XSTO") return `${s}.ST`;

  return s;
}

function chunkArray<T>(input: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < input.length; index += size) {
    chunks.push(input.slice(index, index + size));
  }
  return chunks;
}

async function fetchYahooQuotes(symbols: string[]): Promise<Map<string, YahooQuote>> {
  if (symbols.length === 0) return new Map();

  const endpoint = `${YAHOO_QUOTE_ENDPOINT}?symbols=${encodeURIComponent(symbols.join(","))}`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Yahoo quote HTTP ${response.status}`);
  }

  const payload = await response.json() as {
    quoteResponse?: {
      result?: YahooQuote[];
    };
  };
  console.log("Yahoo response:", payload);

  const quoteMap = new Map<string, YahooQuote>();
  for (const item of payload.quoteResponse?.result ?? []) {
    const symbol = String(item.symbol || "").toUpperCase().trim();
    if (!symbol) continue;
    quoteMap.set(symbol, item);
  }

  return quoteMap;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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

    const today = new Date().toISOString().slice(0, 10);

    const { data: assets, error: assetsError } = await supabase
      .from("assets")
      .select("id,symbol,price_symbol,price_provider,currency,exchange");

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

    const normalizedSymbolsByAsset = new Map<string, string>();
    for (const rawAsset of assets ?? []) {
      const asset = rawAsset as AssetRow;
      const symbol = normalizeYahooSymbol(asset.price_symbol ?? asset.symbol ?? "", asset.exchange);
      if (!symbol) {
        summary.skipped_missing_symbol += 1;
        continue;
      }

      console.log("Fetching price for:", symbol);
      normalizedSymbolsByAsset.set(asset.id, symbol);
    }

    const uniqueSymbols = Array.from(new Set(Array.from(normalizedSymbolsByAsset.values())));
    const yahooQuoteBySymbol = new Map<string, YahooQuote>();

    for (const symbolChunk of chunkArray(uniqueSymbols, YAHOO_BATCH_SIZE)) {
      try {
        const chunkQuotes = await fetchYahooQuotes(symbolChunk);
        for (const [key, value] of chunkQuotes.entries()) {
          yahooQuoteBySymbol.set(key, value);
        }
      } catch (error) {
        summary.api_errors += 1;
        console.error("Yahoo batch fetch failed:", getErrorMessage(error));
      }
    }

    for (const rawAsset of assets ?? []) {
      const asset = rawAsset as AssetRow;
      const symbol = normalizedSymbolsByAsset.get(asset.id);
      if (!symbol) continue;

      const match = yahooQuoteBySymbol.get(symbol.toUpperCase());
      const parsedPrice = Number(match?.regularMarketPrice);

      if (Number.isFinite(parsedPrice) && parsedPrice > 0) {
        priceRows.push({
          asset_id: asset.id,
          price: parsedPrice,
          currency: String(match?.currency || asset.currency || "USD").toUpperCase(),
          price_date: today,
          source: "yahoo",
        });
      } else {
        summary.skipped_missing_price += 1;
      }
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
