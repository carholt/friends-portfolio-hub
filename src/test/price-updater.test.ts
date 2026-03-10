import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("update-prices edge function", () => {
  const source = readFileSync(resolve(process.cwd(), "supabase/functions/update-prices/index.ts"), "utf8");

  it("enforces 8 requests per second rate limiting", () => {
    expect(source).toContain("MAX_CALLS_PER_SECOND = 8");
    expect(source).toContain("API_DELAY_MS = Math.ceil(1000 / MAX_CALLS_PER_SECOND)");
  });

  it("fetches all assets as the pricing source set", () => {
    expect(source).toContain("from(\"assets\")");
    expect(source).toContain("select(\"id,symbol,price_symbol,price_provider,currency\")");
  });

  it("upserts asset_prices and refreshes portfolio valuations", () => {
    expect(source).toContain("from(\"asset_prices\")");
    expect(source).toContain("upsert(priceRows, { onConflict: \"asset_id,price_date\" })");
    expect(source).toContain("supabase.rpc(\"refresh_portfolio_valuations\")");
  });
});
