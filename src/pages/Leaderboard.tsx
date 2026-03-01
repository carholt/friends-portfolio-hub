import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trophy, TrendingUp, TrendingDown } from "lucide-react";

export default function Leaderboard() {
  const { user } = useAuth();
  const [portfolios, setPortfolios] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      // Fetch all visible portfolios with their latest valuations
      const { data: pfs } = await supabase
        .from("portfolios")
        .select("id, name, owner_user_id, base_currency, visibility")
        .order("name");

      if (!pfs) { setLoading(false); return; }

      // Fetch latest valuations for these portfolios
      const pfIds = pfs.map(p => p.id);
      const { data: vals } = await supabase
        .from("portfolio_valuations")
        .select("portfolio_id, total_value, currency, as_of_date")
        .in("portfolio_id", pfIds)
        .order("as_of_date", { ascending: false });

      // Get owner display names
      const ownerIds = [...new Set(pfs.map(p => p.owner_user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", ownerIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p.display_name]) || []);
      const valMap = new Map<string, any>();
      vals?.forEach(v => {
        if (!valMap.has(v.portfolio_id)) valMap.set(v.portfolio_id, v);
      });

      const ranked = pfs.map(p => ({
        ...p,
        ownerName: profileMap.get(p.owner_user_id) || "–",
        latestValue: valMap.get(p.id)?.total_value ?? null,
        lastUpdated: valMap.get(p.id)?.as_of_date ?? null,
      })).sort((a, b) => (b.latestValue ?? 0) - (a.latestValue ?? 0));

      setPortfolios(ranked);
      setLoading(false);
    };

    fetchLeaderboard();
  }, [user]);

  return (
    <AppLayout>
      <div className="flex items-center gap-3 mb-6">
        <Trophy className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Leaderboard</h1>
      </div>

      <Card>
        {loading ? (
          <CardContent className="py-12 text-center text-muted-foreground">Laddar…</CardContent>
        ) : portfolios.length === 0 ? (
          <CardContent className="py-12 text-center text-muted-foreground">Inga portföljer att visa ännu.</CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Portfölj</TableHead>
                <TableHead>Ägare</TableHead>
                <TableHead>Synlighet</TableHead>
                <TableHead className="text-right">Värde</TableHead>
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
                    {p.latestValue != null ? Number(p.latestValue).toLocaleString("sv-SE", { maximumFractionDigits: 0 }) : "–"}
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
