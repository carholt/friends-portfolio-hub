import { describe, expect, it } from "vitest";
import fixture from "./fixtures/nordea-transactions.csv?raw";
import { detectDelimiter, detectMapping, mapExchangeToPriceSymbol, parseDelimitedFile, parseNumberByLocale, recomputeAvgCost } from "@/lib/import-engine";

describe("import-engine", () => {
  it("detects semicolon delimiter", () => {
    expect(detectDelimiter(fixture)).toBe(";");
  });

  it("maps Nordea headers", () => {
    const parsed = parseDelimitedFile(fixture);
    const mapping = detectMapping(parsed.headers, parsed.sampleRows, parsed.delimiter);
    expect(mapping.broker_key).toBe("nordea");
    expect(mapping.kind).toBe("transactions");
    expect(mapping.columns.symbol).toBe("Ticker");
    expect(mapping.delimiter).toBe(";");
  });

  it("parses comma decimals", () => {
    expect(parseNumberByLocale("1 234,56", ",")).toBeCloseTo(1234.56, 2);
  });

  it("maps TSX and TSXV to canonical price symbols", () => {
    expect(mapExchangeToPriceSymbol("AYA", "Toronto Stock Exchange").price_symbol).toBe("AYA:TSX");
    expect(mapExchangeToPriceSymbol("AGX", "Toronto Venture Exchange").price_symbol).toBe("AGX:TSXV");
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
