import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc,
  },
}));

describe("portfolio refresh helper", () => {
  it("rebuilds holdings then refreshes valuations", async () => {
    rpc.mockResolvedValue({ error: null });
    const { rebuildHoldingsAndRefreshValuation } = await import("@/lib/portfolio-refresh");
    await rebuildHoldingsAndRefreshValuation("p1");

    expect(rpc).toHaveBeenNthCalledWith(1, "rebuild_holdings", { _portfolio_id: "p1" });
    expect(rpc).toHaveBeenNthCalledWith(2, "refresh_portfolio_valuations");
  });
});
