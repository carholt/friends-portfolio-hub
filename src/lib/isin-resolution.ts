import { supabase } from "@/integrations/supabase/client";

export interface ResolveIsinResponse {
  isin: string;
  ticker: string | null;
  exchange?: string | null;
  error?: string;
}

const isinCache = new Map<string, Promise<ResolveIsinResponse>>();

export async function resolveIsin(isin: string): Promise<ResolveIsinResponse> {
  const normalizedIsin = String(isin || "").trim().toUpperCase();
  if (!normalizedIsin) throw new Error("Missing isin");

  if (isinCache.has(normalizedIsin)) {
    return isinCache.get(normalizedIsin)!;
  }

  const promise = supabase
    .from("instrument_mappings")
    .select("ticker,exchange")
    .eq("isin", normalizedIsin)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) {
        return {
          isin: normalizedIsin,
          ticker: null,
          exchange: null,
          error: error.message || "local lookup failed",
        };
      }
      return {
        isin: normalizedIsin,
        ticker: data?.ticker ? String(data.ticker).toUpperCase() : null,
        exchange: data?.exchange ? String(data.exchange).toUpperCase() : null,
      };
    })
    .catch((error: unknown) => ({
      isin: normalizedIsin,
      ticker: null,
      exchange: null,
      error: error instanceof Error ? error.message : "lookup_failed",
    }));

  isinCache.set(normalizedIsin, promise);
  return promise;
}
