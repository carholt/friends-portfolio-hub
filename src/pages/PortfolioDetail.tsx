import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
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

export default function PortfolioDetail() {
  const { id } = useParams<{ id: string }>();
  const [showImport, setShowImport] = useState(false);
  const [resolveAsset, setResolveAsset] = useState<any | null>(null);
  const [tradeType, setTradeType] = useState<TradeType | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portfolio", id],
    queryFn: async () => {
      const { data: portfolio } = await supabase.from("portfolios").select("*").eq("id", id!).single();
      const { data: holdings, count } = await supabase.from("holdings").select("*, asset:assets(*)", { count: "exact" }).eq("portfolio_id", id!).limit(200);
      const { data: transactions } = await supabase.from("transactions" as any).select("*, asset:assets(symbol), user:profiles!inner(display_name)").eq("portfolio_id", id!).order("traded_at", { ascending: false }).limit(200);
      const { data: valuation } = await supabase.from("portfolio_valuations").select("total_value,as_of_date").eq("portfolio_id", id!).order("as_of_date", { ascending: false }).limit(1).maybeSingle();
      const assetIds = (holdings || []).map((h: any) => h.asset?.id).filter(Boolean);
      const { data: prices } = assetIds.length ? await supabase.from("prices").select("asset_id,price").in("asset_id", assetIds).order("as_of_date", { ascending: false }) : { data: [] as any[] };
      const latestPrice = new Map<string, number>();
      for (const p of prices || []) if (!latestPrice.has(p.asset_id)) latestPrice.set(p.asset_id, Number(p.price));
      return { portfolio, holdings: (holdings || []).map((h: any) => ({ ...h, latest_price: h.asset?.id ? latestPrice.get(h.asset.id) ?? null : null })), transactions: transactions || [], valuation, overLimit: (count || 0) > 200 };
    },
    enabled: !!id,
  });

  const estimatedValue = useMemo(() => (data?.holdings || []).reduce((sum: number, h: any) => sum + Number(h.quantity) * Number(h.latest_price || 0), 0), [data]);

  if (isLoading) return <AppLayout><PageSkeleton rows={3} /></AppLayout>;
  if (error) return <AppLayout><ErrorState message={error.message} onAction={() => refetch()} /></AppLayout>;
  if (!data?.portfolio) return <AppLayout><EmptyState title="Portfolio missing" message="This portfolio could not be found." ctaLabel="Back" onCta={() => history.back()} /></AppLayout>;

  return (
    <AppLayout>
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>{data.portfolio.name}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-3xl font-bold">{formatCurrency(data.valuation?.total_value ? Number(data.valuation.total_value) : estimatedValue, data.portfolio.base_currency)} {data.valuation ? "" : "(Estimated)"}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={data.portfolio.visibility} onValueChange={(visibility) => supabase.from("portfolios").update({ visibility }).eq("id", id!)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="private">Private</SelectItem><SelectItem value="authenticated">Logged-in</SelectItem><SelectItem value="group">Group</SelectItem><SelectItem value="public">Public</SelectItem></SelectContent></Select>
              <Input value={data.portfolio.broker_notes || ""} placeholder="Broker notes" onChange={(e) => supabase.from("portfolios").update({ broker_notes: e.target.value }).eq("id", id!)} />
            </div>
            <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => exportToCSV(data.portfolio.name, data.holdings)}>Export CSV</Button><Button variant="outline" onClick={() => exportToJSON(data.portfolio, data.holdings)}>Export JSON</Button><Button onClick={() => setShowImport(true)}>Import</Button><Button onClick={() => setTradeType("buy")}>Buy</Button><Button variant="outline" onClick={() => setTradeType("sell")}>Sell</Button><Button variant="outline" onClick={() => setTradeType("adjust")}>Adjust</Button><Button variant="destructive" onClick={() => setTradeType("remove")}>Remove</Button></div>
          </CardContent>
        </Card>

        <Tabs defaultValue="holdings">
          <TabsList>
            <TabsTrigger value="holdings">Holdings</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
          </TabsList>
          <TabsContent value="holdings">
            <Card><CardContent className="pt-4">
              {data.holdings.length === 0 ? <EmptyState title="No holdings yet" message="Use trade actions to add your first position." /> : <Table><TableHeader><TableRow><TableHead>Symbol</TableHead><TableHead>Qty</TableHead><TableHead>Value</TableHead><TableHead>P/L</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{data.holdings.map((h: any) => { const value = Number(h.quantity) * Number(h.latest_price || 0); const cost = Number(h.quantity) * Number(h.avg_cost || 0); return <TableRow key={h.id}><TableCell><Link className="underline" to={`/assets/${h.asset?.symbol}`}>{h.asset?.symbol}</Link></TableCell><TableCell>{h.quantity}</TableCell><TableCell>{formatCurrency(value, data.portfolio.base_currency)}</TableCell><TableCell>{formatCurrency(value - cost, data.portfolio.base_currency)}</TableCell><TableCell>{h.latest_price == null ? <span className="flex items-center gap-2">Unpriced{h.asset?.metadata_json?.isin && <Button size="sm" variant="outline" onClick={() => setResolveAsset({ isin: h.asset.metadata_json.isin, name: h.asset?.name || h.asset?.symbol, mic: h.asset?.metadata_json?.mic })}>Resolve ticker</Button>}</span> : "Priced"}</TableCell></TableRow>; })}</TableBody></Table>}
            </CardContent></Card>
          </TabsContent>
          <TabsContent value="transactions">
            <Card><CardContent className="pt-4"><TransactionsTable rows={data.transactions} onChanged={refetch} /></CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>
      <ImportDialog open={showImport} onOpenChange={setShowImport} portfolioId={id!} onImported={refetch} />
      {tradeType && <TradeModal open={!!tradeType} onOpenChange={(open) => !open && setTradeType(null)} portfolioId={id!} type={tradeType} onDone={refetch} />}
      {resolveAsset && <ResolveTickerDialog open={!!resolveAsset} onOpenChange={(open) => !open && setResolveAsset(null)} isin={resolveAsset.isin} name={resolveAsset.name} mic={resolveAsset.mic} onResolved={refetch} />}
    </AppLayout>
  );
}
