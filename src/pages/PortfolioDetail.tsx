import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportToCSV, exportToJSON } from "@/lib/portfolio-utils";
import { useQuery } from "@tanstack/react-query";
import { PageSkeleton } from "@/components/feedback/PageSkeleton";
import { ErrorState } from "@/components/feedback/ErrorState";
import { EmptyState } from "@/components/feedback/EmptyState";
import { formatCurrency } from "@/lib/format";
import ImportDialog from "@/components/ImportDialog";
import ResolveTickerDialog from "@/components/ResolveTickerDialog";
import TradeModal, { type TradeType } from "@/components/TradeModal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TransactionsTable from "@/components/TransactionsTable";
import TransactionImportDialog from "@/components/TransactionImportDialog";
import PortfolioIntelligenceTable from "@/components/PortfolioIntelligenceTable";
import { toast } from "sonner";
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
import { refreshPortfolioValuationOnly } from "@/lib/portfolio-refresh";

export default function PortfolioDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [showImport, setShowImport] = useState(false);
  const [showTxImport, setShowTxImport] = useState(false);
  const [resolveAsset, setResolveAsset] = useState<any | null>(null);
  const [tradeType, setTradeType] = useState<TradeType | null>(null);
  const [refreshingClassifications, setRefreshingClassifications] = useState(false);
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
      const { data: transactions } = await supabase.from("transactions" as any).select("*, asset:assets(symbol), user:profiles!inner(display_name)").eq("portfolio_id", id!).order("traded_at", { ascending: false }).limit(400);
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

  if (isLoading) return <AppLayout><PageSkeleton rows={3} /></AppLayout>;
  if (error) {
    const permissionDenied = /permission|not allowed|access denied/i.test(error.message);
    if (permissionDenied) return <AppLayout><EmptyState title="You no longer have access" message="This portfolio is private or shared access was removed." ctaLabel="Back to portfolios" onCta={() => navigate("/portfolios")} /></AppLayout>;
    return <AppLayout><ErrorState message={error.message} onAction={() => refetch()} /></AppLayout>;
  }
  if (!data?.portfolio) return <AppLayout><EmptyState title="Portfolio missing" message="This portfolio could not be found." ctaLabel="Back" onCta={() => history.back()} /></AppLayout>;

  const isOwner = data.currentUserId != null && data.currentUserId === data.portfolio.owner_user_id;

  const saveRename = async () => {
    const name = renameValue.trim();
    if (!name) return toast.error("Portfolio name is required.");
    const { error: updateError } = await supabase.from("portfolios").update({ name }).eq("id", id!);
    if (updateError) return toast.error(`Rename failed: ${updateError.message}`);
    toast.success("Portfolio renamed.");
    await refetch();
  };

  const changeVisibility = async (visibility: string) => {
    const { error: updateError } = await supabase.from("portfolios").update({ visibility }).eq("id", id!);
    if (updateError) return toast.error(`Could not update visibility: ${updateError.message}`);
    toast.success("Visibility updated.");
    await refetch();
  };

  const deletePortfolio = async () => {
    const { error: deleteError } = await supabase.from("portfolios").delete().eq("id", id!);
    if (deleteError) return toast.error(`Could not delete portfolio: ${deleteError.message}`);
    toast.success("Portfolio deleted. Holdings, transactions, cached valuations, and comparison visibility were removed.");
    navigate("/portfolios");
  };

  const openAddHolding = () => {
    setHoldingDraft({ symbol: "", quantity: "", avg_cost: "", cost_currency: data.portfolio.base_currency || "USD", id: null });
    setHoldingEditorOpen(true);
  };

  const saveHolding = async () => {
    const symbol = String(holdingDraft.symbol || "").toUpperCase().trim();
    if (!symbol) return toast.error("Symbol is required.");
    if (!holdingDraft.quantity || Number(holdingDraft.quantity) <= 0) return toast.error("Quantity must be greater than zero.");

    const existingHolding = holdingDraft.id ? data.holdings.find((h: any) => h.id === holdingDraft.id) : null;
    if (existingHolding) {
      const { count } = await supabase.from("transactions" as never).select("id", { count: "exact", head: true }).eq("portfolio_id", id!).eq("asset_id", existingHolding.asset_id);
      if ((count || 0) > 0) {
        toast.error("This holding is managed by transactions and cannot be edited directly.");
        return;
      }
    }

    const { data: existingAsset } = await supabase.from("assets").select("id").eq("symbol", symbol).maybeSingle();
    let assetId = existingAsset?.id;
    if (!assetId) {
      const { data: created, error: createError } = await supabase.from("assets").insert({ symbol, name: symbol }).select("id").single();
      if (createError || !created) return toast.error(createError?.message || "Could not create asset.");
      assetId = created.id;
    }

    const payload = {
      portfolio_id: id,
      asset_id: assetId,
      quantity: Number(holdingDraft.quantity),
      avg_cost: Number(holdingDraft.avg_cost || 0),
      cost_currency: String(holdingDraft.cost_currency || "USD").toUpperCase(),
    };

    if (holdingDraft.id) {
      const { error: updateError } = await supabase.from("holdings").update(payload).eq("id", holdingDraft.id);
      if (updateError) return toast.error(`Could not update holding: ${updateError.message}`);
      toast.success("Holding updated.");
    } else {
      const { error: insertError } = await supabase.from("holdings").insert(payload);
      if (insertError) return toast.error(`Could not add holding: ${insertError.message}`);
      toast.success("Holding added.");
    }

    await refreshPortfolioValuationOnly();
    setHoldingEditorOpen(false);
    await refetch();
  };

  const deleteHolding = async () => {
    if (!deletingHolding) return;
    const { count } = await supabase.from("transactions" as never).select("id", { count: "exact", head: true }).eq("portfolio_id", id!).eq("asset_id", deletingHolding.asset_id);
    if ((count || 0) > 0) {
      toast.error("This holding is managed by transactions. Delete or edit transactions instead.");
      return;
    }

    const { error: deleteError } = await supabase.from("holdings").delete().eq("id", deletingHolding.id);
    if (deleteError) return toast.error(`Could not delete holding: ${deleteError.message}`);
    await refreshPortfolioValuationOnly();
    toast.success("Holding deleted and valuations refreshed.");
    setDeletingHolding(null);
    await refetch();
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>{data.portfolio.name}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-3xl font-bold">{formatCurrency(data.valuation?.total_value ? Number(data.valuation.total_value) : estimatedValue, data.portfolio.base_currency)} {data.valuation ? "" : "(Estimated)"}</p>
            <p className="text-xs text-muted-foreground">Valuations last refreshed: {data.valuation?.as_of_date ? new Date(data.valuation.as_of_date).toLocaleString() : "Not refreshed yet"}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={data.portfolio.visibility} onValueChange={changeVisibility}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="private">Private</SelectItem><SelectItem value="authenticated">Logged-in</SelectItem><SelectItem value="group">Group</SelectItem><SelectItem value="public">Public</SelectItem></SelectContent></Select>
              <Input value={data.portfolio.broker_notes || ""} placeholder="Broker notes" onChange={(e) => supabase.from("portfolios").update({ broker_notes: e.target.value }).eq("id", id!)} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Rename portfolio" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
              <Button variant="outline" onClick={saveRename}>Save name</Button>
            </div>
            <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => exportToCSV(data.portfolio.name, data.holdings)}>Export CSV</Button><Button variant="outline" onClick={() => exportToJSON(data.portfolio, data.holdings)}>Export JSON</Button><Button onClick={() => setShowImport(true)}>Import holdings</Button><Button variant="secondary" onClick={() => setShowTxImport(true)}>Import transactions</Button><Button onClick={openAddHolding}>Add holding</Button>{isOwner && <Button variant="outline" disabled={refreshingClassifications} onClick={async () => {
              setRefreshingClassifications(true);
              await supabase.rpc("refresh_asset_research" as never, { _portfolio_id: id } as never);
              await refetch();
              setRefreshingClassifications(false);
            }}>{refreshingClassifications ? "Updating..." : "Update classifications"}</Button>}<Button onClick={() => setTradeType("buy")}>Add transaction</Button><Button variant="destructive" onClick={() => setShowDeletePortfolio(true)}>Delete portfolio</Button></div>
          </CardContent>
        </Card>

        <Tabs defaultValue="holdings">
          <TabsList>
            <TabsTrigger value="holdings">Holdings</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="intelligence">Intelligence</TabsTrigger>
          </TabsList>
          <TabsContent value="holdings">
            <Card><CardContent className="pt-4">
              {data.holdings.length === 0 ? <EmptyState title="No holdings yet" message="Add holdings manually or import from your broker." ctaLabel="Add holding" onCta={openAddHolding} /> : <Table><TableHeader><TableRow><TableHead>Symbol</TableHead><TableHead>Qty</TableHead><TableHead>Value</TableHead><TableHead>P/L</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{data.holdings.map((h: any) => { const value = Number(h.quantity) * Number(h.latest_price || 0); const cost = Number(h.quantity) * Number(h.avg_cost || 0); const unresolved = h.asset?.symbol_resolution_status === "invalid" || h.asset?.symbol_resolution_status === "ambiguous" || h.latest_price == null; return <TableRow key={h.id}><TableCell><Link className="underline" to={`/assets/${h.asset?.symbol}`}>{h.asset?.symbol}</Link></TableCell><TableCell>{h.quantity}</TableCell><TableCell>{formatCurrency(value, data.portfolio.base_currency)}</TableCell><TableCell>{formatCurrency(value - cost, data.portfolio.base_currency)}</TableCell><TableCell>{unresolved ? <span className="flex items-center gap-2">No price source yet<Button size="sm" variant="outline" onClick={() => setResolveAsset({ assetId: h.asset?.id, symbol: h.asset?.symbol, name: h.asset?.name || h.asset?.symbol })}>Fix symbol</Button></span> : "Priced"}</TableCell><TableCell><div className="flex gap-1"><Button variant="ghost" size="sm" onClick={async () => {
                    const { count } = await supabase.from("transactions" as never).select("id", { count: "exact", head: true }).eq("portfolio_id", id!).eq("asset_id", h.asset_id);
                    if ((count || 0) > 0) {
                      toast.error("This holding is managed by transactions and cannot be edited directly.");
                      return;
                    }
                    setHoldingDraft({ id: h.id, symbol: h.asset?.symbol || "", quantity: String(h.quantity), avg_cost: String(h.avg_cost), cost_currency: h.cost_currency });
                    setHoldingEditorOpen(true);
                  }}>Edit</Button><Button variant="destructive" size="sm" onClick={() => setDeletingHolding(h)}>Delete</Button></div></TableCell></TableRow>; })}</TableBody></Table>}
            </CardContent></Card>
          </TabsContent>
          <TabsContent value="transactions">
            <Card><CardContent className="pt-4"><TransactionsTable rows={data.transactions} onChanged={refetch} /></CardContent></Card>
          </TabsContent>
          <TabsContent value="intelligence">
            <Card><CardContent className="pt-4">
              <PortfolioIntelligenceTable portfolioId={id!} holdings={data.holdings} prices={data.latestPrice} baseCurrency={data.portfolio.base_currency} canOverrideBucket={isOwner} />
            </CardContent></Card>
          </TabsContent>
        </Tabs>
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
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this portfolio?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes holdings, transactions, cached valuations, and comparison visibility.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={deletePortfolio}>Delete permanently</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deletingHolding} onOpenChange={(open) => !open && setDeletingHolding(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete holding?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the holding row. If transactions exist for this asset, direct delete is blocked to keep data consistent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={deleteHolding}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
