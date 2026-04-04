import { supabase } from "@/integrations/supabase/client";

const RESOLVE_ISIN_URL = "https://hzcmnjpawiyxvscyzsto.supabase.co/functions/v1/resolve-isin";

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

  console.log("Resolving ISIN:", normalizedIsin);

  const promise = supabase.auth.getSession().then(async ({ data: { session } }) => {
    if (!session?.access_token) {
      return {
        isin: normalizedIsin,
        ticker: null,
        exchange: null,
        error: "Missing authenticated session for resolve-isin",
      };
    }

    return fetch(RESOLVE_ISIN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ isin: normalizedIsin }),
    }).then(async (res) => {
    const data = (await res.json().catch(() => ({}))) as Partial<ResolveIsinResponse>;
    if (!res.ok) {
      return {
        isin: normalizedIsin,
        ticker: null,
        exchange: null,
        error: String(data?.error || `resolve-isin failed: ${res.status}`),
      };
    }
      return {
        isin: String(data?.isin || normalizedIsin),
        ticker: data?.ticker ? String(data.ticker) : null,
        exchange: data?.exchange ? String(data.exchange) : null,
        error: data?.error ? String(data.error) : undefined,
      };
    });
  }).catch((error: unknown) => ({
    isin: normalizedIsin,
    ticker: null,
    exchange: null,
    error: error instanceof Error ? error.message : "lookup_failed",
  }));

  isinCache.set(normalizedIsin, promise);
  return promise;
}
