import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type MarketInstrument = {
  id: string;
  price_symbol: string;
  currency: string | null;
  provider: string | null;
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

const BATCH_SIZE = 50;
const YAHOO_QUOTE_ENDPOINT = "https://query1.finance.yahoo.com/v7/finance/quote";

async function fetchYahooQuotes(symbols: string[]): Promise<Map<string, YahooQuote>> {
  if (symbols.length === 0) return new Map();

  const response = await fetch(`${YAHOO_QUOTE_ENDPOINT}?symbols=${encodeURIComponent(symbols.join(","))}`);
  if (!response.ok) {
    throw new Error(`Yahoo HTTP ${response.status}`);
  }

  const payload = await response.json() as {
    quoteResponse?: {
      result?: YahooQuote[];
    };
  };

  const quoteMap = new Map<string, YahooQuote>();
  for (const item of payload.quoteResponse?.result ?? []) {
    const symbol = String(item.symbol || "").toUpperCase().trim();
    if (symbol) quoteMap.set(symbol, item);
  }

  return quoteMap;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Supabase env vars missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: instruments, error: instrumentsError } = await adminClient
      .from("market_instruments")
      .select("id,price_symbol,currency,provider")
      .eq("is_active", true)
      .not("price_symbol", "is", null);

    if (instrumentsError) {
      throw instrumentsError;
    }

    const allInstruments = (instruments ?? []) as MarketInstrument[];

    const summary = {
      instruments_considered: allInstruments.length,
      prices_updated: 0,
      provider_errors: 0,
      skipped_invalid_price: 0,
    };

    for (let offset = 0; offset < allInstruments.length; offset += BATCH_SIZE) {
      const batch = allInstruments.slice(offset, offset + BATCH_SIZE);
      const upserts: Array<{
        instrument_id: string;
        price: number;
        currency: string;
        price_timestamp: string;
        source: string;
        updated_at: string;
      }> = [];

      const symbolMap = new Map(batch.map((instrument) => [instrument.id, instrument.price_symbol.toUpperCase().trim()]));
      const symbols = Array.from(new Set(Array.from(symbolMap.values()).filter(Boolean)));

      try {
        const quoteBySymbol = await fetchYahooQuotes(symbols);

        for (const instrument of batch) {
          const symbol = symbolMap.get(instrument.id) || "";
          const payload = quoteBySymbol.get(symbol);
          const parsedPrice = Number(payload?.regularMarketPrice);

          if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
            summary.skipped_invalid_price += 1;
            continue;
          }

          upserts.push({
            instrument_id: instrument.id,
            price: parsedPrice,
            currency: String(payload?.currency || instrument.currency || "USD").toUpperCase(),
            price_timestamp: new Date().toISOString(),
            source: instrument.provider ?? "yahoo",
            updated_at: new Date().toISOString(),
          });
        }
      } catch {
        summary.provider_errors += 1;
      }

      if (upserts.length > 0) {
        const { error: upsertError } = await adminClient
          .from("market_prices")
          .upsert(upserts, {
            onConflict: "instrument_id",
            ignoreDuplicates: false,
          });

        if (upsertError) {
          throw upsertError;
        }

        summary.prices_updated += upserts.length;
      }
    }

    return new Response(JSON.stringify({ ok: true, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
