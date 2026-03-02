import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
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

export default function PortfolioDetail() {
  const { id } = useParams<{ id: string }>();
  const [showDetails, setShowDetails] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const [avgCost, setAvgCost] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portfolio", id],
    queryFn: async () => {
      const { data: portfolio } = await supabase.from("portfolios").select("*").eq("id", id!).single();
      const { data: holdings, count } = await supabase.from("holdings").select("*, asset:assets(*)", { count: "exact" }).eq("portfolio_id", id!).limit(200);
      const { data: valuation } = await supabase.from("portfolio_valuations").select("total_value,as_of_date").eq("portfolio_id", id!).order("as_of_date", { ascending: false }).limit(1).maybeSingle();
      const { data: groups } = await supabase.from("group_members").select("group:groups(id,name)").limit(20);
      const assetIds = (holdings || []).map((h: any) => h.asset?.id).filter(Boolean);
      const { data: prices } = assetIds.length ? await supabase.from("prices").select("asset_id,price").in("asset_id", assetIds).order("as_of_date", { ascending: false }) : { data: [] as any[] };
      const latestPrice = new Map<string, number>();
      for (const p of prices || []) if (!latestPrice.has(p.asset_id)) latestPrice.set(p.asset_id, Number(p.price));
      const enriched = (holdings || []).map((h: any) => ({ ...h, latest_price: h.asset?.id ? latestPrice.get(h.asset.id) ?? null : null }));
      return { portfolio, holdings: enriched, valuation, overLimit: (count || 0) > 200, groups: (groups || []).map((g: any) => g.group).filter(Boolean) };
    },
    enabled: !!id,
  });

  const estimatedValue = useMemo(() => (data?.holdings || []).reduce((sum: number, h: any) => sum + Number(h.quantity) * Number(h.latest_price || 0), 0), [data]);

  const updateVisibility = async (value: string) => {
    if (!id || !data?.portfolio) return;
    if (value === "group" && !data.portfolio.group_id) return toast.error("Select a group before using Group visibility.");
    const slug = value === "public" ? data.portfolio.public_slug || `${data.portfolio.name}-${Date.now().toString(36)}` : data.portfolio.public_slug;
    const { error } = await supabase.from("portfolios").update({ visibility: value, public_slug: slug }).eq("id", id);
    if (error) toast.error(error.message);
    else {
      await logAuditAction("visibility_change", "portfolio", id, { visibility: value });
      refetch();
    }
  };

  const addHolding = async () => {
    if (!id || !symbol || !quantity) return;
    const clean = symbol.toUpperCase().trim();
    const { data: existing } = await supabase.from("assets").select("id").eq("symbol", clean).maybeSingle();
    let assetId = existing?.id;
    if (!assetId) assetId = (await supabase.from("assets").insert({ symbol: clean, name: clean, asset_type: "stock", currency: data?.portfolio?.base_currency || "USD", metadata_json: { imported: true } }).select("id").single()).data?.id;
    const { error } = await supabase.from("holdings").insert({ portfolio_id: id, asset_id: assetId, quantity: Number(quantity), avg_cost: Number(avgCost || 0), cost_currency: data?.portfolio?.base_currency || "USD" });
    if (error) return toast.error(error.message);
    await logAuditAction("holding_add", "portfolio", id, { symbol: clean, quantity: Number(quantity) });
    setSymbol(""); setQuantity(""); setAvgCost(""); await refetch();
  };

  if (isLoading) return <AppLayout><PageSkeleton rows={3} /></AppLayout>;
  if (error) return <AppLayout><ErrorState message={error.message} onAction={() => refetch()} /></AppLayout>;
  if (!data?.portfolio) return <AppLayout><EmptyState title="Portfolio missing" message="This portfolio could not be found." ctaLabel="Back" onCta={() => history.back()} /></AppLayout>;

  return (
    <AppLayout>
      <div className="space-y-4">
        <Card><CardHeader><CardTitle>{data.portfolio.name}</CardTitle></CardHeader><CardContent className="space-y-3">
          <p className="text-3xl font-bold">{formatCurrency(data.valuation?.total_value ? Number(data.valuation.total_value) : estimatedValue, data.portfolio.base_currency)} {data.valuation ? "" : "(Estimated)"}</p>
          <div className="max-w-xs"><Select value={data.portfolio.visibility} onValueChange={updateVisibility}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="private">Private</SelectItem><SelectItem value="authenticated">Logged-in users</SelectItem><SelectItem value="group">Group</SelectItem><SelectItem value="public">Public</SelectItem></SelectContent></Select></div>
          {data.portfolio.visibility === "public" && <div className="text-sm"><p className="text-amber-600">Public means anyone with the link can view.</p><div className="flex gap-2 mt-2"><Input readOnly value={`${window.location.origin}/p/${data.portfolio.public_slug}`} /><Button variant="outline" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/p/${data.portfolio.public_slug}`)}>Copy</Button></div></div>}
          <div className="flex gap-2"><Button variant="outline" onClick={() => exportToCSV(data.portfolio.name, data.holdings)}>Export CSV</Button><Button variant="outline" onClick={() => exportToJSON(data.portfolio, data.holdings)}>Export JSON</Button></div>
        </CardContent></Card>

        <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>Holdings</CardTitle><Button variant="ghost" onClick={() => setShowDetails((s) => !s)}>{showDetails ? "Hide details" : "Show details"}</Button></CardHeader><CardContent>
          {data.overLimit && <p className="text-xs text-amber-600 mb-2">Showing first 200 holdings. Refine data to view all.</p>}
          {data.holdings.length === 0 ? <EmptyState title="No holdings yet" message="Add your first holding below." ctaLabel="Add holding" onCta={() => document.getElementById("holding-symbol")?.focus()} /> : <Table><TableHeader><TableRow><TableHead>Symbol</TableHead><TableHead>Qty</TableHead><TableHead>Value</TableHead><TableHead>P/L</TableHead>{showDetails && <><TableHead>Avg cost</TableHead><TableHead>Status</TableHead></>}</TableRow></TableHeader><TableBody>{data.holdings.map((h: any) => { const value = Number(h.quantity) * Number(h.latest_price || 0); const cost = Number(h.quantity) * Number(h.avg_cost || 0); return <TableRow key={h.id}><TableCell>{h.asset?.symbol}</TableCell><TableCell>{h.quantity}</TableCell><TableCell>{formatCurrency(value, data.portfolio.base_currency)}</TableCell><TableCell>{formatCurrency(value - cost, data.portfolio.base_currency)}</TableCell>{showDetails && <><TableCell>{h.avg_cost}</TableCell><TableCell>{h.latest_price == null ? "Unpriced" : "Priced"}</TableCell></>}</TableRow>; })}</TableBody></Table>}
        </CardContent></Card>

        <Card><CardHeader><CardTitle>Add holding</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-4"><Input id="holding-symbol" placeholder="Symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} /><Input placeholder="Quantity" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /><Input placeholder="Avg cost (optional)" type="number" value={avgCost} onChange={(e) => setAvgCost(e.target.value)} /><Button onClick={addHolding}>Save</Button></CardContent></Card>
      </div>
    </AppLayout>
  );
}
