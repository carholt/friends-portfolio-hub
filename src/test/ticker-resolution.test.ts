import { describe, expect, it } from "vitest";
import { applyTickerResolutionsToRows, buildProviderSymbol, exchangeFromMic, extractTickerAndExchange, mergeHoldingsForAssetMigration, preserveIsinMetadata } from "@/lib/ticker-resolution";

describe("ticker resolution utilities", () => {
  it("merges duplicate holdings when resolving ISIN to ticker", () => {
    const result = mergeHoldingsForAssetMigration(
      [{ id: "h-isin", portfolio_id: "p1", asset_id: "a-isin", quantity: 2, avg_cost: 100 }],
      [{ id: "h-ticker", portfolio_id: "p1", asset_id: "a-ticker", quantity: 3, avg_cost: 200 }],
    );

    expect(result.toDelete).toEqual(["h-isin"]);
    expect(result.toUpdate[0]).toMatchObject({ id: "h-ticker", quantity: 5, avg_cost: 160 });
  });

  it("maintains holdings integrity for non-overlapping portfolios", () => {
    const result = mergeHoldingsForAssetMigration(
      [{ id: "h-isin", portfolio_id: "p2", asset_id: "a-isin", quantity: 4, avg_cost: 50 }],
      [{ id: "h-ticker", portfolio_id: "p1", asset_id: "a-ticker", quantity: 1, avg_cost: 10 }],
    );

    expect(result.toDelete).toHaveLength(0);
    expect(result.toUpdate[0]).toMatchObject({ id: "h-isin", asset_id: "TARGET", quantity: 4, avg_cost: 50 });
  });

  it("preserves metadata_json.isin when symbol changes to ticker", () => {
    const rows = applyTickerResolutionsToRows([
      { symbol: "CA40066W1068", metadata_json: { source: "nordea", isin: "CA40066W1068" } },
    ], { CA40066W1068: "GWF" });

    expect(rows[0].symbol).toBe("GWF");
    expect(preserveIsinMetadata(rows[0].metadata_json, "CA40066W1068")).toMatchObject({ isin: "CA40066W1068", source: "nordea" });
  });

  it("uses normalized ISIN matching and stores exchange separately from ticker", () => {
    const rows = applyTickerResolutionsToRows([
      { symbol: "ca40066w1068", metadata_json: { source: "nordea", isin: "ca40066w1068" } },
    ], { CA40066W1068: "gwf:tsx" });

    expect(rows[0].symbol).toBe("GWF");
    expect(rows[0].metadata_json).toMatchObject({ isin: "ca40066w1068", source: "nordea", exchange: "TSX" });
  });

  it("builds exchange-qualified symbols for Twelve Data when needed", () => {
    expect(exchangeFromMic("XTSE")).toBe("TSX");
    expect(exchangeFromMic("XNAS")).toBe("NASDAQ");
    expect(exchangeFromMic("XNYS")).toBe("NYSE");
    expect(buildProviderSymbol("PAAS", "tsx")).toBe("PAAS:TSX");
    expect(extractTickerAndExchange("ag:tsxv")).toEqual({ ticker: "AG", exchange: "TSXV" });
  });
});
