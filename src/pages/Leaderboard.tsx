import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchLeaderboard, type LeaderboardRow } from "@/services/leaderboard-service";

export default function Leaderboard() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [showPct, setShowPct] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => { fetchLeaderboard("1M").then(setRows).catch(() => setRows([])); }, []);

  const visibleRows = showAll ? rows : rows.slice(0, 10);

  return (
    <AppLayout>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Leaderboard</h1>
        <Button variant="outline" onClick={() => setShowPct((v) => !v)}>{showPct ? "% return" : "Absolute return"}</Button>
      </div>
      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? <p className="text-muted-foreground">No accessible portfolios yet.</p> : (
            <>
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Portfolio</TableHead><TableHead>Owner</TableHead><TableHead className="text-right">Return (1M)</TableHead></TableRow></TableHeader>
                <TableBody>
                  {visibleRows.map((r, i) => <TableRow key={r.portfolio_id}><TableCell>{i + 1}</TableCell><TableCell>{r.portfolio_name}</TableCell><TableCell>{r.owner_name}</TableCell><TableCell className="text-right">{showPct ? `${Number(r.return_pct || 0).toFixed(1)}%` : Number(r.return_abs || 0).toLocaleString()}</TableCell></TableRow>)}
                </TableBody>
              </Table>
              {rows.length > 10 && <Button variant="ghost" className="mt-4" onClick={() => setShowAll((s) => !s)}>{showAll ? "Show top 10" : `Show all (${rows.length})`}</Button>}
            </>
          )}
        </CardContent>
      </Card>
    </AppLayout>
  );
}
