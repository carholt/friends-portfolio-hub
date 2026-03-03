import { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/feedback/ErrorState";
import { EmptyState } from "@/components/feedback/EmptyState";
import { PageSkeleton } from "@/components/feedback/PageSkeleton";

export default function AssetCompanyPage() {
  const { user } = useAuth();
  const { symbol } = useParams<{ symbol: string }>();
  const [gold, setGold] = useState("2200");
  const [silver, setSilver] = useState("25");
  const [discountRate, setDiscountRate] = useState("8");
  const [multiple, setMultiple] = useState("120");
  const [sharesOutstanding, setSharesOutstanding] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["company", symbol],
    enabled: !!symbol,
    queryFn: async () => {
      const { data: asset } = await supabase.from("assets").select("id,symbol,name,exchange").eq("symbol", symbol!.toUpperCase()).maybeSingle();
      if (!asset) return { asset: null, company: null, metrics: [] };
      const { data: company } = await supabase.from("companies").select("*").eq("asset_id", asset.id).maybeSingle();
      const { data: metrics } = company ? await supabase.from("company_metrics").select("*").eq("company_id", company.id).order("as_of_date", { ascending: false }) : { data: [] };
      return { asset, company, metrics: metrics || [] };
    }
  });

  const estimates = useMemo(() => {
    const g = Number(gold) || 0;
    const s = Number(silver) || 0;
    const d = Number(discountRate) || 0;
    const m = Number(multiple) || 0;
    const shares = Number(sharesOutstanding) || 0;
    const impliedEV = ((g * 0.6) + (s * 0.4)) * m;
    const impliedMarketCap = impliedEV * (1 - d / 100);
    const impliedPricePerShare = shares > 0 ? impliedMarketCap / shares : null;
    return { impliedEV, impliedMarketCap, impliedPricePerShare };
  }, [gold, silver, discountRate, multiple, sharesOutstanding]);

  if (isLoading) return <AppLayout><PageSkeleton rows={3} /></AppLayout>;
  if (error) return <AppLayout><ErrorState message={error.message} onAction={() => refetch()} /></AppLayout>;
  if (!data?.asset || !data.company) return <AppLayout><EmptyState title="Company profile unavailable" message="This symbol does not have company intelligence yet." ctaLabel="Back" onCta={() => history.back()} /></AppLayout>;

  return (
    <AppLayout>
      <div className="space-y-4">
        <Card><CardHeader><CardTitle>{data.company.name} ({data.asset.symbol})</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2 text-sm"><p>Exchange: {data.asset.exchange || "—"}</p><p>Lifecycle stage: {data.company.lifecycle_stage}</p><p>Tier: {data.company.tier}</p><p>Jurisdiction: {data.company.jurisdiction || "—"}</p><p>Started: {data.company.started_year || "—"}</p></CardContent></Card>

        <Card><CardHeader><CardTitle>Metrics</CardTitle></CardHeader><CardContent>
          <Table><TableHeader><TableRow><TableHead>Metric</TableHead><TableHead>Value</TableHead><TableHead>As of</TableHead><TableHead>Source</TableHead></TableRow></TableHeader><TableBody>{data.metrics.map((m: any) => <TableRow key={m.id}><TableCell>{m.metric_key}</TableCell><TableCell>{m.value_number} {m.unit || ""}</TableCell><TableCell>{m.as_of_date}</TableCell><TableCell><a className="underline" href={m.source_url} target="_blank">{m.source_title || "Source"}</a></TableCell></TableRow>)}</TableBody></Table>
          {user && <p className="mt-2 text-xs text-muted-foreground">Metrics can only be created/edited/deleted by the original creator, and every metric requires a source URL.</p>}
        </CardContent></Card>

        <Card><CardHeader><CardTitle>Scenario panel (Estimate)</CardTitle></CardHeader><CardContent className="space-y-2"><div className="grid gap-2 sm:grid-cols-3"><Input value={gold} onChange={(e) => setGold(e.target.value)} placeholder="Gold price" /><Input value={silver} onChange={(e) => setSilver(e.target.value)} placeholder="Silver price" /><Input value={discountRate} onChange={(e) => setDiscountRate(e.target.value)} placeholder="Discount rate" /><Input value={multiple} onChange={(e) => setMultiple(e.target.value)} placeholder="EV/oz multiple" /><Input value={sharesOutstanding} onChange={(e) => setSharesOutstanding(e.target.value)} placeholder="Shares outstanding (optional)" /></div><p className="text-sm">Estimate: Implied EV = {estimates.impliedEV.toFixed(2)}</p><p className="text-sm">Estimate: Implied market cap = {estimates.impliedMarketCap.toFixed(2)}</p><p className="text-sm">Estimate: Implied price/share = {estimates.impliedPricePerShare == null ? "N/A" : estimates.impliedPricePerShare.toFixed(4)}</p></CardContent></Card>
      </div>
    </AppLayout>
  );
}
