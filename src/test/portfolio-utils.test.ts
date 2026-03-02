import { describe, expect, it } from "vitest";
import { parseCSV, validateImportRows } from "@/lib/portfolio-utils";

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
});
