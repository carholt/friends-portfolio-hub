import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("update-prices edge function", () => {
  const source = readFileSync(resolve(process.cwd(), "supabase/functions/update-prices/index.ts"), "utf8");

  it("uses Yahoo quote endpoint with batched requests", () => {
    expect(source).toContain("query1.finance.yahoo.com/v7/finance/quote");
    expect(source).toContain("YAHOO_BATCH_SIZE = 50");
  });

  it("fetches assets including exchange for symbol normalization", () => {
    expect(source).toContain("from(\"assets\")");
    expect(source).toContain("select(\"id,symbol,price_symbol,price_provider,currency,exchange\")");
    expect(source).toContain("normalizeYahooSymbol(");
  });

  it("upserts asset_prices and refreshes portfolio valuations", () => {
    expect(source).toContain("from(\"asset_prices\")");
    expect(source).toContain("upsert(priceRows, { onConflict: \"asset_id,price_date\" })");
    expect(source).toContain("supabase.rpc(\"refresh_portfolio_valuations\")");
  });
});
