import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trophy, ToggleLeft, ToggleRight } from "lucide-react";
import { fetchLeaderboard, type LeaderboardPeriod, type LeaderboardRow } from "@/services/leaderboard-service";
import { toast } from "sonner";

const PERIODS: LeaderboardPeriod[] = ["1M", "3M", "YTD", "1Y", "ALL"];

export default function Leaderboard() {
  const [portfolios, setPortfolios] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<LeaderboardPeriod>("ALL");
  const [showPct, setShowPct] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchLeaderboard(period);
        setPortfolios(data);
      } catch (error) {
        console.error(error);
        toast.error("Kunde inte hämta leaderboard.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [period]);

  const formatReturn = (p: LeaderboardRow) => {
    if (showPct) {
      if (p.return_pct == null) return "N/A";
      const sign = p.return_pct >= 0 ? "+" : "";
      return `${sign}${Number(p.return_pct).toFixed(1)}%`;
    }

    if (p.return_abs == null) return "N/A";
    const sign = p.return_abs >= 0 ? "+" : "";
    return `${sign}${Number(p.return_abs).toLocaleString("sv-SE", { maximumFractionDigits: 0 })}`;
  };

  const returnColor = (p: LeaderboardRow) => {
    const value = showPct ? p.return_pct : p.return_abs;
    if (value == null) return "text-muted-foreground";
    return value >= 0 ? "text-success" : "text-destructive";
  };

  return (
    <AppLayout>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Trophy className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Leaderboard</h1>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex rounded-lg overflow-hidden border border-border">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${period === p ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent"}`}
            >
              {p}
            </button>
          ))}
        </div>

        <Button variant="outline" size="sm" onClick={() => setShowPct(!showPct)} className="gap-2">
          {showPct ? <ToggleLeft className="h-4 w-4" /> : <ToggleRight className="h-4 w-4" />}
          {showPct ? "% avkastning" : "Absolut"}
        </Button>
      </div>

      <Card>
        {loading ? (
          <CardContent className="py-12 text-center text-muted-foreground">Laddar…</CardContent>
        ) : portfolios.length === 0 ? (
          <CardContent className="py-12 text-center text-muted-foreground">Inga portföljer att visa.</CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Portfölj</TableHead>
                <TableHead>Ägare</TableHead>
                <TableHead>Synlighet</TableHead>
                <TableHead className="text-right">Värde</TableHead>
                <TableHead className="text-right">Avkastning ({period})</TableHead>
                <TableHead className="text-right">Senast</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {portfolios.map((p, index) => (
                <TableRow key={p.portfolio_id}>
                  <TableCell className="font-bold text-muted-foreground">
                    {index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : index + 1}
                  </TableCell>
                  <TableCell className="font-semibold">{p.portfolio_name}</TableCell>
                  <TableCell className="text-muted-foreground">{p.owner_name || "–"}</TableCell>
                  <TableCell><Badge variant={p.visibility as any} className="text-xs">{p.visibility}</Badge></TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {p.end_value != null ? Number(p.end_value).toLocaleString("sv-SE", { maximumFractionDigits: 0 }) : "–"}
                  </TableCell>
                  <TableCell className={`text-right font-mono font-semibold ${returnColor(p)}`}>
                    {formatReturn(p)}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">{p.last_updated || "–"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </AppLayout>
  );
}
