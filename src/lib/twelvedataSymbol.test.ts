import { describe, expect, it } from "vitest";

import { recommendPricingSymbol } from "./twelvedataSymbol";

describe("recommendPricingSymbol", () => {
  it("returns symbol without exchange when exact match has only one exchange", () => {
    const result = recommendPricingSymbol("aapl", [
      { symbol: "AAPL", exchange: "NASDAQ" },
      { symbol: "AA", exchange: "NYSE" },
    ]);

    expect(result).toEqual({
      symbol: "AAPL",
      pricingSymbol: "AAPL",
      exchange: "NASDAQ",
      exchangeRequired: false,
    });
  });

  it("returns symbol:exchange when multiple exchanges exist", () => {
    const result = recommendPricingSymbol("SHOP", [
      { symbol: "SHOP", exchange: "TSX" },
      { symbol: "SHOP", exchange: "NYSE" },
    ]);

    expect(result).toEqual({
      symbol: "SHOP",
      pricingSymbol: "SHOP:NYSE",
      exchange: "NYSE",
      exchangeRequired: true,
    });
  });

  it("returns null when no exact match exists", () => {
    const result = recommendPricingSymbol("MSFT", [
      { symbol: "MSFT.A", exchange: "NASDAQ" },
      { symbol: "MSTF", exchange: "NYSE" },
    ]);

    expect(result).toBeNull();
  });
});
