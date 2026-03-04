import { describe, expect, it } from "vitest";
import { calculateHoldingFromTransactions } from "@/lib/transactions";

describe("transactions -> holdings calculations", () => {
  it("keeps weighted avg on buys and realizes pnl on sell", () => {
    const result = calculateHoldingFromTransactions([
      { type: "buy", quantity: 10, price: 100 },
      { type: "buy", quantity: 5, price: 200 },
      { type: "sell", quantity: -3, price: 250 },
    ]);

    expect(result.quantity).toBe(12);
    expect(result.avgCost).toBeCloseTo(133.333, 3);
    expect(result.realizedPl).toBeCloseTo(350, 2);
  });

  it("remove transaction closes holding", () => {
    const result = calculateHoldingFromTransactions([
      { type: "buy", quantity: 8, price: 50 },
      { type: "remove", quantity: -8 },
    ]);

    expect(result.quantity).toBe(0);
    expect(result.avgCost).toBe(0);
  });

  it("normalizes oversell to zero quantity without negative holdings", () => {
    const result = calculateHoldingFromTransactions([
      { type: "buy", quantity: 2, price: 12 },
      { type: "sell", quantity: -5, price: 10 },
    ]);

    expect(result.quantity).toBe(0);
    expect(result.avgCost).toBe(0);
  });
});
