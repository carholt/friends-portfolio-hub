import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("refresh_portfolio_valuations SQL", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260312120000_price_worker_valuation_cache_leaderboard.sql"),
    "utf8",
  );

  it("computes values and costs from holdings with latest prices", () => {
    expect(sql).toContain("JOIN latest_prices lp");
    expect(sql).toContain("(h.quantity * lp.price) AS position_value");
    expect(sql).toContain("(h.quantity * h.avg_cost) AS position_cost");
  });

  it("aggregates by portfolio and upserts totals", () => {
    expect(sql).toContain("GROUP BY portfolio_id");
    expect(sql).toContain("ON CONFLICT (portfolio_id, valuation_date)");
    expect(sql).toContain("total_return = EXCLUDED.total_return");
  });
});
