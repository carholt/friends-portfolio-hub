import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc,
  },
}));

describe("fetchMiningDashboard", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("calls rpc with _portfolio_id argument", async () => {
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    const { fetchMiningDashboard } = await import("@/lib/mining-dashboard");

    await fetchMiningDashboard("portfolio-1");

    expect(rpc).toHaveBeenCalledWith("get_portfolio_mining_dashboard", { portfolio_id: "portfolio-1" });
  });

  it("falls back to legacy portfolio_id when PostgREST schema cache expects old signature", async () => {
    rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST202", message: "Could not find the function public.get_portfolio_mining_dashboard(_portfolio_id) in the schema cache" },
      })
      .mockResolvedValueOnce({ data: {}, error: null });

    const { fetchMiningDashboard } = await import("@/lib/mining-dashboard");

    await fetchMiningDashboard("portfolio-2");

    expect(rpc).toHaveBeenNthCalledWith(1, "get_portfolio_mining_dashboard", { portfolio_id: "portfolio-2" });
    expect(rpc).toHaveBeenNthCalledWith(2, "get_portfolio_mining_dashboard", { _portfolio_id: "portfolio-2" });
  });

  it("does not retry when PGRST202 is unrelated to dashboard RPC signature", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "Could not find function public.some_other_rpc()" },
    });

    const { fetchMiningDashboard } = await import("@/lib/mining-dashboard");

    await expect(fetchMiningDashboard("portfolio-3")).rejects.toMatchObject({
      code: "PGRST202",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

});
