import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trophy, TrendingUp, TrendingDown, ToggleLeft, ToggleRight } from "lucide-react";
import { getPeriodStartDate } from "@/lib/portfolio-utils";

const PERIODS = ["1M", "3M", "YTD", "1Y", "ALL"] as const;

interface RankedPortfolio {
  id: string;
  name: string;
  visibility: string;
  ownerName: string;
  startValue: number | null;
  endValue: number | null;
  returnPct: number | null;
  returnAbs: number | null;
  lastUpdated: string | null;
}

export default function Leaderboard() {
  const { user } = useAuth();
  const [portfolios, setPortfolios] = useState<RankedPortfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<string>("ALL");
  const [showPct, setShowPct] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      setLoading(true);
      const { data: pfs } = await supabase
        .from("portfolios")
        .select("id, name, owner_user_id, base_currency, visibility")
        .order("name");

      if (!pfs) { setLoading(false); return; }

      const pfIds = pfs.map(p => p.id);
      const periodStart = getPeriodStartDate(period).toISOString().split("T")[0];

      // Fetch all valuations for these portfolios
      const { data: vals } = await supabase
        .from("portfolio_valuations")
        .select("portfolio_id, total_value, currency, as_of_date")
        .in("portfolio_id", pfIds)
        .order("as_of_date", { ascending: true });

      // Owner names
      const ownerIds = [...new Set(pfs.map(p => p.owner_user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", ownerIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p.display_name]) || []);

      // Group valuations by portfolio
      const valsByPf = new Map<string, any[]>();
      vals?.forEach(v => {
        const arr = valsByPf.get(v.portfolio_id) || [];
        arr.push(v);
        valsByPf.set(v.portfolio_id, arr);
      });

      const ranked: RankedPortfolio[] = pfs.map(p => {
        const allVals = valsByPf.get(p.id) || [];
        // Filter by period
        const periodVals = allVals.filter(v => v.as_of_date >= periodStart);
        const startVal = periodVals.length > 0 ? Number(periodVals[0].total_value) : null;
        const endVal = periodVals.length > 0 ? Number(periodVals[periodVals.length - 1].total_value) : (allVals.length > 0 ? Number(allVals[allVals.length - 1].total_value) : null);
        const returnAbs = startVal != null && endVal != null ? endVal - startVal : null;
        const returnPct = startVal != null && startVal > 0 && returnAbs != null ? (returnAbs / startVal) * 100 : null;
        const lastDate = allVals.length > 0 ? allVals[allVals.length - 1].as_of_date : null;

        return {
          id: p.id,
          name: p.name,
          visibility: p.visibility,
          ownerName: profileMap.get(p.owner_user_id) || "–",
          startValue: startVal,
          endValue: endVal,
          returnPct,
          returnAbs,
          lastUpdated: lastDate,
        };
      });

      // Sort by selected metric
      ranked.sort((a, b) => {
        const aVal = showPct ? a.returnPct : a.returnAbs;
        const bVal = showPct ? b.returnPct : b.returnAbs;
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        return bVal - aVal;
      });

      setPortfolios(ranked);
      setLoading(false);
    };

    fetchLeaderboard();
  }, [user, period, showPct]);

  const formatReturn = (p: RankedPortfolio) => {
    if (showPct) {
      if (p.returnPct == null) return "N/A";
      const sign = p.returnPct >= 0 ? "+" : "";
      return `${sign}${p.returnPct.toFixed(1)}%`;
    }
    if (p.returnAbs == null) return "N/A";
    const sign = p.returnAbs >= 0 ? "+" : "";
    return `${sign}${p.returnAbs.toLocaleString("sv-SE", { maximumFractionDigits: 0 })}`;
  };

  const returnColor = (p: RankedPortfolio) => {
    const val = showPct ? p.returnPct : p.returnAbs;
    if (val == null) return "text-muted-foreground";
    return val >= 0 ? "text-success" : "text-destructive";
  };

  return (
    <AppLayout>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Trophy className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Leaderboard</h1>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex rounded-lg overflow-hidden border border-border">
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${period === p ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent"}`}
            >
              {p}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowPct(!showPct)}
          className="gap-2"
        >
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
              {portfolios.map((p, i) => (
                <TableRow key={p.id}>
                  <TableCell className="font-bold text-muted-foreground">
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                  </TableCell>
                  <TableCell className="font-semibold">{p.name}</TableCell>
                  <TableCell className="text-muted-foreground">{p.ownerName}</TableCell>
                  <TableCell><Badge variant={p.visibility as any} className="text-xs">{p.visibility}</Badge></TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {p.endValue != null ? Number(p.endValue).toLocaleString("sv-SE", { maximumFractionDigits: 0 }) : "–"}
                  </TableCell>
                  <TableCell className={`text-right font-mono font-semibold ${returnColor(p)}`}>
                    {formatReturn(p)}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {p.lastUpdated || "–"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </AppLayout>
  );
}
