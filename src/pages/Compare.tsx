import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PortfolioCompare } from "@/components/PortfolioCompare";
import { AIAnalysisPanel } from "@/components/AIAnalysisPanel";

export default function ComparePage() {
  const [idsRaw, setIdsRaw] = useState("");
  const ids = idsRaw.split(",").map((v) => v.trim()).filter(Boolean);

  const { data: rows = [], refetch, isFetching } = useQuery({
    queryKey: ["compare-portfolios", ids.join(",")],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => ReturnType<typeof supabase.rpc> }).rpc("compare_portfolios", { portfolio_ids: ids });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        ...row,
        total_value: Number(row.total_value || 0),
        total_cost: Number(row.total_cost || 0),
        return_pct: Number(row.return_pct || 0),
        risk_score: Number(row.risk_score || 0),
      })) as Array<{ portfolio_id: string; name: string; owner: string; total_value: number; total_cost: number; return_pct: number; largest_position: string; risk_score: number }>;
    },
    enabled: false,
  });

  return (
    <AppLayout>
      <h1 className="text-2xl font-bold">Compare portfolios</h1>
      <div className="flex gap-2">
        <Input placeholder="portfolio uuid, portfolio uuid" value={idsRaw} onChange={(e) => setIdsRaw(e.target.value)} />
        <Button onClick={() => refetch()} disabled={isFetching}>Compare</Button>
      </div>
      <PortfolioCompare rows={rows} />
      {rows[0]?.portfolio_id ? <AIAnalysisPanel portfolioId={rows[0].portfolio_id} /> : null}
    </AppLayout>
  );
}
