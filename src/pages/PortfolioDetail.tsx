import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bot, RefreshCw, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/format";
import { refreshPortfolioValuationOnly } from "@/lib/portfolio-refresh";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { PageSkeleton } from "@/components/feedback/PageSkeleton";
import ImportDialog from "@/components/ImportDialog";
import TransactionImportDialog from "@/components/TransactionImportDialog";
import ResolveTickerDialog from "@/components/ResolveTickerDialog";
import TradeModal, { type TradeType } from "@/components/TradeModal";
import TransactionsTable from "@/components/TransactionsTable";
import PortfolioIntelligenceTable from "@/components/PortfolioIntelligenceTable";
import HoldingsTable from "@/components/portfolio/HoldingsTable";
import PortfolioHealthPanel, { buildHealthScores } from "@/components/portfolio/PortfolioHealthPanel";

export default function PortfolioDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [showImport, setShowImport] = useState(false);
  const [showTxImport, setShowTxImport] = useState(false);
  const [resolveAsset, setResolveAsset] = useState<any | null>(null);
  const [tradeType, setTradeType] = useState<TradeType | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portfolio", id],
    queryFn: async () => {
      const { data: portfolio } = await supabase.from("portfolios").select("*").eq("id", id!).single();
      const { data: auth } = await supabase.auth.getUser();
      const { data: holdings, count } = await supabase
        .from("holdings")
        .select("*, asset:assets(*)", { count: "exact" })
        .eq("portfolio_id", id!)
        .limit(400);

      const { data: transactions } = await supabase
        .from("transactions" as any)
        .select("*, asset:assets(symbol), user:profiles(display_name)")
        .eq("portfolio_id", id!)
        .order("traded_at", { ascending: false })
        .limit(400);

      const { data: valuation } = await supabase
        .from("portfolio_valuations")
        .select("total_value,as_of_date")
        .eq("portfolio_id", id!)
        .order("as_of_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      const assetIds = (holdings || []).map((h: any) => h.asset?.id).filter(Boolean);
      const { data: prices } = assetIds.length
        ? await supabase.from("asset_prices").select("asset_id,price").in("asset_id", assetIds).order("price_date", { ascending: false })
        : { data: [] as any[] };

      const latestPrice = new Map<string, number>();
      for (const p of prices || []) {
        if (!latestPrice.has(p.asset_id)) latestPrice.set(p.asset_id, Number(p.price));
      }

      return {
        portfolio,
        currentUserId: auth.user?.id ?? null,
        holdings: (holdings || []).map((h: any) => ({
          ...h,
          latest_price: h.asset?.id ? latestPrice.get(h.asset.id) ?? null : null,
        })),
        transactions: transactions || [],
        valuation,
        overLimit: (count || 0) > 200,
      };
    },
    enabled: !!id,
  });

  const estimatedValue = useMemo(
    () => (data?.holdings || []).reduce((sum: number, h: any) => sum + Number(h.quantity) * Number(h.latest_price || 0), 0),
    [data]
  );
  const portfolioValue = data?.valuation?.total_value ? Number(data.valuation.total_value) : estimatedValue;
  const healthScores = buildHealthScores(data?.holdings || [], portfolioValue);

  if (isLoading) return <AppLayout><PageSkeleton rows={5} /></AppLayout>;

  if (error) {
    const permissionDenied = /permission|not allowed|access denied/i.test(error.message);
    if (permissionDenied) {
      return (
        <AppLayout>
          <EmptyState
            title="You no longer have access"
            message="This portfolio is private or shared access was removed."
            ctaLabel="Back to portfolios"
            onCta={() => navigate("/portfolios")}
          />
        </AppLayout>
      );
    }

    return <AppLayout><ErrorState message={error.message} onAction={() => refetch()} /></AppLayout>;
  }

  if (!data?.portfolio) {
    return (
      <AppLayout>
        <EmptyState title="Portfolio missing" message="This portfolio could not be found." ctaLabel="Back" onCta={() => navigate(-1)} />
      </AppLayout>
    );
  }

  const isOwner = data.currentUserId != null && data.currentUserId === data.portfolio.owner_user_id;

  const refreshValuation = async () => {
    const result = await refreshPortfolioValuationOnly(data.portfolio.id);
    if (!result.ok) {
      toast.error(result.error || "Refresh failed");
      return;
    }
    toast.success("Valuation refreshed");
    await refetch();
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{data.portfolio.name}</h1>
            <p className="text-sm text-muted-foreground">{formatCurrency(portfolioValue, data.portfolio.base_currency || "USD")}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowImport(true)}>Import holdings</Button>
            <Button variant="outline" onClick={() => setShowTxImport(true)}>Import transactions</Button>
            <Button variant="outline" onClick={refreshValuation}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
            <Button variant="outline"><Users className="mr-2 h-4 w-4" />Compare portfolio</Button>
            {isOwner && <Button variant="destructive"><Trash2 className="mr-2 h-4 w-4" />Delete portfolio</Button>}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Performance</CardTitle></CardHeader>
            <CardContent>
              <Badge variant="secondary">Value</Badge>
              <p className="mt-2">{formatCurrency(portfolioValue, data.portfolio.base_currency || "USD")}</p>
            </CardContent>
          </Card>
          <PortfolioHealthPanel scores={healthScores} />
        </div>

        <Tabs defaultValue="holdings">
          <TabsList>
            <TabsTrigger value="holdings">Holdings</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="compare">Compare</TabsTrigger>
            <TabsTrigger value="analysis">Analysis</TabsTrigger>
          </TabsList>

          <TabsContent value="holdings" className="space-y-3">
            {(data.holdings || []).length === 0 ? (
              <EmptyState title="No holdings in this portfolio yet" message="Import holdings or add your first position to get started." />
            ) : (
              <HoldingsTable
                holdings={data.holdings || []}
                baseCurrency={data.portfolio.base_currency || "USD"}
                isOwner={isOwner}
                onBuy={(asset: any) => {
                  setResolveAsset(asset);
                  setTradeType("buy");
                }}
                onSell={(asset: any) => {
                  setResolveAsset(asset);
                  setTradeType("sell");
                }}
                onDelete={() => Promise.resolve()}
                onUpdate={() => Promise.resolve()}
                onRefresh={async () => {
                  await refetch();
                }}
              />
            )}
          </TabsContent>

          <TabsContent value="transactions">
            <TransactionsTable rows={data.transactions || []} />
          </TabsContent>

          <TabsContent value="compare">
            <Card><CardHeader><CardTitle>Comparison</CardTitle></CardHeader><CardContent>Compare portfolio performance with peers.</CardContent></Card>
          </TabsContent>

          <TabsContent value="analysis" className="space-y-3">
            <Card>
              <CardHeader><CardTitle><Bot className="inline h-4 w-4 mr-2" />Analysis</CardTitle></CardHeader>
              <CardContent>AI-powered portfolio insights.</CardContent>
            </Card>
            <PortfolioIntelligenceTable rows={[]} />
          </TabsContent>
        </Tabs>
      </div>

      <ImportDialog open={showImport} onOpenChange={setShowImport} portfolioId={data.portfolio.id} onImported={() => void refetch()} />
      <TransactionImportDialog open={showTxImport} onOpenChange={setShowTxImport} portfolioId={data.portfolio.id} onImported={() => void refetch()} />
      <ResolveTickerDialog open={!!resolveAsset} onOpenChange={(open) => !open && setResolveAsset(null)} asset={resolveAsset} onResolved={() => void refetch()} />
      <TradeModal open={!!tradeType} onOpenChange={(open) => !open && setTradeType(null)} portfolioId={data.portfolio.id} tradeType={tradeType || "buy"} asset={resolveAsset} onSaved={() => void refetch()} />
    </AppLayout>
  );
}
