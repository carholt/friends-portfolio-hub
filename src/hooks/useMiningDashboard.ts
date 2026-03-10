import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchMiningDashboard } from "@/lib/mining-dashboard";

export function usePrimaryPortfolio() {
  return useQuery({
    queryKey: ["primary-portfolio"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portfolios")
        .select("id,name,base_currency")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useMiningDashboard(portfolioId?: string) {
  return useQuery({
    queryKey: ["mining-dashboard", portfolioId],
    queryFn: () => fetchMiningDashboard(portfolioId as string),
    enabled: Boolean(portfolioId),
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });
}
