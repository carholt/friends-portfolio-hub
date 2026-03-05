import { describe, expect, it } from "vitest";
import { computeBucket } from "@/lib/bucket";

describe("computeBucket", () => {
  it("prefers manual override", () => {
    const result = computeBucket({ symbol: "NEM", bucket_override: "Custom" });
    expect(result.bucket_computed).toBe("Custom");
    expect(result.confidence).toBe(1);
  });

  it("uses seeded mapping exact then symbol-only", () => {
    const mapping = [
      { symbol: "NEM", exchange_code: "NYSE", bucket: "Major Producer" },
      { symbol: "NEM", bucket: "Fallback" },
    ];

    expect(computeBucket({ symbol: "NEM", exchange_code: "NYSE" }, undefined, mapping).confidence).toBe(0.95);
    expect(computeBucket({ symbol: "NEM", exchange_code: "TSX" }, undefined, mapping).confidence).toBe(0.85);
  });

  it("falls back to heuristics then unclassified", () => {
    expect(computeBucket({ symbol: "X" }, { marketCap: 12_000_000_000, revenue: 1 }).bucket_computed).toBe("Major Producer");
    expect(computeBucket({ symbol: "X" }, { revenue: 0, resourceEstimate: 1, stage: "early" }).bucket_computed).toBe("Explorer");
    expect(computeBucket({ symbol: "X" }).bucket_computed).toBe("Unclassified");
  });
});
