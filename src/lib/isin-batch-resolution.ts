import { supabase } from "@/integrations/supabase/client";

export interface ResolveIsinBatchRow {
  isin: string;
  ticker: string | null;
  exchange?: string | null;
  error?: string;
}

function normalizeIsin(isin: string) {
  return String(isin || "").trim().toUpperCase();
}

export async function resolveIsins(isins: string[]) {
  const unique = Array.from(new Set(isins.map(normalizeIsin).filter(Boolean)));

  if (unique.length === 0) {
    return new Map<string, ResolveIsinBatchRow>();
  }

  const { data, error } = await supabase
    .from("instrument_mappings")
    .select("isin,ticker,exchange")
    .in("isin", unique);

  const map = new Map<string, ResolveIsinBatchRow>();
  if (error) {
    unique.forEach((isin) => {
      map.set(isin, { isin, ticker: null, exchange: null, error: error.message || "local lookup failed" });
    });
    return map;
  }

  (data || []).forEach((row: any) => {
    const isin = normalizeIsin(row?.isin);
    if (!isin) return;
    map.set(isin, {
      isin,
      ticker: row?.ticker ? String(row.ticker).toUpperCase() : null,
      exchange: row?.exchange ? String(row.exchange).toUpperCase() : null,
    });
  });

  unique.forEach((isin) => {
    if (!map.has(isin)) {
      map.set(isin, { isin, ticker: null, exchange: null, error: "not_found" });
    }
  });

  return map;
}
