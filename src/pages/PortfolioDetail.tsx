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
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { PageSkeleton } from "@/components/feedback/PageSkeleton";
import { ErrorState } from "@/components/feedback/ErrorState";
import { EmptyState } from "@/components/feedback/EmptyState";
import { formatCurrency } from "@/lib/format";
import { logAuditAction } from "@/lib/audit";
import AddHoldingDialog from "@/components/AddHoldingDialog";
import ImportDialog from "@/components/ImportDialog";

export default function PortfolioDetail() {
  const { id } = useParams<{ id: string }>();
  const [showDetails, setShowDetails] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portfolio", id],
    queryFn: async () => {
      const { data: portfolio } = await supabase.from("portfolios").select("*").eq("id", id!).single();
      const { data: holdings, count } = await supabase.from("holdings").select("*, asset:assets(*)", { count: "exact" }).eq("portfolio_id", id!).limit(200);
      const { data: valuation } = await supabase.from("portfolio_valuations").select("total_value,as_of_date").eq("portfolio_id", id!).order("as_of_date", { ascending: false }).limit(1).maybeSingle();
      const assetIds = (holdings || []).map((h: any) => h.asset?.id).filter(Boolean);
      const { data: prices } = assetIds.length ? await supabase.from("prices").select("asset_id,price").in("asset_id", assetIds).order("as_of_date", { ascending: false }) : { data: [] as any[] };
      const latestPrice = new Map<string, number>();
      for (const p of prices || []) if (!latestPrice.has(p.asset_id)) latestPrice.set(p.asset_id, Number(p.price));
      return { portfolio, holdings: (holdings || []).map((h: any) => ({ ...h, latest_price: h.asset?.id ? latestPrice.get(h.asset.id) ?? null : null })), valuation, overLimit: (count || 0) > 200 };
    },
    enabled: !!id,
  });

  const estimatedValue = useMemo(() => (data?.holdings || []).reduce((sum: number, h: any) => sum + Number(h.quantity) * Number(h.latest_price || 0), 0), [data]);

  const updatePortfolio = async (changes: Record<string, unknown>) => {
    if (!id) return;
    const { error: updateError } = await supabase.from("portfolios").update(changes).eq("id", id);
    if (updateError) toast.error(updateError.message);
    else refetch();
  };

  if (isLoading) return <AppLayout><PageSkeleton rows={3} /></AppLayout>;
  if (error) return <AppLayout><ErrorState message={error.message} onAction={() => refetch()} /></AppLayout>;
  if (!data?.portfolio) return <AppLayout><EmptyState title="Portfolio missing" message="This portfolio could not be found." ctaLabel="Back" onCta={() => history.back()} /></AppLayout>;

  return (
    <AppLayout>
      <div className="space-y-4">
        <Card><CardHeader><CardTitle>{data.portfolio.name}</CardTitle></CardHeader><CardContent className="space-y-3">
          <p className="text-3xl font-bold">{formatCurrency(data.valuation?.total_value ? Number(data.valuation.total_value) : estimatedValue, data.portfolio.base_currency)} {data.valuation ? "" : "(Estimated)"}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select value={data.portfolio.visibility} onValueChange={(visibility) => { logAuditAction("visibility_change", "portfolio", id, { visibility }); updatePortfolio({ visibility }); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="private">Private</SelectItem><SelectItem value="authenticated">Logged-in</SelectItem><SelectItem value="group">Group</SelectItem><SelectItem value="public">Public</SelectItem></SelectContent></Select>
            <Select value={data.portfolio.broker || "manual"} onValueChange={(broker) => updatePortfolio({ broker })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual">manual</SelectItem><SelectItem value="avanza">avanza</SelectItem><SelectItem value="nordea">nordea</SelectItem><SelectItem value="vera_cash">vera_cash</SelectItem><SelectItem value="binance">binance</SelectItem></SelectContent></Select>
          </div>
          <Input value={data.portfolio.broker_notes || ""} placeholder="Broker notes (optional)" onChange={(e) => updatePortfolio({ broker_notes: e.target.value })} />
          {data.portfolio.visibility === "public" && <div className="text-sm"><p className="text-amber-600">Public means anyone with the link can view.</p><div className="flex gap-2 mt-2"><Input readOnly value={`${window.location.origin}/p/${data.portfolio.public_slug}`} /><Button variant="outline" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/p/${data.portfolio.public_slug}`)}>Copy</Button></div></div>}
          <div className="flex gap-2"><Button variant="outline" onClick={() => exportToCSV(data.portfolio.name, data.holdings)}>Export CSV</Button><Button variant="outline" onClick={() => exportToJSON(data.portfolio, data.holdings)}>Export JSON</Button><Button onClick={() => setShowImport(true)}>Import</Button><Button onClick={() => setShowAdd(true)}>Add holding</Button></div>
        </CardContent></Card>

        <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>Holdings</CardTitle><Button variant="ghost" onClick={() => setShowDetails((s) => !s)}>{showDetails ? "Hide details" : "Show details"}</Button></CardHeader><CardContent>
          {data.overLimit && <p className="text-xs text-amber-600 mb-2">Showing first 200 holdings. Split holdings into multiple portfolios if needed.</p>}
          {data.holdings.length === 0 ? <EmptyState title="No holdings yet" message="Add your first holding." ctaLabel="Add holding" onCta={() => setShowAdd(true)} /> : <Table><TableHeader><TableRow><TableHead>Symbol</TableHead><TableHead>Qty</TableHead><TableHead>Value</TableHead><TableHead>P/L</TableHead>{showDetails && <><TableHead>Avg cost</TableHead><TableHead>Status</TableHead></>}</TableRow></TableHeader><TableBody>{data.holdings.map((h: any) => { const value = Number(h.quantity) * Number(h.latest_price || 0); const cost = Number(h.quantity) * Number(h.avg_cost || 0); return <TableRow key={h.id}><TableCell><Link className="underline" to={`/assets/${h.asset?.symbol}`}>{h.asset?.symbol}</Link></TableCell><TableCell>{h.quantity}</TableCell><TableCell>{formatCurrency(value, data.portfolio.base_currency)}</TableCell><TableCell>{formatCurrency(value - cost, data.portfolio.base_currency)}</TableCell>{showDetails && <><TableCell>{h.avg_cost}</TableCell><TableCell>{h.latest_price == null ? "Unpriced" : "Priced"}</TableCell></>}</TableRow>; })}</TableBody></Table>}
        </CardContent></Card>
      </div>
      <AddHoldingDialog open={showAdd} onOpenChange={setShowAdd} portfolioId={id!} defaultCurrency={data.portfolio.base_currency} onAdded={refetch} />
      <ImportDialog open={showImport} onOpenChange={setShowImport} portfolioId={id!} onImported={refetch} />
    </AppLayout>
  );
}
