import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPreviewRows, buildProviderSymbol, detectBrokerByHeaders, mapNordeaExchange, parseCsvRows } from "@/lib/transaction-import";
import { calculateHoldingWithFees } from "@/lib/transactions";
import { detectMapping } from "@/lib/import-engine";

describe("Nordea transaction import parsing", () => {
  const fixture = readFileSync(resolve(process.cwd(), "src/test/fixtures/nordea-transactions.csv"), "utf8");

  it("parses nordea fixture and extracts symbols", () => {
    const rows = parseCsvRows(fixture);
    expect(detectBrokerByHeaders(rows)).toBe("nordea");
    const mapping = detectMapping(Object.keys(rows[0]), rows as Record<string, string>[]);
    const preview = buildPreviewRows(rows, mapping);

    expect(preview).toHaveLength(2);
    expect(preview.map((row) => row.tx.symbol_raw)).toEqual(["AYA", "AYA"]);
    expect(preview.every((row) => row.errors.length === 0)).toBe(true);
  });

  it("maps TSX/TSXV and provider symbol suffixes", () => {
    expect(mapNordeaExchange("Toronto Stock Exchange")).toEqual({ exchange_code: "TSX", suffix: ".TO" });
    expect(mapNordeaExchange("Toronto Venture Exchange")).toEqual({ exchange_code: "TSXV", suffix: ".V" });
    expect(buildProviderSymbol("AYA", "TSX")).toBe("AYA.TO");
    expect(buildProviderSymbol("AUMB", "TSXV")).toBe("AUMB.V");
  });

  it("computes holdings average cost from buy/sell ledger", () => {
    const result = calculateHoldingWithFees([
      { type: "buy", quantity: 100, price: 1.25, fees: 29 },
      { type: "buy", quantity: 50, price: 10.5, fees: 19 },
      { type: "sell", quantity: 20, price: 12, fees: 15 },
    ]);

    expect(result.quantity).toBe(130);
    expect(result.avgCost).toBeCloseTo(4.6533, 3);
  });
});
