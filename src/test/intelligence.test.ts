import { describe, expect, it } from "vitest";
import { calculateIntelligence } from "@/lib/intelligence";

describe("portfolio intelligence calculations", () => {
  it("calculates upside roi and weight", () => {
    const result = calculateIntelligence({ shares: 10, avgCost: 50, currentPrice: 80, projectedPrice: 100, portfolioTotal: 2000 });
    expect(result.weight).toBeCloseTo(0.4, 3);
    expect(result.potentialUpside).toBeCloseTo(0.25, 3);
    expect(result.roi).toBeCloseTo(0.6, 3);
  });

  it("marks unpriced when current price missing", () => {
    const result = calculateIntelligence({ shares: 10, avgCost: 50, currentPrice: null, projectedPrice: 100, portfolioTotal: 2000 });
    expect(result.unpriced).toBe(true);
    expect(result.weight).toBeNull();
  });
});
