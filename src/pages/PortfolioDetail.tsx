import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, ArrowLeft } from "lucide-react";
import AddHoldingDialog from "@/components/AddHoldingDialog";
import { toast } from "sonner";

interface Holding {
  id: string;
  quantity: number;
  avg_cost: number;
  cost_currency: string;
  asset: { id: string; symbol: string; name: string; asset_type: string; currency: string } | null;
  latest_price?: number | null;
}

export default function PortfolioDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [portfolio, setPortfolio] = useState<any>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const fetchData = async () => {
    if (!id) return;
    const { data: p } = await supabase.from("portfolios").select("*").eq("id", id).single();
    setPortfolio(p);

    const { data: h } = await supabase
      .from("holdings")
      .select("*, asset:assets(*)")
      .eq("portfolio_id", id);

    if (h) {
      // Fetch latest prices
      const assetIds = h.map((hh: any) => hh.asset?.id).filter(Boolean);
      let priceMap: Record<string, number> = {};
      if (assetIds.length > 0) {
        const { data: prices } = await supabase
          .from("prices")
          .select("asset_id, price")
          .in("asset_id", assetIds)
          .order("as_of_date", { ascending: false });
        if (prices) {
          for (const pr of prices) {
            if (!priceMap[pr.asset_id]) priceMap[pr.asset_id] = Number(pr.price);
          }
        }
      }
      setHoldings(h.map((hh: any) => ({
        ...hh,
        latest_price: hh.asset ? priceMap[hh.asset.id] ?? null : null,
      })));
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [id]);

  const isOwner = user && portfolio?.owner_user_id === user.id;

  const deleteHolding = async (holdingId: string) => {
    const { error } = await supabase.from("holdings").delete().eq("id", holdingId);
    if (error) toast.error(error.message);
    else {
      toast.success("Innehav borttaget");
      fetchData();
    }
  };

  const totalValue = holdings.reduce((sum, h) => {
    if (h.latest_price != null) return sum + h.quantity * h.latest_price;
    return sum;
  }, 0);

  const totalCost = holdings.reduce((sum, h) => sum + h.quantity * h.avg_cost, 0);

  const visibilityLabel = (v: string) => {
    const map: Record<string, string> = { private: "Privat", authenticated: "Inloggade", group: "Grupp", public: "Publik" };
    return map[v] || v;
  };

  if (loading) return <AppLayout><div className="animate-pulse"><div className="h-8 w-48 bg-muted rounded mb-4" /></div></AppLayout>;
  if (!portfolio) return <AppLayout><p>Portföljen hittades inte.</p></AppLayout>;

  return (
    <AppLayout>
      <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="gap-1 mb-4">
        <ArrowLeft className="h-4 w-4" /> Tillbaka
      </Button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold">{portfolio.name}</h1>
            <Badge variant={portfolio.visibility as any}>{visibilityLabel(portfolio.visibility)}</Badge>
          </div>
          {portfolio.description && <p className="text-muted-foreground">{portfolio.description}</p>}
        </div>
        {isOwner && (
          <Button variant="hero" onClick={() => setShowAdd(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Lägg till
          </Button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Totalvärde</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold font-mono">{totalValue.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} <span className="text-sm text-muted-foreground">{portfolio.base_currency}</span></p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total kostnad</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold font-mono">{totalCost.toLocaleString("sv-SE", { maximumFractionDigits: 0 })}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Innehav</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{holdings.length}</p></CardContent>
        </Card>
      </div>

      {/* Holdings table */}
      {holdings.length > 0 ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Namn</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead className="text-right">Antal</TableHead>
                <TableHead className="text-right">Snittpris</TableHead>
                <TableHead className="text-right">Senaste pris</TableHead>
                <TableHead className="text-right">Värde</TableHead>
                {isOwner && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {holdings.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="font-mono font-semibold">{h.asset?.symbol ?? "–"}</TableCell>
                  <TableCell>{h.asset?.name ?? "–"}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-xs">{h.asset?.asset_type ?? "–"}</Badge></TableCell>
                  <TableCell className="text-right font-mono">{h.quantity}</TableCell>
                  <TableCell className="text-right font-mono">{h.avg_cost.toLocaleString("sv-SE")}</TableCell>
                  <TableCell className="text-right font-mono">{h.latest_price != null ? h.latest_price.toLocaleString("sv-SE") : <span className="text-muted-foreground">N/A</span>}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{h.latest_price != null ? (h.quantity * h.latest_price).toLocaleString("sv-SE", { maximumFractionDigits: 0 }) : "–"}</TableCell>
                  {isOwner && (
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => deleteHolding(h.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <Card className="text-center py-12">
          <CardContent>
            <p className="text-muted-foreground">Inga innehav ännu. {isOwner ? "Lägg till ditt första innehav!" : ""}</p>
          </CardContent>
        </Card>
      )}

      {isOwner && (
        <AddHoldingDialog
          open={showAdd}
          onOpenChange={setShowAdd}
          portfolioId={portfolio.id}
          onAdded={fetchData}
        />
      )}
    </AppLayout>
  );
}
