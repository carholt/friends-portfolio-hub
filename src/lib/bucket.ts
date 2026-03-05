export interface BucketAsset {
  symbol?: string | null;
  exchange_code?: string | null;
  bucket_override?: string | null;
}

export interface BucketFundamentals {
  marketCap?: number | null;
  revenue?: number | null;
  resourceEstimate?: number | null;
  stage?: string | null;
}

export interface BucketMapEntry {
  symbol: string;
  exchange_code?: string | null;
  bucket: string;
}

export interface BucketComputationResult {
  bucket_computed: string;
  confidence: number;
  reason: string;
}

const normalize = (value?: string | null) => (value || "").trim().toUpperCase();

export function computeBucket(
  asset: BucketAsset,
  fundamentals?: BucketFundamentals,
  mapping: BucketMapEntry[] = [],
): BucketComputationResult {
  const override = (asset.bucket_override || "").trim();
  if (override) {
    return { bucket_computed: override, confidence: 1, reason: "Manual override" };
  }

  const symbol = normalize(asset.symbol);
  const exchangeCode = normalize(asset.exchange_code);

  const exact = mapping.find((entry) => normalize(entry.symbol) === symbol && normalize(entry.exchange_code) === exchangeCode);
  if (exact) {
    return { bucket_computed: exact.bucket, confidence: 0.95, reason: "Seeded mapping (symbol + exchange)" };
  }

  const symbolOnly = mapping.find((entry) => normalize(entry.symbol) === symbol && !normalize(entry.exchange_code));
  if (symbolOnly) {
    return { bucket_computed: symbolOnly.bucket, confidence: 0.85, reason: "Seeded mapping (symbol only)" };
  }

  const marketCap = fundamentals?.marketCap ?? null;
  const revenue = fundamentals?.revenue ?? null;
  const resourceEstimate = fundamentals?.resourceEstimate ?? null;
  const stage = (fundamentals?.stage || "").toLowerCase();

  if (marketCap != null && revenue != null && revenue > 0) {
    if (marketCap >= 10_000_000_000) {
      return { bucket_computed: "Major Producer", confidence: 0.7, reason: "Heuristic: market cap >= 10B and revenue > 0" };
    }
    if (marketCap >= 2_000_000_000) {
      return { bucket_computed: "Mid Tier Producer", confidence: 0.65, reason: "Heuristic: market cap 2B..10B and revenue > 0" };
    }
    return { bucket_computed: "Junior Producer", confidence: 0.6, reason: "Heuristic: market cap < 2B and revenue > 0" };
  }

  if (revenue === 0 && resourceEstimate != null) {
    if (/(construction|near term|development|developer|late stage|feasibility)/.test(stage)) {
      return { bucket_computed: "Developer", confidence: 0.55, reason: "Heuristic: revenue = 0 with resource estimate and development stage" };
    }

    return { bucket_computed: "Explorer", confidence: 0.5, reason: "Heuristic: revenue = 0 with resource estimate and no development stage" };
  }

  return { bucket_computed: "Unclassified", confidence: 0.2, reason: "Insufficient data" };
}
