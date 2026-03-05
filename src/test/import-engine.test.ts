import { describe, expect, it } from "vitest";
import fixture from "./fixtures/nordea-transactions.csv?raw";
import { detectDelimiter, detectMapping, mapExchangeToProviderSymbol, parseDelimitedFile, parseNumberByLocale, recomputeAvgCost } from "@/lib/import-engine";

describe("import-engine", () => {
  it("detects semicolon delimiter", () => {
    expect(detectDelimiter(fixture)).toBe(";");
  });

  it("maps Nordea headers", () => {
    const parsed = parseDelimitedFile(fixture);
    const mapping = detectMapping(parsed.headers, parsed.sampleRows);
    expect(mapping.broker_key).toBe("nordea");
    expect(mapping.kind).toBe("transactions");
    expect(mapping.columns.symbol).toBe("Ticker");
  });

  it("parses comma decimals", () => {
    expect(parseNumberByLocale("1 234,56", ",")).toBeCloseTo(1234.56, 2);
  });

  it("maps TSX and TSXV to provider symbols", () => {
    expect(mapExchangeToProviderSymbol("AYA", "Toronto Stock Exchange").provider_symbol).toBe("AYA.TO");
    expect(mapExchangeToProviderSymbol("AGX", "Toronto Venture Exchange").provider_symbol).toBe("AGX.V");
  });

  it("recomputes avg cost correctly", () => {
    const result = recomputeAvgCost([
      { trade_type: "buy", quantity: 10, price: 100, fees: 0 },
      { trade_type: "buy", quantity: 10, price: 200, fees: 0 },
      { trade_type: "sell", quantity: 5, price: 210, fees: 0 },
    ]);
    expect(result.quantity).toBe(15);
    expect(result.avg_cost).toBeCloseTo(150, 4);
  });
});
