import { describe, expect, it } from "vitest";
import { applyImportResolution, isExchangeAsSymbol, pickBestCandidate } from "@/lib/symbol-resolution";

describe("symbol resolution helpers", () => {
  it("detects exchange-as-symbol values", () => {
    expect(isExchangeAsSymbol("TSXV")).toBe(true);
    expect(isExchangeAsSymbol("tsx")).toBe(true);
    expect(isExchangeAsSymbol("AAPL")).toBe(false);
  });

  it("scores and selects a clear winner", () => {
    const result = pickBestCandidate([
      { price_symbol: "SSV:TSXV", exchange_code: "TSXV", name: "Silver", currency: "CAD", score: 94, provider: "twelve_data" },
      { price_symbol: "SSV:NYSE", exchange_code: "NYSE", name: "Something", currency: "USD", score: 70, provider: "twelve_data" },
    ]);

    expect(result.status).toBe("resolved");
    expect(result.candidate?.price_symbol).toBe("SSV:TSXV");
  });

  it("marks import preview rows ambiguous/invalid/resolved", () => {
    expect(applyImportResolution("TSXV", []).status).toBe("invalid");
    expect(applyImportResolution("SSV", [
      { price_symbol: "SSV:TSXV", exchange_code: "TSXV", name: "Silver", currency: "CAD", score: 83, provider: "twelve_data" },
      { price_symbol: "SSV:NYSE", exchange_code: "NYSE", name: "Other", currency: "USD", score: 80, provider: "twelve_data" },
    ]).status).toBe("ambiguous");
    expect(applyImportResolution("GRSL", [
      { price_symbol: "GRSL:TSX", exchange_code: "TSX", name: "Green", currency: "CAD", score: 93, provider: "twelve_data" },
    ]).status).toBe("resolved");
  });
});
