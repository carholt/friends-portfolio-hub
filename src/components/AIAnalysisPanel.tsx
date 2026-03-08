import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AIAnalysisPanel({ portfolioId }: { portfolioId: string }) {
  const { data } = useQuery({
    queryKey: ["analyze-portfolio", portfolioId],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => ReturnType<typeof supabase.rpc> }).rpc("analyze_portfolio", { portfolio_id: portfolioId });
      if (error) throw error;
      return (data ?? {}) as { diversification?: number; risk_rating?: string; recommendations?: string[] };
    },
    enabled: Boolean(portfolioId),
  });

  return (
    <Card>
      <CardHeader><CardTitle>AI Portfolio Analysis</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-1">
        <p>Diversification: {data?.diversification ?? "-"}</p>
        <p>Risk: {data?.risk_rating ?? "-"}</p>
        <ul className="list-disc pl-6">
          {(data?.recommendations ?? []).map((rec) => <li key={rec}>{rec}</li>)}
        </ul>
      </CardContent>
    </Card>
  );
}
