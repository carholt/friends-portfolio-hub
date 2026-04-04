const BATCH_URL = "https://hzcmnjpawiyxvscyzsto.supabase.co/functions/v1/resolve-isin-batch";
const MAX_BATCH_SIZE = 50;
const MAX_ISINS_PER_IMPORT = 100;

export interface ResolveIsinBatchRow {
  isin: string;
  ticker: string | null;
  exchange?: string | null;
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
  const res = await fetch(BATCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
      });
    }
  }

  return map;
}
