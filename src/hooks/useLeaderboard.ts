import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type LeaderboardEntry = {
  portfolio_id: string;
  portfolio_name: string;
  total_value: number;
  return_pct: number;
};

export function useLeaderboard(limit = 50) {
  return useQuery({
    queryKey: ["portfolio-leaderboard", limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_portfolio_leaderboard", { limit });
      if (error) throw error;

      return ((data ?? []) as LeaderboardEntry[]).map((entry) => ({
        ...entry,
        total_value: Number(entry.total_value || 0),
        return_pct: Number(entry.return_pct || 0),
      }));
    },
  });
}
