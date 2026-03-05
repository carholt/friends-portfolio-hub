import { describe, expect, it } from "vitest";
import { calculateHoldingWithFees } from "@/lib/transactions";

describe("rebuild_holdings math", () => {
  it("keeps average cost stable on sell and uses fees on buy", () => {
    const result = calculateHoldingWithFees([
      { type: "buy", quantity: 10, price: 100, fees: 10 },
      { type: "buy", quantity: 10, price: 200, fees: 0 },
      { type: "sell", quantity: 5, price: 300, fees: 5 },
    ]);

    expect(result.quantity).toBe(15);
    expect(result.avgCost).toBeCloseTo(150.5, 2);
  });
});
