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
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/feedback/ErrorState";
import { EmptyState } from "@/components/feedback/EmptyState";
import { PageSkeleton } from "@/components/feedback/PageSkeleton";

const investmentHeaders = [
  "TICKER",
  "NAME",
  "BUCKET",
  "TYPE",
  "Weight",
  "SHARES",
  "AVERAGE BUY PRICE",
  "INVESTMENT",
  "PROJECTED PRICE",
  "POTENTIAL UPSIDE",
  "ROI",
  "Rating",
  "INVESTMENT RECOMMENDATION",
  "Properties / Ownership",
  "Management Team",
  "Share Structure",
  "Location",
  "Projected Growth",
  "Market Buzz",
  "Cost Structure / Financing",
  "Cash / Debt Position",
  "Low valuation Estimate",
  "High Valuation Estimate",
] as const;

const helperMetricMap: Record<string, string[]> = {
  "Projected Growth": ["projected_growth", "growth", "production_growth"],
  "Market Buzz": ["market_buzz", "sentiment", "news_sentiment"],
  "Cost Structure / Financing": ["all_in_sustaining_cost", "opex", "financing"],
  "Cash / Debt Position": ["cash", "net_debt", "debt"],
  "Low valuation Estimate": ["valuation_low", "target_price_low"],
  "High Valuation Estimate": ["valuation_high", "target_price_high"],
};

const keyFromLabel = (label: string) => label.toLowerCase().replace(/\s+/g, "_").replace(/\//g, "_").replace(/[^a-z_]/g, "");

type MetricRow = {
  id: string;
  metric_key: string | null;
  value_number: number | null;
  unit: string | null;
  as_of_date: string | null;
  source_url: string | null;
  source_title: string | null;
};

export default function AssetCompanyPage() {
  const { user } = useAuth();
  const { symbol } = useParams<{ symbol: string }>();
  const [gold, setGold] = useState("2200");
  const [silver, setSilver] = useState("25");
  const [discountRate, setDiscountRate] = useState("8");
  const [multiple, setMultiple] = useState("120");
  const [sharesOutstanding, setSharesOutstanding] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");

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

  const metricLookup = useMemo(() => {
    const byKey = new Map<string, string>();
    (data?.metrics || []).forEach((metric: MetricRow) => {
      if (metric.metric_key) {
        byKey.set(String(metric.metric_key).toLowerCase(), `${metric.value_number}${metric.unit ? ` ${metric.unit}` : ""}`.trim());
      }
    });
    return byKey;
  }, [data?.metrics]);

  const helperValues = useMemo(() => {
    return investmentHeaders.reduce<Record<string, string>>((acc, header) => {
      const aliasKeys = helperMetricMap[header] ?? [keyFromLabel(header)];
      const metricValue = aliasKeys.map((k) => metricLookup.get(k)).find(Boolean);
      acc[header] = metricValue || "Behöver AI/research";
      return acc;
    }, {
      TICKER: data?.asset?.symbol || "—",
      NAME: data?.company?.name || "—",
      BUCKET: data?.company?.tier || "—",
      TYPE: data?.company?.lifecycle_stage || "—",
    });
  }, [data?.asset?.symbol, data?.company?.lifecycle_stage, data?.company?.name, data?.company?.tier, metricLookup]);

  const operationalSummary = useMemo(() => {
    const keys = {
      productionStatus: ["production_status", "in_production", "phase"],
      productionTimeline: ["production_start", "first_production_date", "timeline"],
      quarterlyUpdate: ["latest_quarter", "revenue", "eps", "quarterly_update"],
    };

    const pick = (aliases: string[]) => aliases.map((alias) => metricLookup.get(alias)).find(Boolean) || "Behöver AI/research";

    return {
      productionStatus: pick(keys.productionStatus),
      productionTimeline: pick(keys.productionTimeline),
      quarterlyUpdate: pick(keys.quarterlyUpdate),
    };
  }, [metricLookup]);

  const generatePrompt = () => {
    if (!data?.company || !data.asset) return;
    const prompt = [
      `Analysera bolaget ${data.company.name} (${data.asset.symbol}) och fyll i alla fält nedan med senaste tillgängliga fakta och källor:`,
      investmentHeaders.join(" | "),
      "",
      "Besvara dessutom:",
      "- Är bolaget i produktion just nu?",
      "- Om nej, när förväntas produktionsstart och vilka milstolpar återstår?",
      "- Hur gick senaste kvartalsrapporten (intäkter, resultat, kassaflöde, guidning)?",
      "- Största risker och triggers kommande 12 månader.",
      "",
      "Använd korta, tydliga punkter och markera osäker data med 'ej verifierat'.",
    ].join("\n");
    setAiPrompt(prompt);
  };

  if (isLoading) return <AppLayout><PageSkeleton rows={3} /></AppLayout>;
  if (error) return <AppLayout><ErrorState message={error.message} onAction={() => refetch()} /></AppLayout>;
  if (!data?.asset || !data.company) return <AppLayout><EmptyState title="Company profile unavailable" message="This symbol does not have company intelligence yet." ctaLabel="Back" onCta={() => history.back()} /></AppLayout>;

  return (
    <AppLayout>
      <div className="space-y-4">
        <Card><CardHeader><CardTitle>{data.company.name} ({data.asset.symbol})</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2 text-sm"><p>Exchange: {data.asset.exchange || "—"}</p><p>Lifecycle stage: {data.company.lifecycle_stage}</p><p>Tier: {data.company.tier}</p><p>Jurisdiction: {data.company.jurisdiction || "—"}</p><p>Started: {data.company.started_year || "—"}</p></CardContent></Card>

        <Card><CardHeader><CardTitle>Metrics</CardTitle></CardHeader><CardContent>
          <Table><TableHeader><TableRow><TableHead>Metric</TableHead><TableHead>Value</TableHead><TableHead>As of</TableHead><TableHead>Source</TableHead></TableRow></TableHeader><TableBody>{data.metrics.map((m: MetricRow) => <TableRow key={m.id}><TableCell>{m.metric_key}</TableCell><TableCell>{m.value_number} {m.unit || ""}</TableCell><TableCell>{m.as_of_date}</TableCell><TableCell><a className="underline" href={m.source_url} target="_blank">{m.source_title || "Source"}</a></TableCell></TableRow>)}</TableBody></Table>
          {user && <p className="mt-2 text-xs text-muted-foreground">Metrics can only be created/edited/deleted by the original creator, and every metric requires a source URL.</p>}
        </CardContent></Card>

        <Card><CardHeader><CardTitle>Scenario panel (Estimate)</CardTitle></CardHeader><CardContent className="space-y-2"><div className="grid gap-2 sm:grid-cols-3"><Input value={gold} onChange={(e) => setGold(e.target.value)} placeholder="Gold price" /><Input value={silver} onChange={(e) => setSilver(e.target.value)} placeholder="Silver price" /><Input value={discountRate} onChange={(e) => setDiscountRate(e.target.value)} placeholder="Discount rate" /><Input value={multiple} onChange={(e) => setMultiple(e.target.value)} placeholder="EV/oz multiple" /><Input value={sharesOutstanding} onChange={(e) => setSharesOutstanding(e.target.value)} placeholder="Shares outstanding (optional)" /></div><p className="text-sm">Estimate: Implied EV = {estimates.impliedEV.toFixed(2)}</p><p className="text-sm">Estimate: Implied market cap = {estimates.impliedMarketCap.toFixed(2)}</p><p className="text-sm">Estimate: Implied price/share = {estimates.impliedPricePerShare == null ? "N/A" : estimates.impliedPricePerShare.toFixed(4)}</p></CardContent></Card>

        <Card>
          <CardHeader>
            <CardTitle>AI Helper (Company profiles)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={generatePrompt}>Skapa AI-underlag</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => aiPrompt && navigator.clipboard.writeText(aiPrompt)}
                disabled={!aiPrompt}
              >
                Kopiera prompt
              </Button>
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Field</TableHead>
                    <TableHead>Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {investmentHeaders.map((header) => (
                    <TableRow key={header}>
                      <TableCell className="font-medium">{header}</TableCell>
                      <TableCell>{helperValues[header]}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="grid gap-2 text-sm">
              <p><span className="font-medium">Produktion:</span> {operationalSummary.productionStatus}</p>
              <p><span className="font-medium">När går de i produktion:</span> {operationalSummary.productionTimeline}</p>
              <p><span className="font-medium">Senaste kvartalsrapport:</span> {operationalSummary.quarterlyUpdate}</p>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Klistra in prompten i valfri AI för att få en uppdaterad bolagsanalys med källor.</p>
              <Textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="AI prompt visas här..." className="min-h-[220px]" />
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
