import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

type MarketInstrument = {
  id: string;
  canonical_symbol: string;
  exchange_code: string | null;
  price_symbol: string;
  provider: string;
  last_price_at: string | null;
};

type SymbolCandidate = {
  price_symbol: string;
  rank_priority: number;
  rank_score: number;
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
    const now = new Date();
    const nowIso = now.toISOString();
    const nowMs = now.getTime();

    const { data: instruments, error: instrumentsError } = await supabase
      .from("market_instruments")
      .select("id,canonical_symbol,exchange_code,price_symbol,provider,last_price_at")
      .eq("status", "active")
      .not("price_symbol", "is", null);

    if (instrumentsError) throw instrumentsError;

    const staleInstruments = ((instruments ?? []) as MarketInstrument[]).filter((instrument) => {
      if (!instrument.last_price_at) return true;
      return (nowMs - new Date(instrument.last_price_at).getTime()) > STALE_AFTER_MS;
    });

    const summary = {
      instruments_considered: (instruments ?? []).length,
      instruments_stale: staleInstruments.length,
      market_prices_inserted: 0,
      legacy_prices_upserted: 0,
      api_errors: 0,
      skipped_missing_price: 0,
    };

    if (staleInstruments.length === 0) {
      return new Response(JSON.stringify({ message: "No market instruments require updates", summary }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const symbolToInstruments = new Map<string, MarketInstrument[]>();

    for (const instrument of staleInstruments) {
      let resolvedSymbol = instrument.price_symbol;
      const { data: candidates, error: candidateError } = await supabase.rpc("resolve_symbol_candidates", {
        _raw_symbol: instrument.canonical_symbol,
        _exchange: instrument.exchange_code,
      });

      if (!candidateError && Array.isArray(candidates) && candidates.length > 0) {
        const best = [...(candidates as SymbolCandidate[])].sort((a, b) => {
          if (a.rank_priority !== b.rank_priority) return a.rank_priority - b.rank_priority;
          return b.rank_score - a.rank_score;
        })[0];
        if (best?.price_symbol) resolvedSymbol = best.price_symbol;
      }

      const arr = symbolToInstruments.get(resolvedSymbol) ?? [];
      arr.push(instrument);
      symbolToInstruments.set(resolvedSymbol, arr);
    }

    const marketPriceRows: Array<{
      instrument_id: string;
      price: number;
      currency: string;
      price_timestamp: string;
      source: string;
      raw_payload: Record<string, unknown>;
    }> = [];

    const updatedInstrumentIds = new Set<string>();

    const symbols = [...symbolToInstruments.keys()];

    for (let i = 0; i < symbols.length; i += 1) {
      const symbol = symbols[i];
      try {
        const response = await fetch(
          `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`,
        );
        const payload = await response.json() as { price?: string; currency?: string; status?: string };
        const parsedPrice = Number(payload.price);

        if (Number.isFinite(parsedPrice) && parsedPrice > 0) {
          for (const instrument of symbolToInstruments.get(symbol) ?? []) {
            marketPriceRows.push({
              instrument_id: instrument.id,
              price: parsedPrice,
              currency: (payload.currency || "USD").toUpperCase(),
              price_timestamp: nowIso,
              source: instrument.provider || "twelve_data",
              raw_payload: payload as unknown as Record<string, unknown>,
            });
            updatedInstrumentIds.add(instrument.id);
          }
        } else {
          summary.skipped_missing_price += 1;
        }
      } catch (_error) {
        summary.api_errors += 1;
      }

      if (i < symbols.length - 1) await sleep(API_DELAY_MS);
    }

    if (marketPriceRows.length > 0) {
      const { error: marketPriceError } = await supabase
        .from("market_prices")
        .insert(marketPriceRows);

      if (marketPriceError) throw marketPriceError;
      summary.market_prices_inserted = marketPriceRows.length;

      const { error: instrumentUpdateError } = await supabase
        .from("market_instruments")
        .update({ last_price_at: nowIso, updated_at: nowIso })
        .in("id", [...updatedInstrumentIds]);

      if (instrumentUpdateError) throw instrumentUpdateError;

      const { data: linkedAssets, error: linkedAssetsError } = await supabase
        .from("assets")
        .select("id,instrument_id")
        .in("instrument_id", [...updatedInstrumentIds]);

      if (linkedAssetsError) throw linkedAssetsError;

      const latestPriceByInstrument = new Map<string, (typeof marketPriceRows)[number]>();
      for (const row of marketPriceRows) {
        latestPriceByInstrument.set(row.instrument_id, row);
      }

      const legacyRows = (linkedAssets ?? []).flatMap((asset: { id: string; instrument_id: string | null }) => {
        if (!asset.instrument_id) return [];
        const latest = latestPriceByInstrument.get(asset.instrument_id);
        if (!latest) return [];
        const date = latest.price_timestamp.slice(0, 10);
        return [{
          asset_id: asset.id,
          price: latest.price,
          currency: latest.currency,
          as_of_date: date,
          price_date: date,
          source: latest.source,
        }];
      });

      if (legacyRows.length > 0) {
        const { error: legacyError } = await supabase
          .from("prices")
          .upsert(legacyRows, { onConflict: "asset_id,price_date" });
        if (legacyError) throw legacyError;
        summary.legacy_prices_upserted = legacyRows.length;
      }
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
