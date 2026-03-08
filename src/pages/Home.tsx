import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import CreatePortfolioDialog from "@/components/CreatePortfolioDialog";
import { Import } from "lucide-react";
import { PageSkeleton } from "@/components/feedback/PageSkeleton";
import { ErrorState } from "@/components/feedback/ErrorState";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSessionGuard } from "@/hooks/useSessionGuard";
import { shouldShowOnboarding } from "@/lib/onboarding";
import { useAppBootstrap } from "@/hooks/useAppBootstrap";

export default function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(true);
  const [onboardingCompletedLocal, setOnboardingCompletedLocal] = useState(false);

  const { data: bootstrap, error: bootstrapError } = useAppBootstrap();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["home", user?.id],
    queryFn: async () => {
      const { data: values, error: valuesError } = await supabase
        .from("portfolio_valuations")
        .select("portfolio_id,total_value,as_of_date")
        .order("as_of_date", { ascending: false })
        .limit(500);
      if (valuesError) throw valuesError;
      return { values: values || [] };
    },
    enabled: !!user,
  });
  useSessionGuard(error?.message);

  const summary = useMemo(() => {
    const values = data?.values || [];
    const latestByPortfolio = new Map<string, { value: number; date: string }>();
    const firstByPortfolio = new Map<string, number>();
    for (const row of values) if (!latestByPortfolio.has(row.portfolio_id)) latestByPortfolio.set(row.portfolio_id, { value: Number(row.total_value), date: row.as_of_date });
    for (const row of [...values].reverse()) firstByPortfolio.set(row.portfolio_id, Number(row.total_value));
    let total = 0; let baseTotal = 0; let latestDate: string | null = null;
    for (const [id, latest] of latestByPortfolio.entries()) {
      total += latest.value; baseTotal += firstByPortfolio.get(id) ?? latest.value;
      if (!latestDate || latest.date > latestDate) latestDate = latest.date;
    }
    return { total, change: latestByPortfolio.size > 0 ? total - baseTotal : null, date: latestDate };
  }, [data]);

  const shouldOpenOnboarding = !onboardingCompletedLocal
    && onboardingOpen
    && shouldShowOnboarding(bootstrap?.profile);

  const handleOnboardingOpenChange = (open: boolean) => {
    setOnboardingOpen(open);
    if (!open) {
      setOnboardingCompletedLocal(true);
    }
  };

  const hasNoPortfolios = (bootstrap?.portfolioCount ?? 0) === 0;

  return (
    <AppLayout>
      {(error || bootstrapError) && <ErrorState message={error?.message || bootstrapError?.message || "Failed to load data"} onAction={() => refetch()} />}
      {isLoading ? <PageSkeleton rows={2} /> : (
        <Card className="max-w-2xl">
          <CardHeader><CardTitle>Your summary</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div>
              <p className="text-3xl font-bold">{summary.total.toLocaleString()} SEK</p>
              <p className="text-sm text-muted-foreground">{summary.change == null ? "No return data yet" : `${summary.change >= 0 ? "+" : ""}${summary.change.toLocaleString()} this period`}</p>
              <p className="mt-1 text-xs text-muted-foreground">Last price update: {summary.date ? new Date(summary.date).toLocaleDateString() : "No prices yet"}</p>
            </div>

            {hasNoPortfolios && (
              <div className="rounded-md border p-4">
                <p className="text-lg font-semibold">No portfolios yet</p>
                <p className="text-sm text-muted-foreground">You can continue using the app and create or import a portfolio anytime.</p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Button onClick={() => setShowCreate(true)}>Create portfolio</Button>
                  <Button variant="outline" onClick={() => navigate("/portfolios?import=1")} className="gap-2"><Import className="h-4 w-4" />Import portfolio</Button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={() => setShowCreate(true)}>Create portfolio</Button>
              <Button variant="outline" onClick={() => navigate("/portfolios?import=1")} className="gap-2"><Import className="h-4 w-4" /> Import portfolio</Button>
              <Button variant="secondary" onClick={() => navigate("/portfolios?tximport=1")} className="gap-2"><Import className="h-4 w-4" /> Import transactions</Button>
              <Button variant="outline" onClick={() => navigate("/portfolios")}>Add holding</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={shouldOpenOnboarding} onOpenChange={handleOnboardingOpenChange}>
        <DialogContent>
          <DialogHeader><DialogTitle>Welcome</DialogTitle><DialogDescription>Optional onboarding</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">You can skip onboarding and start using the app immediately.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="w-full" onClick={() => setShowCreate(true)}>Create Portfolio</Button>
              <Button variant="outline" className="w-full" onClick={() => navigate("/portfolios?import=1")}>Import portfolio</Button>
            </div>
            <Button variant="ghost" className="w-full" onClick={() => handleOnboardingOpenChange(false)}>Skip for now</Button>
          </div>
        </DialogContent>
      </Dialog>

      <CreatePortfolioDialog open={showCreate} onOpenChange={setShowCreate} onCreated={() => navigate("/portfolios")} />
    </AppLayout>
  );
}
