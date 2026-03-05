import { describe, expect, it } from "vitest";
import { isCompanyAiReport } from "@/lib/company-ai-report";

describe("isCompanyAiReport", () => {
  it("accepts valid payload", () => {
    const payload = {
      ticker: "ABC",
      name: "ABC Mining",
      bucket: "Unclassified",
      type: "Producer",
      properties_ownership: "Unknown",
      management_team: "Unknown",
      share_structure: "Not disclosed",
      location: "Canada",
      projected_growth: "Unknown",
      market_buzz: "Mixed",
      cost_structure_financing: "Unknown",
      cash_debt_position: "Unknown",
      low_valuation_estimate: null,
      high_valuation_estimate: 15.2,
      projected_price: 10,
      investment_recommendation: "Hold",
      rating: "Neutral",
      rationale: "Not financial advice.",
      key_risks: ["Commodity volatility"],
      key_catalysts: ["New drill results"],
      last_updated: new Date().toISOString(),
      sources: [{ title: "Source", url: "https://example.com", snippet: "Data" }],
    };

    expect(isCompanyAiReport(payload)).toBe(true);
  });

  it("rejects invalid payload", () => {
    expect(isCompanyAiReport({ ticker: "ABC" })).toBe(false);
  });
});
