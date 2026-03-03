import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseCSV, parseExcelImport, validateImportRows } from "@/lib/portfolio-utils";

describe("import parsing", () => {
  it("parses csv rows", () => {
    const rows = parseCSV('symbol,name,asset_type,exchange,quantity,avg_cost,cost_currency\nAAPL,Apple,stock,NASDAQ,2,120,USD');
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe("AAPL");
  });

  it("validates bad rows with specific errors", () => {
    const validated = validateImportRows([{ symbol: "", quantity: -1, avg_cost: -2, cost_currency: "X" }]);
    expect(validated[0].valid).toBe(false);
    expect(validated[0].errors.length).toBeGreaterThan(1);
  });

  it("parses Nordea Holdings Excel format", () => {
    const rows = [
      ["2026-03-03 21:51:02"],
      ["Type", "AccountKey", "ISIN", "CURRENCY", "NAME", "HOLDINGS", "PRICE", "Average purchase price", "Base currency"],
      ["CashAccount", "A1", null, "SEK", "Cash", null, null, null, "SEK"],
      ["Custody", "A1", "US0378331005", "USD", "Apple Inc", 3, 180, 125, "SEK"],
      ["Custody", "A1", null, "USD", "Invalid", 4, 10, 4, "SEK"],
      ["Custody", "A1", "SE0000000001", "SEK", "Zero Qty", 0, 10, 8, "SEK"],
    ];
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, "Holdings");

    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const parsed = parseExcelImport(buffer);

    expect(parsed.detectedNordea).toBe(true);
    expect(parsed.baseCurrency).toBe("SEK");
    expect(parsed.holdings).toHaveLength(1);
    expect(parsed.holdings[0]).toMatchObject({
      symbol: "US0378331005",
      name: "Apple Inc",
      quantity: 3,
      avg_cost: 125,
      cost_currency: "USD",
      metadata_json: { isin: "US0378331005" },
    });
  });
});
