import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

type ResolveImportSymbolInput = {
  symbol: string | null;
  broker: string | null;
  exchange: string | null;
  isin: string | null;
  name?: string | null;
};

type ResolveSymbolCandidate = {
  instrument_id: string | null;
  rank_priority: number;
  rank_score: number;
  canonical_symbol: string;
  price_symbol: string;
  exchange: string | null;
};

const normalize = (value: string | null | undefined) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

export async function resolveImportSymbol(
  adminClient: SupabaseClient,
  input: ResolveImportSymbolInput,
): Promise<string | null> {
  const symbol = normalize(input.symbol)?.toUpperCase();
  if (!symbol) {
    return null;
  }

  const broker = normalize(input.broker)?.toLowerCase() ?? null;
  const exchange = normalize(input.exchange)?.toUpperCase() ?? null;
  const isin = normalize(input.isin)?.toUpperCase() ?? null;
  const name = normalize(input.name) ?? null;

  const { data, error } = await adminClient.rpc("resolve_symbol_candidates", {
    _raw_symbol: symbol,
    _exchange: exchange,
    _broker: broker,
    _isin: isin,
  });

  if (error) {
    throw error;
  }

  const candidates = ((data ?? []) as ResolveSymbolCandidate[])
    .sort((a, b) => {
      if (a.rank_priority !== b.rank_priority) return a.rank_priority - b.rank_priority;
      return b.rank_score - a.rank_score;
    });

  const best = candidates[0];
  if (best?.instrument_id) {
    return best.instrument_id;
  }

  const now = new Date().toISOString();
  const { error: aliasError } = await adminClient
    .from("symbol_aliases")
    .insert({
      raw_symbol: symbol,
      exchange,
      canonical_symbol: symbol,
      price_symbol: symbol,
      instrument_id: null,
      broker,
      isin,
      asset_name_hint: name,
      confidence: 0.1,
      resolution_source: "auto",
      is_active: true,
      updated_at: now,
    });

  if (aliasError && (aliasError as { code?: string }).code !== "23505") {
    throw aliasError;
  }

  return null;
}
