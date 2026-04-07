import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type MarketInstrument = {
  id: string;
  price_symbol: string;
  currency: string | null;
  provider: string | null;
};

type PriceResponse = {
  price?: string;
  currency?: string;
  status?: string;
  code?: number;
  message?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 50;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPriceWithRetry(apiKey: string, priceSymbol: string): Promise<PriceResponse> {
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      const response = await fetch(
        `https://api.twelvedata.com/price?symbol=${encodeURIComponent(priceSymbol)}&apikey=${apiKey}`,
      );

      if (!response.ok) {
        throw new Error(`Provider HTTP ${response.status}`);
      }

      return await response.json() as PriceResponse;
    } catch (error) {
      attempt += 1;
      if (attempt >= MAX_RETRIES) {
        throw error;
      }
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }

  throw new Error("retry loop exhausted");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const twelveDataApiKey = Deno.env.get("TWELVE_DATA_API_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Supabase env vars missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!twelveDataApiKey) {
      return new Response(JSON.stringify({ error: "TWELVE_DATA_API_KEY not configured" }), {
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

      for (const instrument of batch) {
        try {
          const payload = await fetchPriceWithRetry(twelveDataApiKey, instrument.price_symbol);
          const parsedPrice = Number(payload.price);

          if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
            summary.skipped_invalid_price += 1;
            continue;
          }

          upserts.push({
            instrument_id: instrument.id,
            price: parsedPrice,
            currency: (payload.currency ?? instrument.currency ?? "USD").toUpperCase(),
            price_timestamp: new Date().toISOString(),
            source: instrument.provider ?? "twelve_data",
            updated_at: new Date().toISOString(),
          });
        } catch {
          summary.provider_errors += 1;
        }
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
