import { useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchLeaderboard } from "@/services/leaderboard-service";
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/feedback/ErrorState";
import { EmptyState } from "@/components/feedback/EmptyState";
import { PageSkeleton } from "@/components/feedback/PageSkeleton";

export default function Leaderboard() {
  const [showPct, setShowPct] = useState(true);
  const [visibleCount, setVisibleCount] = useState(10);
  const { data: rows = [], isLoading, error, refetch } = useQuery({ queryKey: ["leaderboard", "1M"], queryFn: () => fetchLeaderboard("1M") });

  return (
    <AppLayout>
      <div className="mb-4 flex items-center justify-between"><h1 className="text-2xl font-bold">Leaderboard</h1><Button variant="outline" onClick={() => setShowPct((v) => !v)}>{showPct ? "% return" : "Absolute return"}</Button></div>
      <Card><CardContent className="pt-6">
        {isLoading && <PageSkeleton rows={4} />}
        {error && <ErrorState message={error.message} onAction={() => refetch()} />}
        {!isLoading && !error && rows.length === 0 && <EmptyState title="No ranked portfolios yet" message="Once portfolios get valuations, they will appear here." ctaLabel="Go to portfolios" onCta={() => (window.location.href = "/portfolios")} />}
        {!isLoading && !error && rows.length > 0 && <><Table><TableHeader><TableRow><TableHead>#</TableHead><TableHead>Portfolio</TableHead><TableHead>Owner</TableHead><TableHead className="text-right">Return (1M)</TableHead></TableRow></TableHeader><TableBody>{rows.slice(0, visibleCount).map((r, i) => <TableRow key={r.portfolio_id}><TableCell>{i + 1}</TableCell><TableCell>{r.portfolio_name}</TableCell><TableCell>{r.owner_name}</TableCell><TableCell className="text-right">{showPct ? `${Number(r.return_pct || 0).toFixed(1)}%` : Number(r.return_abs || 0).toLocaleString()}</TableCell></TableRow>)}</TableBody></Table>{rows.length > visibleCount && <Button variant="ghost" className="mt-4" onClick={() => setVisibleCount((v) => v + 10)}>Show more</Button>}</>}
      </CardContent></Card>
    </AppLayout>
  );
}
