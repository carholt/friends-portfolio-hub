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
const normalizeName = (value: string) => value
  .toUpperCase()
  .replace(/&/g, " AND ")
  .replace(/[^A-Z0-9\s]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

type CuratedSymbol = {
  symbol: string;
  exchange: string;
  company: string;
  aliases?: string[];
};

const CURATED_SYMBOLS: CuratedSymbol[] = [
  { symbol: "USA", exchange: "TSX", company: "Americas Gold & Silver", aliases: ["USAS", "AMERICAS GOLD SILVER"] },
  { symbol: "ASM", exchange: "TSX", company: "Avino Silver & Gold", aliases: ["AVINO SILVER"] },
  { symbol: "AYA", exchange: "TSX", company: "Aya Gold & Silver", aliases: ["AYA GOLD SILVER INC"] },
  { symbol: "CDE", exchange: "NYSE", company: "Coeur Mining" },
  { symbol: "EXK", exchange: "TSX", company: "Endeavour Silver" },
  { symbol: "AG", exchange: "NYSE", company: "First Majestic Silver", aliases: ["FIRST MAJESTIC"] },
  { symbol: "GIAG", exchange: "TSXV", company: "Guanajuato Silver", aliases: ["GUANAJUATO SILVER COMPANY", "GSVR"] },
  { symbol: "HL", exchange: "NYSE", company: "Hecla Mining", aliases: ["HE"] },
  { symbol: "JAG", exchange: "TSX", company: "Jaguar Mining" },
  { symbol: "PAAS", exchange: "TSX", company: "Pan American Silver" },
  { symbol: "AGX", exchange: "TSXV", company: "Silver X Mining", aliases: ["SILVER X MINING CORP"] },
  { symbol: "TSK", exchange: "TSXV", company: "Talisker Resources", aliases: ["TALISKER"] },
  { symbol: "ARIS", exchange: "TSX", company: "Aris Mining" },
  { symbol: "ARTG", exchange: "TSXV", company: "Artemis Gold" },
  { symbol: "BTO", exchange: "TSX", company: "B2Gold", aliases: ["BTG"] },
  { symbol: "CERT", exchange: "TSXV", company: "Cerrado Gold" },
  { symbol: "DMET", exchange: "TSXV", company: "Denarius Metals" },
  { symbol: "DSV", exchange: "TSX", company: "Discovery Silver" },
  { symbol: "EDV", exchange: "TSX", company: "Endeavour Mining" },
  { symbol: "EQX", exchange: "TSX", company: "Equinox Gold" },
  { symbol: "FRES", exchange: "LSE", company: "Fresnillo" },
  { symbol: "GAU", exchange: "TSX", company: "Galiano Gold" },
  { symbol: "GGD", exchange: "TSX", company: "Gogold Resources" },
  { symbol: "HOC", exchange: "LSE", company: "Hochschild Mining" },
  { symbol: "ITR", exchange: "TSXV", company: "Integra Resources" },
  { symbol: "SCZ", exchange: "TSXV", company: "Santacruz Silver", aliases: ["SOURTHERN SILVER", "SSV"] },
  { symbol: "VLT", exchange: "TSXV", company: "Vault Minerals" },
  { symbol: "WRLG", exchange: "TSXV", company: "West Red Lake Gold" },
  { symbol: "FVL", exchange: "TSXV", company: "Freegold Ventures" },
  { symbol: "AUMB", exchange: "TSXV", company: "1911 Gold", aliases: ["1911"] },
  { symbol: "LG", exchange: "TSXV", company: "Lahontan Gold", aliases: ["LG"] },
  { symbol: "NEXG", exchange: "CSE", company: "NexGold Mining", aliases: ["NEXGOLD MINING"] },
  { symbol: "PZG", exchange: "TSXV", company: "P2 Gold" },
  { symbol: "VZLA", exchange: "TSXV", company: "Vizsla Silver" },
  { symbol: "NOM", exchange: "TSXV", company: "Norsemont Mining" },
  { symbol: "RVG", exchange: "TSXV", company: "Revival Gold" },
  { symbol: "SVRS", exchange: "TSXV", company: "Silver Storm" },
  { symbol: "SLVR", exchange: "TSXV", company: "Silver Tiger" },
  { symbol: "SKE", exchange: "TSX", company: "Skeena Gold" },
  { symbol: "B", exchange: "NYSE", company: "Barrick Mining", aliases: ["BARRICK GOLD"] },
  { symbol: "KGC", exchange: "NYSE", company: "Kinross Gold" },
  { symbol: "NEM", exchange: "NYSE", company: "Newmont" },
];
const CURATED_ISIN_SYMBOLS: Record<string, { symbol: string; exchange: string; name?: string }> = {
  CA40066W1068: { symbol: "GWF", exchange: "TSX", name: "Great-West Lifeco" },
};

const micToExchange: Record<string, string> = {
  XNAS: "NASDAQ",
  XNYS: "NYSE",
  XASE: "AMEX",
  ARCX: "NYSEARCA",
  BATS: "BATS",
  XTSE: "TSX",
  XTSX: "TSXV",
  XSTO: "STO",
  XHEL: "HEL",
  XCSE: "CSE",
  XOSL: "OSL",
  XFRA: "FRA",
  XETR: "XETRA",
  XLON: "LSE",
};
const suggestionCache = new Map<string, { suggested: string; suggestions: Record<string, unknown>[] }>();
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

const normalizeSuggestions = (
  suggestions: Record<string, unknown>[],
  preferredExchange: string | null,
) => {
  const normalized = suggestions
    .slice(0, 12)
    .map((entry) => ({
      ...entry,
      exchange_code: exchangeFromSuggestion(entry),
    }));

  if (!preferredExchange) return normalized;

  return normalized.sort((a, b) => {
    const aExchange = normalizeExchange(String(a.exchange_code || ""));
    const bExchange = normalizeExchange(String(b.exchange_code || ""));
    const aMatch = aExchange === preferredExchange ? 1 : 0;
    const bMatch = bExchange === preferredExchange ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
    return 0;
  });
};

const scoreNameMatch = (needle: string, candidate: string) => {
  const n = normalizeName(needle);
  const c = normalizeName(candidate);
  if (!n || !c) return 0;
  if (n === c) return 100;
  if (c.includes(n) || n.includes(c)) return 85;
  const nTokens = n.split(" ").filter((token) => token.length > 1);
  const cTokens = new Set(c.split(" ").filter((token) => token.length > 1));
  if (nTokens.length === 0 || cTokens.size === 0) return 0;
  const overlap = nTokens.filter((token) => cTokens.has(token)).length;
  return Math.round((overlap / Math.max(nTokens.length, cTokens.size)) * 70);
};

const curatedMatchesByName = (name: string, preferredExchange: string | null) => {
  const needle = normalizeName(name);
  if (!needle) return [];
  const scored = CURATED_SYMBOLS.map((item) => {
    const names = [item.company, ...(item.aliases || [])];
    const bestScore = Math.max(...names.map((candidate) => scoreNameMatch(needle, candidate)));
    const preferredBonus = preferredExchange && normalizeExchange(item.exchange) === preferredExchange ? 30 : 0;
    return {
      symbol: item.symbol,
      name: item.company,
      exchange_code: item.exchange,
      score: bestScore + preferredBonus,
      source: "curated_catalog",
    };
  }).filter((item) => item.score >= 65)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  return scored;
};

async function suggestTicker(apiKey: string | null | undefined, isin: string, name: string, mic?: string | null) {
  const preferredExchange = normalizeExchange(mic ? micToExchange[normalize(mic)] || mic : null);
  const cacheKey = [isin, preferredExchange || "", normalize(name)].join("|");
  const cached = suggestionCache.get(cacheKey);
  if (cached) return cached;

  const curatedIsin = CURATED_ISIN_SYMBOLS[isin];
  if (curatedIsin) {
    const curatedByIsinResult = {
      suggested: providerSymbol(curatedIsin.symbol, curatedIsin.exchange),
      suggestions: [{ symbol: curatedIsin.symbol, exchange_code: curatedIsin.exchange, name: curatedIsin.name || name, score: 100, source: "curated_isin" }],
    };
    suggestionCache.set(cacheKey, curatedByIsinResult);
    return curatedByIsinResult;
  }

  const curatedMatches = curatedMatchesByName(name, preferredExchange);
  if (curatedMatches.length > 0) {
    const first = curatedMatches[0];
    const curatedResult = { suggested: providerSymbol(first.symbol, first.exchange_code), suggestions: curatedMatches.slice(0, 3) };
    suggestionCache.set(cacheKey, curatedResult);
    return curatedResult;
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service = createClient(supabaseUrl, serviceRoleKey);

  const { data: companyUniverse = [] } = await service
    .from("companies")
    .select("canonical_symbol,name,exchange")
    .limit(500);
  const localMatches = (companyUniverse || [])
    .map((company: Record<string, unknown>) => {
      const symbol = String(company.canonical_symbol || "").toUpperCase();
      const companyName = String(company.name || "");
      return {
        symbol,
        name: companyName,
        exchange_code: normalizeExchange(String(company.exchange || "")),
        score: scoreNameMatch(name, companyName),
      };
    })
    .filter((candidate) => candidate.symbol && candidate.score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (localMatches.length > 0) {
    const first = localMatches[0];
    const localResult = { suggested: providerSymbol(first.symbol, first.exchange_code), suggestions: localMatches };
    suggestionCache.set(cacheKey, localResult);
    return localResult;
  }

  if (!apiKey) {
    const emptyResult = { suggested: "", suggestions: [] as Record<string, unknown>[] };
    suggestionCache.set(cacheKey, emptyResult);
    return emptyResult;
  }

  const byIsin = await fetch(`https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(isin)}&apikey=${apiKey}`);
  const isinPayload = await byIsin.json();
  const isinData = Array.isArray(isinPayload?.data) ? isinPayload.data : [];
  if (isinData.length > 0) {
    const normalized = normalizeSuggestions(isinData, preferredExchange);
    const first = normalized[0];
    const isinResult = { suggested: providerSymbol(String(first.symbol || ""), String(first.exchange_code || "")), suggestions: normalized.slice(0, 3) };
    suggestionCache.set(cacheKey, isinResult);
    return isinResult;
  }

  const byName = await fetch(`https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(name)}&apikey=${apiKey}`);
  const namePayload = await byName.json();
  const nameData = Array.isArray(namePayload?.data) ? namePayload.data : [];
  const normalized = normalizeSuggestions(nameData, preferredExchange);
  const first = normalized[0];
  const nameResult = { suggested: providerSymbol(String(first?.symbol || ""), String(first?.exchange_code || "")), suggestions: normalized.slice(0, 3) };
  suggestionCache.set(cacheKey, nameResult);
  return nameResult;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const twelveKey = Deno.env.get("TWELVE_DATA_API_KEY") || "";

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
      const mic = String(payload.mic || "").trim();
      if (!isin) return new Response(JSON.stringify({ error: "isin required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const result = await suggestTicker(twelveKey, isin, name || isin, mic || null);
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
