import { describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

import { requestCompanyAiReport } from "@/lib/company-ai-report-client";

describe("requestCompanyAiReport", () => {
  it("calls rpc and returns report id", async () => {
    rpcMock.mockResolvedValueOnce({ data: "report-123", error: null });

    const result = await requestCompanyAiReport({
      assetId: "asset-1",
      assumptions: { mode: "standard" },
    });

    expect(rpcMock).toHaveBeenCalledWith("request_company_ai_report", {
      _asset_id: "asset-1",
      _portfolio_id: null,
      _assumptions: { mode: "standard" },
    });
    expect(result).toBe("report-123");
  });
});
