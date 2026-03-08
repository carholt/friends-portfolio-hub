import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260314090000_global_price_cache_and_symbol_overrides.sql"),
  "utf8",
);

describe("global price cache migration", () => {
  it("creates market instruments + prices schema", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.market_instruments");
    expect(sql).toContain("price_symbol TEXT NOT NULL UNIQUE");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.market_prices");
  });

  it("links assets to instruments and backfills from price_symbol", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS instrument_id UUID REFERENCES public.market_instruments");
    expect(sql).toContain("INSERT INTO public.market_instruments");
    expect(sql).toContain("UPDATE public.assets a");
  });

  it("adds resolve_symbol_candidates RPC with ranked deterministic order", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.resolve_symbol_candidates");
    expect(sql).toContain("WHEN sa.resolution_source = 'manual_override' THEN 1");
    expect(sql).toContain("ORDER BY rank_priority ASC, rank_score DESC");
  });
});
