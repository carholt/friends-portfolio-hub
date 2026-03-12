import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("portfolio leaderboard SQL", () => {
  const migrationsDir = resolve(process.cwd(), "supabase/migrations");
  const sql = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => readFileSync(resolve(migrationsDir, file), "utf8"))
    .join("\n");

  it("defines leaderboard view ordered by return percentage descending", () => {
    expect(sql).toContain("CREATE OR REPLACE VIEW public.portfolio_leaderboard AS");
    expect(sql).toContain("ORDER BY pl.return_pct DESC NULLS LAST, pl.total_value DESC");
  });

  it("exposes get_portfolio_leaderboard RPC with limit", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.get_portfolio_leaderboard");
    expect(sql).toContain("LIMIT GREATEST(COALESCE(\"limit\", 50), 1)");
  });
});
