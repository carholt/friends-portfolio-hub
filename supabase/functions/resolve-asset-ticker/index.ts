import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Resolution = {
  isin: string;
  ticker: string;
  name?: string;
  mic?: string;
  currency?: string;
  exchange?: string;
};

const normalize = (v: string) => v.trim().toUpperCase();
const normalizeExchange = (v?: string | null) => (v || "").trim().toUpperCase() || null;
const micToExchange: Record<string, string> = { XTSE: "TSX", XTSX: "TSXV" };
const providerSymbol = (ticker: string, exchange?: string | null) => {
  const cleanExchange = normalizeExchange(exchange);
  return cleanExchange ? `${normalize(ticker)}:${cleanExchange}` : normalize(ticker);
};

const exchangeFromSuggestion = (item: Record<string, unknown>) => {
  const explicit = normalizeExchange(String(item.exchange || item.exchange_code || ""));
  if (explicit) return explicit;
  const mic = normalizeExchange(String(item.mic_code || item.mic || ""));
  if (mic && micToExchange[mic]) return micToExchange[mic];
  return mic;
};

async function suggestTicker(apiKey: string, isin: string, name: string) {
  const byIsin = await fetch(`https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(isin)}&apikey=${apiKey}`);
  const isinPayload = await byIsin.json();
  const isinData = Array.isArray(isinPayload?.data) ? isinPayload.data : [];
  if (isinData.length > 0) {
    const normalized = isinData.slice(0, 6).map((entry: Record<string, unknown>) => ({
      ...entry,
      exchange_code: exchangeFromSuggestion(entry),
    }));
    const first = normalized[0];
    return { suggested: providerSymbol(String(first.symbol || ""), String(first.exchange_code || "")), suggestions: normalized.slice(0, 3) };
  }

  const byName = await fetch(`https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(name)}&apikey=${apiKey}`);
  const namePayload = await byName.json();
  const nameData = Array.isArray(namePayload?.data) ? namePayload.data : [];
  const normalized = nameData.slice(0, 6).map((entry: Record<string, unknown>) => ({
    ...entry,
    exchange_code: exchangeFromSuggestion(entry),
  }));
  const first = normalized[0];
  return { suggested: providerSymbol(String(first?.symbol || ""), String(first?.exchange_code || "")), suggestions: normalized.slice(0, 3) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const twelveKey = Deno.env.get("TWELVE_DATA_API_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: authData } = await userClient.auth.getUser();
    const user = authData.user;
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const payload = await req.json();
    if (payload.mode === "suggest") {
      const isin = normalize(String(payload.isin || ""));
      const name = String(payload.name || "").trim();
      if (!isin) return new Response(JSON.stringify({ error: "isin required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const result = await suggestTicker(twelveKey, isin, name || isin);
      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const service = createClient(supabaseUrl, serviceRoleKey);
    const resolutions: Resolution[] = Array.isArray(payload.resolutions) ? payload.resolutions : [];
    const results: Array<{ isin: string; ticker: string; asset_id: string }> = [];

    for (const item of resolutions) {
      const isin = normalize(item.isin || "");
      const ticker = normalize(item.ticker || "");
      const exchange = normalizeExchange(item.exchange || null) || normalizeExchange(item.mic ? micToExchange[normalize(item.mic)] || item.mic : null);
      const resolvedProviderSymbol = providerSymbol(ticker, exchange);
      if (!isin || !ticker) continue;

      const { data: sourceAsset } = await service.from("assets").select("id,symbol,name,asset_type,currency,exchange,metadata_json").eq("symbol", isin).maybeSingle();
      const { data: targetAssetExisting } = await service.from("assets").select("id,symbol,metadata_json").eq("symbol", ticker).maybeSingle();

      let targetAssetId = targetAssetExisting?.id as string | undefined;

      if (!targetAssetId && sourceAsset) {
        const { data: sourceHoldings = [] } = await service
          .from("holdings")
          .select("id,portfolio_id")
          .eq("asset_id", sourceAsset.id);
        const portfolioIds = [...new Set(sourceHoldings.map((h) => h.portfolio_id))];
        let canRename = true;
        if (portfolioIds.length > 0) {
          const { data: owners = [] } = await service.from("portfolios").select("id,owner_user_id").in("id", portfolioIds);
          canRename = owners.every((p) => p.owner_user_id === user.id);
        }

        if (canRename) {
          const mergedMetadata = {
            ...(sourceAsset.metadata_json || {}),
            isin,
            source: "nordea",
            provider_symbol: resolvedProviderSymbol,
            ...(item.mic ? { mic: normalize(item.mic) } : {}),
            ...(exchange ? { exchange_code: exchange } : {}),
          };
          const { data: updated } = await service
            .from("assets")
            .update({ symbol: ticker, exchange: exchange || sourceAsset.exchange || null, metadata_json: mergedMetadata, name: item.name || sourceAsset.name })
            .eq("id", sourceAsset.id)
            .select("id")
            .single();
          targetAssetId = updated?.id;
        }
      }

      if (!targetAssetId) {
        const baseMetadata = {
          isin,
          source: "nordea",
          provider_symbol: resolvedProviderSymbol,
          ...(item.mic ? { mic: normalize(item.mic) } : {}),
          ...(exchange ? { exchange_code: exchange } : {}),
        };
        const { data: created } = await service.from("assets").insert({
          symbol: ticker,
          name: item.name || ticker,
          asset_type: sourceAsset?.asset_type || "stock",
          currency: item.currency || sourceAsset?.currency || "USD",
          exchange: exchange || sourceAsset?.exchange || null,
          metadata_json: baseMetadata,
        }).select("id").single();
        targetAssetId = created?.id;
      }

      if (sourceAsset && targetAssetId && sourceAsset.id !== targetAssetId) {
        const { data: sourceHoldings = [] } = await service.from("holdings").select("id,portfolio_id,quantity,avg_cost,cost_currency").eq("asset_id", sourceAsset.id);

        for (const holding of sourceHoldings) {
          const { data: owner } = await service.from("portfolios").select("owner_user_id").eq("id", holding.portfolio_id).single();
          if (owner?.owner_user_id !== user.id) continue;

          const { data: targetHolding } = await service.from("holdings").select("id,quantity,avg_cost").eq("portfolio_id", holding.portfolio_id).eq("asset_id", targetAssetId).maybeSingle();
          if (targetHolding) {
            const qty = Number(targetHolding.quantity) + Number(holding.quantity);
            const avg = qty > 0 ? ((Number(targetHolding.quantity) * Number(targetHolding.avg_cost)) + (Number(holding.quantity) * Number(holding.avg_cost))) / qty : 0;
            await service.from("holdings").update({ quantity: qty, avg_cost: avg }).eq("id", targetHolding.id);
            await service.from("holdings").delete().eq("id", holding.id);
          } else {
            await service.from("holdings").update({ asset_id: targetAssetId }).eq("id", holding.id);
          }
        }

        const { count } = await service.from("holdings").select("id", { count: "exact", head: true }).eq("asset_id", sourceAsset.id);
        if ((count || 0) === 0) {
          await service.from("assets").delete().eq("id", sourceAsset.id);
        }
      }

      if (targetAssetId) {
        results.push({ isin, ticker, asset_id: targetAssetId });
      }
    }

    return new Response(JSON.stringify({ resolved: results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
