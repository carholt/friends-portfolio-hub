import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { detectNordeaHoldingsFormat, groupNordeaHoldingsByAccount, parseCSV, parseExcelImport, validateImportRows } from "@/lib/portfolio-utils";

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

  it("detects Nordea holdings format by Holdings sheet + required headers", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["2026-03-03 21:51:02"],
      ["Type", "AccountKey", "ISIN", "CURRENCY"],
      ["Custody", "A1", "US0378331005", "USD"],
    ]);

    XLSX.utils.book_append_sheet(workbook, sheet, "Holdings");
    expect(detectNordeaHoldingsFormat(workbook)).toBe(true);
  });

  it("parses Nordea Holdings Excel format and maps ISIN to symbol/metadata", () => {
    const rows = [
      ["2026-03-03 21:51:02"],
      ["Type", "AccountKey", "Account", "ISIN", "CURRENCY", "NAME", "HOLDINGS", "PRICE", "Average purchase price", "Base currency", "MIC"],
      ["CashAccount", "A1", "Main", null, "SEK", "Cash", null, null, null, "SEK", null],
      ["Custody", "A1", "Main", "US0378331005", "USD", "Apple Inc", 3, 180, 125, "SEK", "XNAS"],
      ["Custody", "A1", "Main", null, "USD", "Invalid", 4, 10, 4, "SEK", null],
      ["Custody", "A1", "Main", "SE0000000001", "SEK", "Zero Qty", 0, 10, 8, "SEK", null],
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
      account_key: "A1",
      name: "Apple Inc",
      quantity: 3,
      avg_cost: 125,
      cost_currency: "USD",
      metadata_json: { isin: "US0378331005", mic: "XNAS", source: "nordea" },
    });
  });

  it("groups Nordea custody rows by AccountKey", () => {
    const groups = groupNordeaHoldingsByAccount([
      { Type: "Custody", AccountKey: "A1", Account: "Main", ISIN: "US0378331005", NAME: "Apple", HOLDINGS: 3, PRICE: 180, "Base currency": "SEK" },
      { Type: "Custody", AccountKey: "A1", Account: "Main", ISIN: "SE0000103699", NAME: "Hexagon", HOLDINGS: 5, PRICE: 100, "Base currency": "SEK" },
      { Type: "Custody", AccountKey: "A2", Account: "Pension", ISIN: "FI0009000681", NAME: "Nokia", HOLDINGS: 7, PRICE: 40, "Base currency": "SEK" },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.accountKey === "A1")).toMatchObject({
      accountName: "Main",
      holdingsCount: 2,
      marketValueBase: 1040,
    });
  });
});
