import { supabase } from './supabaseClient'; // make sure your Supabase client import is correct

const BATCH_URL = "https://hzcmnjpawiyxvscyzsto.supabase.co/functions/v1/resolve-isin-batch";
const MAX_BATCH_SIZE = 50;
const MAX_ISINS_PER_IMPORT = 100;

export interface ResolveIsinBatchRow {
  isin: string;
  ticker: string | null;
  exchange?: string | null;
  error?: string;
}

function normalizeIsin(isin: string) {
  return String(isin || "").trim().toUpperCase();
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchIsinBatch(isins: string[]) {
  const { data: sessionData } = await supabase.auth.getSession();

  if (!sessionData?.session) {
    throw new Error("No active Supabase session available for ISIN batch resolve");
  }

  const token = sessionData.session.access_token;

  const res = await fetch(BATCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "apikey": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "" // or your server key if needed
    },
    body: JSON.stringify({ isins }),
  });

  if (!res.ok) {
    throw new Error(`Batch resolve failed: ${res.status}`);
  }

  const data = (await res.json()) as ResolveIsinBatchRow[];
  return Array.isArray(data) ? data : [];
}

export async function resolveIsins(isins: string[]) {
  const unique = Array.from(new Set(isins.map(normalizeIsin).filter(Boolean)));

  if (unique.length === 0) {
    return new Map<string, ResolveIsinBatchRow>();
  }

  const effectiveChunkSize = unique.length > MAX_ISINS_PER_IMPORT ? MAX_BATCH_SIZE : MAX_ISINS_PER_IMPORT;
  const batches = chunk(unique, effectiveChunkSize);

  const responses = await Promise.all(batches.map((batch) => fetchIsinBatch(batch)));

  const map = new Map<string, ResolveIsinBatchRow>();
  for (const batchRows of responses) {
    for (const row of batchRows) {
      map.set(normalizeIsin(row.isin), {
        isin: normalizeIsin(row.isin),
        ticker: row?.ticker ? String(row.ticker) : null,
        exchange: row?.exchange ? String(row.exchange) : null,
        error: row?.error ? String(row.error) : undefined,
      });
    }
  }

  return map;
}
