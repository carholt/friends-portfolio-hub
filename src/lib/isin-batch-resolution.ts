import { supabase } from "@/integrations/supabase/client";

export interface ResolveIsinBatchRow {
  isin: string;
  ticker: string | null;
  exchange?: string | null;
  error?: string;
}

const BATCH_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/resolve-isin-batch`;

function normalizeIsin(isin: string) {
  return String(isin || "").trim().toUpperCase();
}

async function fetchIsinBatch(isins: string[]) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  if (!token) {
    throw new Error("No active session");
  }

  const res = await fetch(BATCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ isins }),
  });

  if (!res.ok) {
    throw new Error(`Batch resolve failed: ${res.status}`);
  }

  return await res.json() as { results?: ResolveIsinBatchRow[] };
}

export async function resolveIsins(isins: string[]) {
  const unique = Array.from(new Set(isins.map(normalizeIsin).filter(Boolean)));

  if (unique.length === 0) {
    return new Map<string, ResolveIsinBatchRow>();
  }

  const map = new Map<string, ResolveIsinBatchRow>();

  try {
    const payload = await fetchIsinBatch(unique);
    for (const row of payload.results || []) {
      const isin = normalizeIsin(row.isin);
      if (!isin) continue;
      map.set(isin, {
        isin,
        ticker: row.ticker ? String(row.ticker).toUpperCase() : null,
        exchange: row.exchange ? String(row.exchange).toUpperCase() : null,
        error: row.error,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "batch lookup failed";
    unique.forEach((isin) => {
      map.set(isin, { isin, ticker: null, exchange: null, error: message });
    });
    return map;
  }

  unique.forEach((isin) => {
    if (!map.has(isin)) {
      map.set(isin, { isin, ticker: null, exchange: null, error: "not_found" });
    }
  });

  return map;
}
