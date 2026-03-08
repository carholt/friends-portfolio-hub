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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSessionGuard } from "@/hooks/useSessionGuard";
import { logAuditAction } from "@/lib/audit";
import { shouldShowOnboarding } from "@/lib/onboarding";
import { useAppBootstrap } from "@/hooks/useAppBootstrap";

export default function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [step, setStep] = useState(1);
  const [portfolioName, setPortfolioName] = useState("My first portfolio");
  const [currency, setCurrency] = useState("USD");
  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [onboardingOpen, setOnboardingOpen] = useState(true);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [completingOnboarding, setCompletingOnboarding] = useState(false);

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

  const completeOnboarding = async () => {
    if (!user) return;
    setOnboardingError(null);

    if (!visibility) {
      setOnboardingError("Please choose portfolio visibility.");
      return;
    }

    if (!portfolioName.trim()) {
      setOnboardingError("Portfolio name is required.");
      setStep(1);
      return;
    }

    if (!symbol.trim() || !quantity || Number(quantity) <= 0) {
      setOnboardingError("Please add a valid symbol and quantity before finishing setup.");
      setStep(2);
      return;
    }

    setCompletingOnboarding(true);
    try {
      const { data: created, error: createError } = await supabase
        .from("portfolios")
        .insert({ name: portfolioName.trim(), base_currency: currency, owner_user_id: user.id, visibility })
        .select("id")
        .single();

      if (createError || !created?.id) {
        setOnboardingError(createError?.message || "Could not create your portfolio. You can skip for now and create one later.");
        setOnboardingOpen(false);
        return;
      }

      await logAuditAction("portfolio_create", "portfolio", created.id, { source: "onboarding" });
      const clean = symbol.toUpperCase().trim();
      const { data: existing } = await supabase.from("assets").select("id").eq("symbol", clean).maybeSingle();
      const assetId = existing?.id || (await supabase.from("assets").insert({ symbol: clean, name: clean, asset_type: "stock", currency: currency }).select("id").single()).data?.id;
      if (assetId) {
        await supabase.from("holdings").insert({ portfolio_id: created.id, asset_id: assetId, quantity: Number(quantity), avg_cost: Number(avgCost || 0), cost_currency: currency });
        await logAuditAction("holding_add", "portfolio", created.id, { source: "onboarding", symbol: clean });
      }

      const { error: profileUpdateError } = await supabase.from("profiles").update({ onboarding_completed: true }).eq("user_id", user.id);
      if (profileUpdateError) {
        setOnboardingError("Portfolio created, but onboarding status was not saved. You can continue using the app.");
      }

      setOnboardingOpen(false);
      await refetch();
    } finally {
      setCompletingOnboarding(false);
    }
  };

  const shouldOpenOnboarding = shouldShowOnboarding({
    profileLoaded: !!bootstrap?.profileLoaded,
    profileError: !!bootstrap?.profileError || !!bootstrapError,
    onboardingCompleted: bootstrap?.onboardingCompleted,
    portfolioCount: bootstrap?.portfolioCount,
    dismissed: !onboardingOpen,
  });

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
            {(bootstrap?.portfolioCount ?? 0) === 0 && <p className="text-sm text-muted-foreground">No portfolios yet. Create one to get started.</p>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={() => setShowCreate(true)}>Create portfolio</Button>
              <Button variant="outline" onClick={() => navigate("/portfolios?import=1")} className="gap-2"><Import className="h-4 w-4" /> Import portfolio</Button>
              <Button variant="secondary" onClick={() => navigate("/portfolios?tximport=1")} className="gap-2"><Import className="h-4 w-4" /> Import transactions</Button>
              <Button variant="outline" onClick={() => navigate("/portfolios")}>Add holding</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={shouldOpenOnboarding} onOpenChange={setOnboardingOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Let’s get you started ({step}/3)</DialogTitle></DialogHeader>
          {step === 1 && <div className="space-y-2"><Label>Create your first portfolio</Label><Input value={portfolioName} onChange={(e) => setPortfolioName(e.target.value)} /><Select value={currency} onValueChange={setCurrency}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="SEK">SEK</SelectItem><SelectItem value="EUR">EUR</SelectItem></SelectContent></Select><Button className="w-full" onClick={() => setStep(2)} disabled={!portfolioName.trim()}>Next</Button></div>}
          {step === 2 && <div className="space-y-2"><Label>Add your first holding</Label><Input placeholder="Symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} /><Input placeholder="Quantity" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /><Input placeholder="Avg cost (optional)" type="number" value={avgCost} onChange={(e) => setAvgCost(e.target.value)} /><Button className="w-full" onClick={() => setStep(3)} disabled={!symbol || !quantity}>Next</Button></div>}
          {step === 3 && <div className="space-y-3"><Label>Choose visibility</Label><Select value={visibility} onValueChange={setVisibility}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="private">Private</SelectItem><SelectItem value="authenticated">Logged-in</SelectItem><SelectItem value="group">Group</SelectItem><SelectItem value="public">Public</SelectItem></SelectContent></Select>{onboardingError && <p className="text-sm text-destructive">{onboardingError}</p>}<div className="flex gap-2"><Button variant="outline" className="w-full" onClick={() => setOnboardingOpen(false)}>Skip for now</Button><Button className="w-full" onClick={completeOnboarding} disabled={completingOnboarding}>{completingOnboarding ? "Finishing…" : "Finish setup"}</Button></div></div>}
        </DialogContent>
      </Dialog>

      <CreatePortfolioDialog open={showCreate} onOpenChange={setShowCreate} onCreated={() => navigate("/portfolios")} />
    </AppLayout>
  );
}
