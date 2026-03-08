import { supabase } from "@/integrations/supabase/client";

export async function rebuildHoldingsAndRefreshValuation(portfolioId: string) {
  await supabase.rpc("rebuild_holdings" as never, { _portfolio_id: portfolioId } as never);
  await supabase.rpc("refresh_portfolio_valuations" as never);
}

export async function refreshPortfolioValuationOnly() {
  await supabase.rpc("refresh_portfolio_valuations" as never);
}
