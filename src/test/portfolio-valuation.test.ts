import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("global price valuation SQL", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260404000000_consolidated_schema.sql"),
    "utf8",
  );

  it("exposes asset_latest_prices view backed by market_prices", () => {
    expect(sql).toContain("CREATE OR REPLACE VIEW public.asset_latest_prices AS");
    expect(sql).toContain("FROM public.market_prices mp");
    expect(sql).toContain("ORDER BY mp.price_timestamp DESC");
  });

  it("refreshes valuations from asset_latest_prices", () => {
    expect(sql).toContain("FROM public.asset_latest_prices alp");
    expect(sql).toContain("JOIN latest_prices lp");
    expect(sql).toContain("ON CONFLICT (portfolio_id, valuation_date)");
  });
});
