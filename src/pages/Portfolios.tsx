import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import CreatePortfolioDialog from "@/components/CreatePortfolioDialog";
import ImportDialog from "@/components/ImportDialog";
import { Plus, Upload } from "lucide-react";
import TransactionImportDialog from "@/components/TransactionImportDialog";
import { useQuery } from "@tanstack/react-query";
import { PageSkeleton } from "@/components/feedback/PageSkeleton";
import { ErrorState } from "@/components/feedback/ErrorState";
import { EmptyState } from "@/components/feedback/EmptyState";
import { formatCurrency } from "@/lib/format";
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

const PAGE_SIZE = 25;

export default function PortfoliosPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [showImportFor, setShowImportFor] = useState<string | null>(null);
  const [showTxImportFor, setShowTxImportFor] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [deletingPortfolioId, setDeletingPortfolioId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portfolios", visibleCount],
    queryFn: async () => {
      const { data: portfolios } = await supabase.from("portfolios").select("id,name,visibility,base_currency").order("created_at", { ascending: false }).limit(visibleCount);
      const { data: valuations } = await supabase.from("portfolio_valuations").select("portfolio_id,total_value,as_of_date").order("as_of_date", { ascending: false }).limit(1000);
      const latest = new Map<string, number>();
      for (const row of valuations || []) if (!latest.has(row.portfolio_id)) latest.set(row.portfolio_id, Number(row.total_value));
      return (portfolios || []).map((p) => ({ ...p, latestValue: latest.get(p.id) ?? null }));
    },
  });

  useEffect(() => { if (searchParams.get("import") === "1" && data?.[0]) setShowImportFor(data[0].id); if (searchParams.get("tximport") === "1" && data?.[0]) setShowTxImportFor(data[0].id); }, [searchParams, data]);

  const canLoadMore = useMemo(() => (data?.length || 0) >= visibleCount, [data, visibleCount]);

  const handleDeletePortfolio = async () => {
    if (!deletingPortfolioId) return;
    const { error: deleteError } = await supabase.from("portfolios").delete().eq("id", deletingPortfolioId);
    if (deleteError) {
      toast.error(`Could not delete portfolio: ${deleteError.message}`);
      return;
    }
    toast.success("Portfolio deleted. Holdings, transactions, cached valuations, and compare visibility were removed.");
    setDeletingPortfolioId(null);
    await refetch();
  };

  return (
    <AppLayout>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Portfolios</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowImportFor(data?.[0]?.id || null)} className="gap-2" disabled={!data?.[0]}><Upload className="h-4 w-4" /> Import holdings</Button>
          <Button variant="secondary" onClick={() => setShowTxImportFor(data?.[0]?.id || null)} className="gap-2" disabled={!data?.[0]}><Upload className="h-4 w-4" /> Import transactions</Button>
          <Button onClick={() => setShowCreate(true)} className="gap-2"><Plus className="h-4 w-4" /> Create</Button>
        </div>
      </div>
      {isLoading && <PageSkeleton rows={3} />}
      {error && <ErrorState message={error.message} onAction={() => refetch()} />}
      {!isLoading && !error && data?.length === 0 && <EmptyState title="No portfolios yet" message="Create or import to get started." ctaLabel="Create portfolio" onCta={() => setShowCreate(true)} />}
      {!isLoading && !error && (data?.length || 0) > 0 && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {data!.map((p) => (
              <Card key={p.id}><CardHeader><CardTitle>{p.name}</CardTitle><Badge variant="secondary">{p.visibility}</Badge></CardHeader><CardContent className="space-y-3"><p className="text-sm">Total value: <span className="font-semibold">{p.latestValue == null ? "Estimated pending" : formatCurrency(p.latestValue, p.base_currency)}</span></p><div className="flex gap-2"><Link className="flex-1" to={`/portfolio/${p.id}`}><Button className="w-full">Open</Button></Link><Button variant="destructive" onClick={() => setDeletingPortfolioId(p.id)}>Delete</Button></div></CardContent></Card>
            ))}
          </div>
          {canLoadMore && <Button variant="ghost" className="mt-4" onClick={() => setVisibleCount((s) => s + PAGE_SIZE)}>Load more</Button>}
        </>
      )}
      <CreatePortfolioDialog open={showCreate} onOpenChange={setShowCreate} onCreated={refetch} />
      {showImportFor && <ImportDialog open={!!showImportFor} onOpenChange={() => setShowImportFor(null)} portfolioId={showImportFor} onImported={refetch} />}
      {showTxImportFor && <TransactionImportDialog open={!!showTxImportFor} onOpenChange={() => setShowTxImportFor(null)} portfolioId={showTxImportFor} onImported={refetch} />}
      <AlertDialog open={!!deletingPortfolioId} onOpenChange={(open) => !open && setDeletingPortfolioId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this portfolio?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes holdings, transactions, cached valuations, and comparison visibility tied to this portfolio.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDeletePortfolio}>Delete permanently</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
