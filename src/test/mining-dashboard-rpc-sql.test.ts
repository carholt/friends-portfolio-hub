import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("get_portfolio_mining_dashboard SQL", () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260403120000_add_mining_dashboard_rpc_and_ticker_suggestion_fallbacks.sql"
    ),
    "utf8"
  );

  it("allows owners (and group members) to fetch dashboard payloads", () => {
    expect(sql).toContain("p.owner_user_id = auth.uid()");
    expect(sql).toContain("OR gm.user_id IS NOT NULL");
  });

  it("blocks non-owners with insufficient_privilege", () => {
    expect(sql).toContain("RAISE EXCEPTION 'Not allowed to view this portfolio dashboard'");
    expect(sql).toContain("ERRCODE = 'insufficient_privilege'");
  });


  it("qualifies portfolio_id in insights query to avoid ambiguity", () => {
    expect(sql).toContain("FROM public.mining_insights mi");
    expect(sql).toContain("WHERE mi.portfolio_id = get_portfolio_mining_dashboard.portfolio_id");
  });

  it("preserves service_role access", () => {
    expect(sql).toContain("auth.role() = 'service_role'");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.get_portfolio_mining_dashboard(UUID) TO authenticated, service_role;");
  });
});
