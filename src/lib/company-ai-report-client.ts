import { supabase } from "@/integrations/supabase/client";

export type RequestCompanyAiReportInput = {
  assetId: string;
  portfolioId?: string | null;
  assumptions?: Record<string, unknown>;
};

export async function requestCompanyAiReport(input: RequestCompanyAiReportInput): Promise<string> {
  const { data, error } = await (supabase as any).rpc("request_company_ai_report", {
    _asset_id: input.assetId,
    _portfolio_id: input.portfolioId ?? null,
    _assumptions: input.assumptions ?? {},
  });
  if (error) throw error;
  return data as string;
}
