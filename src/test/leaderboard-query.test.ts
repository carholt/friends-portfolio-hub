import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("portfolio leaderboard SQL", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260312120000_price_worker_valuation_cache_leaderboard.sql"),
    "utf8",
  );

  it("defines leaderboard view ordered by return percentage descending", () => {
    expect(sql).toContain("CREATE OR REPLACE VIEW public.portfolio_leaderboard AS");
    expect(sql).toContain("ORDER BY return_pct DESC NULLS LAST");
  });

  it("exposes get_portfolio_leaderboard RPC with limit", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.get_portfolio_leaderboard");
    expect(sql).toContain("LIMIT GREATEST(COALESCE(\"limit\", 50), 1)");
  });
});
