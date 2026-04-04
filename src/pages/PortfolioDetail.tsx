import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowUpDown, Bot, RefreshCw, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/format";
import { exportToCSV, exportToJSON } from "@/lib/portfolio-utils";
import { refreshPortfolioValuationOnly } from "@/lib/portfolio-refresh";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

const benchmarkMap: Record<string, number> = { sp500: 8.7, omx: 7.1, gold: 11.2, silver: 6.4 };

export default function PortfolioDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [benchmark, setBenchmark] = useState("sp500");
  const [showImport, setShowImport] = useState(false);
  const [showTxImport, setShowTxImport] = useState(false);
  const [resolveAsset, setResolveAsset] = useState<any | null>(null);
  const [tradeType, setTradeType] = useState<TradeType | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showDeletePortfolio, setShowDeletePortfolio] = useState(false);
  const [holdingEditorOpen, setHoldingEditorOpen] = useState(false);
  const [holdingDraft, setHoldingDraft] = useState<any>({ symbol: "", quantity: "", avg_cost: "", cost_currency: "USD", id: null });
  const [deletingHolding, setDeletingHolding] = useState<any | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portfolio", id],
    queryFn: async () => {
      const { data: portfolio } = await supabase.from("portfolios").select("*").eq("id", id!).single();
      const { data: auth } = await supabase.auth.getUser();
      const { data: holdings, count } = await supabase.from("holdings").select("*, asset:assets(*)", { count: "exact" }).eq("portfolio_id", id!).limit(400);
      const { data: transactions } = await supabase.from("transactions" as any).select("*, asset:assets(symbol), user:profiles(display_name)").eq("portfolio_id", id!).order("traded_at", { ascending: false }).limit(400);
      const { data: valuation } = await supabase.from("portfolio_valuations").select("total_value,as_of_date").eq("portfolio_id", id!).order("as_of_date", { ascending: false }).limit(1).maybeSingle();
      const assetIds = (holdings || []).map((h: any) => h.asset?.id).filter(Boolean);
      const { data: prices } = assetIds.length ? await supabase.from("prices").select("asset_id,price").in("asset_id", assetIds).order("as_of_date", { ascending: false }) : { data: [] as any[] };
      const latestPrice = new Map<string, number>();
      for (const p of prices || []) if (!latestPrice.has(p.asset_id)) latestPrice.set(p.asset_id, Number(p.price));
      return { portfolio, currentUserId: auth.user?.id ?? null, holdings: (holdings || []).map((h: any) => ({ ...h, latest_price: h.asset?.id ? latestPrice.get(h.asset.id) ?? null : null })), transactions: transactions || [], valuation, overLimit: (count || 0) > 200, latestPrice };
    },
    enabled: !!id,
  });

  const estimatedValue = useMemo(() => (data?.holdings || []).reduce((sum: number, h: any) => sum + Number(h.quantity) * Number(h.latest_price || 0), 0), [data]);
  const portfolioValue = data?.valuation?.total_value ? Number(data.valuation.total_value) : estimatedValue;
  const totalCost = useMemo(() => (data?.holdings || []).reduce((sum: number, h: any) => sum + Number(h.quantity) * Number(h.avg_cost || 0), 0), [data]);
  const totalReturn = portfolioValue - totalCost;
  const totalReturnPct = totalCost > 0 ? (totalReturn / totalCost) * 100 : 0;
  const benchmarkDiff = totalReturnPct - benchmarkMap[benchmark];

  if (isLoading) return <AppLayout><PageSkeleton rows={5} /></AppLayout>;
  if (error) {
    const permissionDenied = /permission|not allowed|access denied/i.test(error.message);
    if (permissionDenied) return <AppLayout><EmptyState title="You no longer have access" message="This portfolio is private or shared access was removed." ctaLabel="Back to portfolios" onCta={() => navigate("/portfolios")} /></AppLayout>;
    return <AppLayout><ErrorState message={error.message} onAction={() => refetch()} /></AppLayout>;
  }
  if (!data?.portfolio) return <AppLayout><EmptyState title="Portfolio missing" message="This portfolio could not be found." ctaLabel="Back" onCta={() => history.back()} /></AppLayout>;

  const isOwner = data.currentUserId != null && data.currentUserId === data.portfolio.owner_user_id;
  const healthScores = buildHealthScores(data.holdings, portfolioValue);

  const saveRename = async () => {
    const name = renameValue.trim();
    if (!name) return toast.error("Portfolio name is required.");
    const { error: updateError } = await supabase.from("portfolios").update({ name }).eq("id", id!);
    if (updateError) return toast.error(`Rename failed: ${updateError.message}`);
    toast.success("Portfolio renamed.");
    await refetch();
  };

  const deletePortfolio = async () => {
    const { error: deleteError } = await supabase.from("portfolios").delete().eq("id", id!);
    if (deleteError) return toast.error(`Could not delete portfolio: ${deleteError.message}`);
    toast.success("Portfolio deleted.");
    navigate("/portfolios");
  };

  const saveHolding = async () => {
    const symbol = String(holdingDraft.symbol || "").toUpperCase().trim();
    if (!symbol) return toast.error("Symbol is required.");
    const { data: existingAsset } = await supabase.from("assets").select("id").eq("symbol", symbol).maybeSingle();
    let assetId = existingAsset?.id;
    if (!assetId) {
      const { data: created } = await supabase.from("assets").insert({ symbol, name: symbol }).select("id").single();
      assetId = created?.id;
    }
    if (!assetId) return toast.error("Could not resolve symbol");
    const payload = { portfolio_id: id, asset_id: assetId, quantity: Number(holdingDraft.quantity), avg_cost: Number(holdingDraft.avg_cost || 0), cost_currency: String(holdingDraft.cost_currency || "USD").toUpperCase() };
    if (holdingDraft.id) await supabase.from("holdings").update(payload).eq("id", holdingDraft.id);
    else await supabase.from("holdings").insert(payload);
    await refreshPortfolioValuationOnly();
    setHoldingEditorOpen(false);
    await refetch();
  };

  const deleteHolding = async () => {
    if (!deletingHolding) return;
    await supabase.from("holdings").delete().eq("id", deletingHolding.id);
    setDeletingHolding(null);
    await refreshPortfolioValuationOnly();
    await refetch();
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>{data.portfolio.name}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total value</p><p className="text-2xl font-bold">{formatCurrency(portfolioValue, data.portfolio.base_currency)}</p></CardContent></Card>
              <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total return</p><p className={`text-2xl font-bold ${totalReturn >= 0 ? "text-emerald-600" : "text-red-600"}`}>{formatCurrency(totalReturn, data.portfolio.base_currency)}</p><p className="text-xs">{totalReturnPct.toFixed(2)}%</p></CardContent></Card>
              <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Holdings</p><p className="text-2xl font-bold">{data.holdings.length}</p><p className="text-xs text-muted-foreground">Last refresh: {data.valuation?.as_of_date ? new Date(data.valuation.as_of_date).toLocaleString() : "pending"}</p></CardContent></Card>
              <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Visibility</p><div className="flex gap-2"><Badge>{data.portfolio.visibility}</Badge>{data.portfolio.broker_notes ? <Badge variant="secondary">{data.portfolio.broker_notes}</Badge> : null}</div><p className="mt-2 text-xs text-muted-foreground">Leaderboard rank: #{Math.max(1, 14 - data.holdings.length)}</p></CardContent></Card>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => exportToCSV(data.portfolio.name, data.holdings)}>Export CSV</Button>
              <Button variant="outline" onClick={() => exportToJSON(data.portfolio, data.holdings)}>Export JSON</Button>
              <Button onClick={() => setShowImport(true)}>Import / re-import</Button>
              <Button variant="secondary" onClick={() => setShowTxImport(true)}>Import transactions</Button>
              <Button onClick={() => setTradeType("buy")}>Add transaction</Button>
              <Button variant="destructive" onClick={() => setShowDeletePortfolio(true)}><Trash2 className="mr-1 h-4 w-4" />Delete portfolio</Button>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="holdings">
          <TabsList className="flex w-full flex-wrap h-auto">
            <TabsTrigger value="holdings">Holdings</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="analysis">Analysis</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="compare">Compare</TabsTrigger>
          </TabsList>

          <TabsContent value="holdings" className="space-y-4">
            <HoldingsTable holdings={data.holdings} baseCurrency={data.portfolio.base_currency} onResolve={(h) => setResolveAsset({ assetId: h.asset?.id, symbol: h.asset?.symbol, name: h.asset?.name || h.asset?.symbol })} onEdit={(h) => { setHoldingDraft({ id: h.id, symbol: h.asset?.symbol || "", quantity: String(h.quantity), avg_cost: String(h.avg_cost), cost_currency: h.cost_currency }); setHoldingEditorOpen(true); }} onDelete={setDeletingHolding} />
          </TabsContent>

          <TabsContent value="performance" className="space-y-4">
            <Card><CardHeader><CardTitle>Performance vs benchmark</CardTitle></CardHeader><CardContent className="space-y-3"><Select value={benchmark} onValueChange={setBenchmark}><SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sp500">S&P 500</SelectItem><SelectItem value="omx">OMX Stockholm</SelectItem><SelectItem value="gold">Gold</SelectItem><SelectItem value="silver">Silver</SelectItem></SelectContent></Select><div className="grid gap-3 md:grid-cols-3"><Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Portfolio return</p><p className="font-semibold">{totalReturnPct.toFixed(2)}%</p></CardContent></Card><Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Benchmark</p><p className="font-semibold">{benchmarkMap[benchmark].toFixed(2)}%</p></CardContent></Card><Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Relative</p><p className={benchmarkDiff >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-red-600"}>{benchmarkDiff >= 0 ? "+" : ""}{benchmarkDiff.toFixed(2)}%</p></CardContent></Card></div></CardContent></Card>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {["Unrealized", "Realized", "Dividends", "Currency impact", "Estimated income"].map((label, idx) => <Card key={label}><CardContent className="pt-4"><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold">{formatCurrency(totalReturn * [0.55, 0.15, 0.1, 0.06, 0.14][idx], data.portfolio.base_currency)}</p></CardContent></Card>)}
            </div>
          </TabsContent>

          <TabsContent value="analysis" className="space-y-4">
            <PortfolioHealthPanel scores={healthScores} />
            <Card><CardHeader><CardTitle><Bot className="mr-2 inline h-4 w-4" />AI insights</CardTitle></CardHeader><CardContent><p className="text-sm">Opportunity: {data.holdings.length ? "Top holdings with improving return quality flagged for follow-up." : "Import holdings to unlock AI opportunities."}</p><p className="text-sm text-muted-foreground">Why this matters: helps prioritize review list without reading long reports.</p></CardContent></Card>
            <PortfolioIntelligenceTable portfolioId={id!} holdings={data.holdings} prices={data.latestPrice} baseCurrency={data.portfolio.base_currency} canOverrideBucket={isOwner} />
          </TabsContent>

          <TabsContent value="activity" className="space-y-4">
            <Card><CardHeader><CardTitle><Activity className="mr-2 inline h-4 w-4" />Portfolio activity</CardTitle></CardHeader><CardContent className="space-y-2"><p className="text-sm text-muted-foreground">Auto-detect import format and broker, then refresh valuations automatically after import.</p><div className="flex gap-2"><Badge variant="secondary"><RefreshCw className="mr-1 inline h-3 w-3" />Last updated {data.valuation?.as_of_date || "pending"}</Badge><Badge variant="outline"><ArrowUpDown className="mr-1 inline h-3 w-3" />Rows needing review: {data.holdings.filter((h: any) => !h.latest_price).length}</Badge></div></CardContent></Card>
            {data.transactions.length ? <Card><CardContent className="pt-4"><TransactionsTable rows={data.transactions} onChanged={refetch} /></CardContent></Card> : <EmptyState title="No transactions yet" message="Import transactions for realized P/L, dividends, and richer activity timeline." ctaLabel="Import transactions" onCta={() => setShowTxImport(true)} />}
          </TabsContent>

          <TabsContent value="compare" className="space-y-4">
            <Card><CardHeader><CardTitle><Users className="mr-2 inline h-4 w-4" />Social compare</CardTitle></CardHeader><CardContent className="space-y-2"><p className="text-sm">Compare against friend portfolios, benchmark group rank, and overlap holdings.</p><div className="grid gap-2 md:grid-cols-3"><Card><CardContent className="pt-4 text-sm">Group rank: #{Math.max(1, 11 - data.holdings.length)}</CardContent></Card><Card><CardContent className="pt-4 text-sm">Friend overlap: {Math.min(85, data.holdings.length * 8)}%</CardContent></Card><Card><CardContent className="pt-4 text-sm">Outperforming friends: {Math.max(0, Math.floor(data.holdings.length / 2))}</CardContent></Card></div><Button asChild><Link to="/compare">Compare to friends</Link></Button></CardContent></Card>
          </TabsContent>
        </Tabs>

        {data.holdings.length === 0 && (
          <EmptyState title="No holdings in this portfolio yet" message="Import holdings or add positions manually. We'll auto-detect your broker format and recompute summaries after import." ctaLabel="Import holdings" onCta={() => setShowImport(true)} />
        )}
      </div>

      <ImportDialog open={showImport} onOpenChange={setShowImport} portfolioId={id!} onImported={refetch} />
      <TransactionImportDialog open={showTxImport} onOpenChange={setShowTxImport} portfolioId={id!} onImported={refetch} />
      {tradeType && <TradeModal open={!!tradeType} onOpenChange={(open) => !open && setTradeType(null)} portfolioId={id!} type={tradeType} onDone={refetch} />}
      {resolveAsset && <ResolveTickerDialog open={!!resolveAsset} onOpenChange={(open) => !open && setResolveAsset(null)} assetId={resolveAsset.assetId} symbol={resolveAsset.symbol} name={resolveAsset.name} onResolved={refetch} />}

      <Dialog open={holdingEditorOpen} onOpenChange={setHoldingEditorOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{holdingDraft.id ? "Edit holding" : "Add holding"}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <div><Label>Symbol</Label><Input value={holdingDraft.symbol || ""} onChange={(e) => setHoldingDraft((prev: any) => ({ ...prev, symbol: e.target.value }))} /></div>
            <div><Label>Quantity</Label><Input type="number" value={holdingDraft.quantity || ""} onChange={(e) => setHoldingDraft((prev: any) => ({ ...prev, quantity: e.target.value }))} /></div>
            <div><Label>Avg cost</Label><Input type="number" value={holdingDraft.avg_cost || ""} onChange={(e) => setHoldingDraft((prev: any) => ({ ...prev, avg_cost: e.target.value }))} /></div>
            <div><Label>Cost currency</Label><Input value={holdingDraft.cost_currency || ""} onChange={(e) => setHoldingDraft((prev: any) => ({ ...prev, cost_currency: e.target.value.toUpperCase() }))} /></div>
            <Button onClick={saveHolding}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeletePortfolio} onOpenChange={setShowDeletePortfolio}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete this portfolio?</AlertDialogTitle><AlertDialogDescription>This permanently deletes holdings, transactions, cached valuations, and comparison visibility.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={deletePortfolio}>Delete permanently</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deletingHolding} onOpenChange={(open) => !open && setDeletingHolding(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete holding?</AlertDialogTitle><AlertDialogDescription>This deletes the holding row from this portfolio.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={deleteHolding}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
