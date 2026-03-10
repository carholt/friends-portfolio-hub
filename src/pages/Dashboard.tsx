import { useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/feedback/ErrorState";
import { PageSkeleton } from "@/components/feedback/PageSkeleton";
import { ArrowDownRight, ArrowUpRight, Plus, Search, Wallet } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMiningDashboard, usePrimaryPortfolio } from "@/hooks/useMiningDashboard";
import { DashboardHoldingsTable } from "@/components/dashboard/DashboardHoldingsTable";
import { JurisdictionRiskChart, MetalExposureChart, PerformanceChart, StageBreakdownChart } from "@/components/dashboard/DashboardCharts";

function MetricCard({ title, value, delta, positive }: { title: string; value: string; delta?: string; positive?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
        {delta && (
          <div className={`mt-1 inline-flex items-center gap-1 text-xs ${positive ? "text-green-600" : "text-red-500"}`}>
            {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
            {delta}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<"7D" | "30D" | "90D" | "1Y">("30D");

  const { data: portfolio, isLoading: portfolioLoading, error: portfolioError } = usePrimaryPortfolio();
  const { data, isLoading, error, refetch } = useMiningDashboard(portfolio?.id);

  const summary = data?.valuationSummary;
  const deepValueNames = useMemo(
    () => (summary?.deepValue || []).filter((x) => x.signal.toLowerCase().includes("deep")).map((x) => x.symbol),
    [summary?.deepValue],
  );

  if (portfolioLoading || isLoading) {
    return <AppLayout><PageSkeleton rows={4} /></AppLayout>;
  }

  if (portfolioError || error) {
    return (
      <AppLayout>
        <ErrorState title="Unable to load dashboard" message={(portfolioError?.message || error?.message || "Please retry")} onAction={() => refetch()} />
      </AppLayout>
    );
  }

  if (!portfolio) {
    return (
      <AppLayout>
        <Card>
          <CardContent className="py-10 text-center">
            <Wallet className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h2 className="text-lg font-semibold">No portfolio found</h2>
            <p className="text-sm text-muted-foreground">Create your first portfolio to unlock the mining investor dashboard.</p>
            <Button className="mt-4" onClick={() => navigate("/portfolios")}>Create portfolio</Button>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Mining Investor Dashboard</h1>
            <p className="text-sm text-muted-foreground">{portfolio.name} · Gold & Silver focused portfolio analytics</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate(`/portfolio/${portfolio.id}`)}>Add Transaction</Button>
            <Button variant="outline" onClick={() => navigate(`/portfolio/${portfolio.id}`)}><Plus className="mr-1 h-4 w-4" />Add Asset</Button>
            <Button onClick={() => refetch()}><Search className="mr-1 h-4 w-4" />Run Insight Scan</Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Portfolio Value" value={`$${summary?.portfolioValue.toLocaleString() ?? "0"}`} delta={summary?.dailyChangePct != null ? `${summary.dailyChangePct.toFixed(2)}%` : undefined} positive={(summary?.dailyChange || 0) >= 0} />
          <MetricCard title="Daily Change" value={`$${summary?.dailyChange.toLocaleString() ?? "0"}`} delta={summary?.dailyChangePct != null ? `${summary.dailyChangePct.toFixed(2)}% today` : undefined} positive={(summary?.dailyChange || 0) >= 0} />
          <MetricCard title="30 Day Return" value={`$${summary?.return30d.toLocaleString() ?? "0"}`} delta={summary?.return30dPct != null ? `${summary.return30dPct.toFixed(2)}%` : undefined} positive={(summary?.return30d || 0) >= 0} />
          <MetricCard title="Number of Holdings" value={`${summary?.holdingsCount ?? 0}`} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Portfolio Performance</CardTitle>
              <div className="flex gap-1 rounded-md border p-1">
                {(["7D", "30D", "90D", "1Y"] as const).map((r) => (
                  <Button key={r} size="sm" variant={range === r ? "secondary" : "ghost"} onClick={() => setRange(r)}>{r}</Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              <PerformanceChart points={summary?.timeline || []} range={range} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Metal Exposure</CardTitle></CardHeader>
            <CardContent><MetalExposureChart data={data?.exposureByMetal || []} /></CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Jurisdiction Risk</CardTitle></CardHeader>
            <CardContent><JurisdictionRiskChart data={data?.exposureByJurisdiction || []} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Company Stage Breakdown</CardTitle></CardHeader>
            <CardContent><StageBreakdownChart data={data?.stageBreakdown || []} /></CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader><CardTitle>Valuation Signals</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(summary?.deepValue || []).map((item) => (
                <div key={`${item.symbol}-${item.signal}`} className="flex items-center justify-between rounded-md border p-2">
                  <span className="font-medium">{item.symbol}</span>
                  <Badge variant={item.signal.toLowerCase().includes("deep") ? "destructive" : "secondary"}>{item.signal}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Investor Insights</CardTitle></CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {(data?.insights || []).map((insight) => (
                <div key={insight.title} className="rounded-md border p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="font-medium">{insight.title}</p>
                    <Badge variant={insight.severity === "high" ? "destructive" : insight.severity === "medium" ? "warning" : "secondary"}>{insight.severity}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{insight.description}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Holdings</CardTitle>
            {deepValueNames.length > 0 && <p className="text-sm text-muted-foreground">Deep value watchlist: {deepValueNames.join(", ")}</p>}
          </CardHeader>
          <CardContent>
            <DashboardHoldingsTable holdings={data?.holdings || []} />
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
