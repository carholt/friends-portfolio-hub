import { supabase } from "@/integrations/supabase/client";

export type LeaderboardPeriod = "1M" | "3M" | "YTD" | "1Y" | "ALL";

export interface LeaderboardRow {
  portfolio_id: string;
  portfolio_name: string;
  visibility: string;
  owner_name: string;
  start_value: number | null;
  end_value: number | null;
  return_abs: number | null;
  return_pct: number | null;
  last_updated: string | null;
}

export async function fetchLeaderboard(period: LeaderboardPeriod): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc("get_leaderboard", { _period: period });

  if (error) {
    throw error;
  }

  return (data || []) as LeaderboardRow[];
}
