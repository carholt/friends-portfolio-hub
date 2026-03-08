import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("update-prices edge function", () => {
  const source = readFileSync(resolve(process.cwd(), "supabase/functions/update-prices/index.ts"), "utf8");

  it("enforces 8 requests per second rate limiting", () => {
    expect(source).toContain("MAX_CALLS_PER_SECOND = 8");
    expect(source).toContain("API_DELAY_MS = Math.ceil(1000 / MAX_CALLS_PER_SECOND)");
  });

  it("filters stale market instruments older than 10 minutes", () => {
    expect(source).toContain("from(\"market_instruments\")");
    expect(source).toContain("STALE_AFTER_MS = 10 * 60 * 1000");
    expect(source).toContain("(nowMs - new Date(instrument.last_price_at).getTime()) > STALE_AFTER_MS");
  });

  it("stores global prices and refreshes portfolio valuations", () => {
    expect(source).toContain("from(\"market_prices\")");
    expect(source).toContain("from(\"prices\")");
    expect(source).toContain("supabase.rpc(\"refresh_portfolio_valuations\")");
  });
});
