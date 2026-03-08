import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { IdeaCard } from "@/components/IdeaCard";

export default function IdeasPage() {
  const checklist = useMemo(() => ({ revenue_growth: ">10%", debt_to_equity: "<0.5", sector: "gold mining" }), []);
  const { data: ideas = [] } = useQuery({
    queryKey: ["ai-scan-companies"],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => ReturnType<typeof supabase.rpc> }).rpc("ai_scan_companies", { checklist });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        symbol: String(row.symbol || ""),
        score: Number(row.score || 0),
        notes: String((row.analysis_json as { notes?: string } | null)?.notes || "No notes"),
      }));
    },
  });

  return (
    <AppLayout>
      <h1 className="text-2xl font-bold">Investment ideas</h1>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {ideas.map((idea) => (
          <IdeaCard key={idea.symbol} symbol={idea.symbol} score={idea.score} notes={idea.notes} />
        ))}
      </div>
    </AppLayout>
  );
}
