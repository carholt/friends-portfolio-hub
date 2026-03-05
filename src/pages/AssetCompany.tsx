import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/feedback/ErrorState";
import { EmptyState } from "@/components/feedback/EmptyState";
import { PageSkeleton } from "@/components/feedback/PageSkeleton";
import { isCompanyAiReport, type CompanyAiReport } from "@/lib/company-ai-report";
import { requestCompanyAiReport } from "@/lib/company-ai-report-client";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type MetricRow = {
  id: string;
  metric_key: string | null;
  value_number: number | null;
  unit: string | null;
  as_of_date: string | null;
  source_url: string | null;
  source_title: string | null;
};

type AiReportRow = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  created_at: string;
  completed_at: string | null;
  report: unknown;
  sources: unknown;
  error: string | null;
  assumptions: Record<string, unknown>;
};

const reportFields: Array<[label: string, key: keyof CompanyAiReport]> = [
  ["ticker", "ticker"], ["name", "name"], ["bucket", "bucket"], ["type", "type"],
  ["properties_ownership", "properties_ownership"], ["management_team", "management_team"], ["share_structure", "share_structure"],
  ["location", "location"], ["projected_growth", "projected_growth"], ["market_buzz", "market_buzz"],
  ["cost_structure_financing", "cost_structure_financing"], ["cash_debt_position", "cash_debt_position"],
  ["low_valuation_estimate", "low_valuation_estimate"], ["high_valuation_estimate", "high_valuation_estimate"],
  ["projected_price", "projected_price"], ["investment_recommendation", "investment_recommendation"],
  ["rating", "rating"], ["rationale", "rationale"], ["key_risks", "key_risks"], ["key_catalysts", "key_catalysts"],
  ["last_updated", "last_updated"],
];

const unlockPrice = Number(import.meta.env.VITE_REPORT_UNLOCK_PRICE || "0");
const reportCurrency = (import.meta.env.VITE_REPORT_CURRENCY || "USD").toUpperCase();

export default function AssetCompanyPage() {
  const { user } = useAuth();
  const { symbol } = useParams<{ symbol: string }>();
  const queryClient = useQueryClient();
  const [goldPrice, setGoldPrice] = useState("2200");
  const [silverPrice, setSilverPrice] = useState("25");
  const [targetMultiple, setTargetMultiple] = useState("120");
  const [discountRate, setDiscountRate] = useState("8");

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

  const { data: reports = [] } = useQuery({
    queryKey: ["company-ai-reports", data?.asset?.id],
    enabled: !!data?.asset?.id,
    refetchInterval: (query) => {
      const rows = (query.state.data as AiReportRow[] | undefined) ?? [];
      const pending = rows.some((row) => row.status === "queued" || row.status === "running");
      return pending ? 3000 : false;
    },
    queryFn: async () => {
      const { data: rows, error: reportsError } = await (supabase as any)
        .from("company_ai_reports")
        .select("id,status,created_at,completed_at,report,sources,error,assumptions")
        .eq("asset_id", data!.asset!.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (reportsError) throw reportsError;
      return (rows || []) as AiReportRow[];
    }
  });

  const latest = reports[0] || null;
  const latestCompleted = reports.find((row) => row.status === "completed" && isCompanyAiReport(row.report));
  const latestReport = latestCompleted?.report as CompanyAiReport | undefined;

  const { data: hasAccess = false, refetch: refetchAccess } = useQuery({
    queryKey: ["report-access", user?.id, latestCompleted?.id],
    enabled: !!user?.id && !!latestCompleted?.id,
    queryFn: async () => {
      const { data: access, error: accessError } = await (supabase as any).rpc("user_has_access_to_report", {
        _user_id: user!.id,
        _report_id: latestCompleted!.id,
      });
      if (accessError) throw accessError;
      return !!access;
    }
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("purchase") === "success") {
      refetchAccess();
      queryClient.invalidateQueries({ queryKey: ["company-ai-reports", data?.asset?.id] });
    }
  }, [data?.asset?.id, queryClient, refetchAccess]);

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!latestCompleted?.id) return;
      const successUrl = `${window.location.origin}${window.location.pathname}?purchase=success`;
      const cancelUrl = `${window.location.origin}${window.location.pathname}?purchase=cancel`;
      const { data: response, error: purchaseError } = await supabase.functions.invoke("purchase-report", {
        body: { report_id: latestCompleted.id, success_url: successUrl, cancel_url: cancelUrl },
      });
      if (purchaseError) throw purchaseError;
      if (response?.already_unlocked) {
        await refetchAccess();
        return;
      }
      if (response?.checkout_url) window.location.href = response.checkout_url;
    }
  });

  const generateMutation = useMutation({
    mutationFn: async ({ mode, force }: { mode: "standard" | "quick"; force?: boolean }) => {
      if (!data?.asset?.id) return;
      const assumptions = {
        gold_price_usd: Number(goldPrice) || null,
        silver_price_usd: Number(silverPrice) || null,
        target_multiple: Number(targetMultiple) || null,
        discount_rate: Number(discountRate) || null,
        mode,
        force: !!force,
      };

      const reportId = await requestCompanyAiReport({ assetId: data.asset.id, portfolioId: null, assumptions });
      const { error: invokeError } = await supabase.functions.invoke("company-ai-report", { body: { report_id: reportId } });
      if (invokeError) throw invokeError;
      return reportId;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["company-ai-reports", data?.asset?.id] });
    }
  });

  const statusLabel = latest ? `${latest.status}${latest.error ? `: ${latest.error}` : ""}` : "No report yet";
  const showPaywall = !!user && !!latestReport && !hasAccess;

  if (isLoading) return <AppLayout><PageSkeleton rows={3} /></AppLayout>;
  if (error) return <AppLayout><ErrorState message={(error as Error).message} onAction={() => refetch()} /></AppLayout>;
  if (!data?.asset || !data.company) return <AppLayout><EmptyState title="Company profile unavailable" message="This symbol does not have company intelligence yet." ctaLabel="Back" onCta={() => history.back()} /></AppLayout>;

  return (
    <AppLayout>
      <Dialog open={showPaywall}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlock AI Report</DialogTitle>
            <DialogDescription>
              This report is paywalled. Purchase access for {unlockPrice > 0 ? `${unlockPrice.toFixed(2)} ${reportCurrency}` : "a one-time fee"}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => purchaseMutation.mutate()} disabled={purchaseMutation.isPending}>Purchase report</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-4">
        <Card><CardHeader><CardTitle>{data.company.name} ({data.asset.symbol})</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2 text-sm"><p>Exchange: {data.asset.exchange || "—"}</p><p>Lifecycle stage: {data.company.lifecycle_stage}</p><p>Tier: {data.company.tier}</p><p>Jurisdiction: {data.company.jurisdiction || "—"}</p><p>Started: {data.company.started_year || "—"}</p></CardContent></Card>

        <Card><CardHeader><CardTitle>Metrics</CardTitle></CardHeader><CardContent>
          <Table><TableHeader><TableRow><TableHead>Metric</TableHead><TableHead>Value</TableHead><TableHead>As of</TableHead><TableHead>Source</TableHead></TableRow></TableHeader><TableBody>{data.metrics.map((m: MetricRow) => <TableRow key={m.id}><TableCell>{m.metric_key}</TableCell><TableCell>{m.value_number} {m.unit || ""}</TableCell><TableCell>{m.as_of_date}</TableCell><TableCell><a className="underline" href={m.source_url || "#"} target="_blank" rel="noreferrer">{m.source_title || "Source"}</a></TableCell></TableRow>)}</TableBody></Table>
        </CardContent></Card>

        <Card>
          <CardHeader><CardTitle>AI report assumptions</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Input value={goldPrice} onChange={(e) => setGoldPrice(e.target.value)} placeholder="gold_price_usd" />
            <Input value={silverPrice} onChange={(e) => setSilverPrice(e.target.value)} placeholder="silver_price_usd" />
            <Input value={targetMultiple} onChange={(e) => setTargetMultiple(e.target.value)} placeholder="target_multiple" />
            <Input value={discountRate} onChange={(e) => setDiscountRate(e.target.value)} placeholder="discount_rate" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>AI helper workflow (server-side)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center">
              <Button onClick={() => generateMutation.mutate({ mode: "standard" })} disabled={!user || generateMutation.isPending}>Generate AI report</Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={!user || generateMutation.isPending}>Regenerate</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => generateMutation.mutate({ mode: "standard", force: true })}>Standard (web search)</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => generateMutation.mutate({ mode: "quick", force: true })}>Quick (context only)</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <p className="text-sm text-muted-foreground">Status: {statusLabel}</p>
            </div>

            {latestReport && hasAccess && (
              <>
                <div className="grid gap-2 md:grid-cols-3">
                  <Card><CardHeader><CardTitle className="text-base">Rating</CardTitle></CardHeader><CardContent>{latestReport.rating}</CardContent></Card>
                  <Card><CardHeader><CardTitle className="text-base">Bucket / Type</CardTitle></CardHeader><CardContent>{latestReport.bucket} / {latestReport.type}</CardContent></Card>
                  <Card><CardHeader><CardTitle className="text-base">Projected price range</CardTitle></CardHeader><CardContent>{latestReport.low_valuation_estimate ?? "—"} - {latestReport.high_valuation_estimate ?? "—"}</CardContent></Card>
                </div>

                <div className="rounded-md border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Field</TableHead><TableHead>Value</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {reportFields.map(([label, key]) => (
                        <TableRow key={label}>
                          <TableCell className="font-medium">{label}</TableCell>
                          <TableCell>{Array.isArray(latestReport[key]) ? (latestReport[key] as string[]).join(", ") : String(latestReport[key] ?? "—")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div>
                  <h3 className="font-medium mb-2">Sources</h3>
                  <ul className="space-y-2 text-sm">
                    {latestReport.sources.map((source) => (
                      <li key={`${source.url}-${source.title}`}>
                        <a href={source.url} target="_blank" rel="noreferrer" className="underline">{source.title}</a>
                        <p className="text-muted-foreground">{source.snippet}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            <Accordion type="single" collapsible>
              <AccordionItem value="history">
                <AccordionTrigger>Compare previous (report history)</AccordionTrigger>
                <AccordionContent>
                  <ul className="space-y-2 text-sm">
                    {reports.map((row) => (
                      <li key={row.id} className="rounded border p-2">
                        <p className="font-medium">{new Date(row.created_at).toLocaleString()} · {row.status}</p>
                        <p className="text-muted-foreground">{row.error || "No error"}</p>
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
