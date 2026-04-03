import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("import_transactions_batch SQL", () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260404000000_consolidated_schema.sql"
    ),
    "utf8"
  );

  it("dedupes duplicate rows within a batch", () => {
    expect(sql).toContain("row_number() OVER (");
    expect(sql).toContain("WHERE ranked.rn > 1");
  });

  it("has ON CONFLICT upsert path for trade_id rows", () => {
    expect(sql).toContain("ON CONFLICT (portfolio_id, broker, trade_id)");
  });

  it("has ON CONFLICT upsert path for stable_hash fallback rows", () => {
    expect(sql).toContain("ON CONFLICT (portfolio_id, broker, stable_hash)");
  });

  it("rebuilds holdings once after import", () => {
    expect(sql).toContain("PERFORM public.rebuild_holdings(_portfolio_id);");
  });
});
