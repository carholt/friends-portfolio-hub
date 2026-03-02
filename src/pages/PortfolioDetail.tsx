import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportToCSV, exportToJSON } from "@/lib/portfolio-utils";
import { toast } from "sonner";

interface Holding {
  id: string;
  quantity: number;
  avg_cost: number;
  cost_currency: string;
  asset: { id: string; symbol: string; name: string; currency: string; asset_type: string; exchange: string | null } | null;
  latest_price?: number | null;
}

export default function PortfolioDetail() {
  const { id } = useParams<{ id: string }>();
  const [portfolio, setPortfolio] = useState<any>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [period, setPeriod] = useState("1M");
  const [showDetails, setShowDetails] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const [avgCost, setAvgCost] = useState("");

  const load = async () => {
    if (!id) return;
    const { data: p } = await supabase.from("portfolios").select("*").eq("id", id).single();
    setPortfolio(p);
    const { data } = await supabase.from("holdings").select("*, asset:assets(*)").eq("portfolio_id", id);
    const assetIds = (data || []).map((h: any) => h.asset?.id).filter(Boolean);
    const latestPrice = new Map<string, number>();
    if (assetIds.length > 0) {
      const { data: prices } = await supabase.from("prices").select("asset_id,price").in("asset_id", assetIds).order("as_of_date", { ascending: false });
      for (const p of prices || []) if (!latestPrice.has(p.asset_id)) latestPrice.set(p.asset_id, Number(p.price));
    }
    setHoldings((data || []).map((h: any) => ({ ...h, latest_price: h.asset?.id ? latestPrice.get(h.asset.id) ?? null : null })));
  };

  useEffect(() => { load(); }, [id]);

  const totalValue = useMemo(() => holdings.reduce((sum, h) => sum + Number(h.quantity) * Number(h.latest_price || 0), 0), [holdings]);
  const totalCost = useMemo(() => holdings.reduce((sum, h) => sum + Number(h.quantity) * Number(h.avg_cost || 0), 0), [holdings]);
  const pnl = totalValue - totalCost;

  const updateVisibility = async (value: string) => {
    if (!id) return;
    const { error } = await supabase.from("portfolios").update({ visibility: value }).eq("id", id);
    if (error) toast.error(error.message); else setPortfolio((prev: any) => ({ ...prev, visibility: value }));
  };

  const addHolding = async () => {
    if (!id || !symbol || !quantity) return;
    const clean = symbol.toUpperCase().trim();
    let assetId: string | null = null;
    const { data: existing } = await supabase.from("assets").select("id").eq("symbol", clean).maybeSingle();
    if (existing?.id) assetId = existing.id;
    else {
      const { data: created, error } = await supabase.from("assets").insert({ symbol: clean, name: clean, asset_type: "stock", currency: "USD", metadata_json: { imported: true } }).select("id").single();
      if (error) return toast.error(error.message);
      assetId = created.id;
    }
    const { error } = await supabase.from("holdings").insert({ portfolio_id: id, asset_id: assetId, quantity: Number(quantity), avg_cost: Number(avgCost || 0), cost_currency: "USD" });
    if (error) return toast.error(error.message);
    setSymbol(""); setQuantity(""); setAvgCost("");
    await load();
  };

  if (!portfolio) return <AppLayout><p>Loading...</p></AppLayout>;

  return (
    <AppLayout>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{portfolio.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-3xl font-bold">{totalValue.toLocaleString()} {portfolio.base_currency}</p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{period} return:</span>
              <span className={pnl >= 0 ? "text-green-600" : "text-red-600"}>{pnl.toLocaleString()}</span>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="1M">1M</SelectItem><SelectItem value="3M">3M</SelectItem><SelectItem value="1Y">1Y</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="max-w-xs">
              <Select value={portfolio.visibility} onValueChange={updateVisibility}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Private</SelectItem>
                  <SelectItem value="authenticated">Logged-in users</SelectItem>
                  <SelectItem value="group">Group</SelectItem>
                  <SelectItem value="public">Public</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => exportToCSV(portfolio.name, holdings)}>Export CSV</Button>
              <Button variant="outline" onClick={() => exportToJSON(portfolio, holdings)}>Export JSON</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Holdings</CardTitle>
            <Button variant="ghost" onClick={() => setShowDetails((s) => !s)}>{showDetails ? "Hide details" : "Show details"}</Button>
          </CardHeader>
          <CardContent>
            {holdings.length === 0 ? <p className="text-sm text-muted-foreground">No holdings yet. Add your first one below.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Symbol</TableHead><TableHead>Qty</TableHead><TableHead>Value</TableHead><TableHead>P/L</TableHead>{showDetails && <><TableHead>Avg cost</TableHead><TableHead>Type</TableHead></>}</TableRow></TableHeader>
                <TableBody>
                  {holdings.map((h) => {
                    const value = Number(h.quantity) * Number(h.latest_price || 0);
                    const cost = Number(h.quantity) * Number(h.avg_cost || 0);
                    return <TableRow key={h.id}><TableCell>{h.asset?.symbol}</TableCell><TableCell>{h.quantity}</TableCell><TableCell>{value.toLocaleString()}</TableCell><TableCell>{(value - cost).toLocaleString()}</TableCell>{showDetails && <><TableCell>{h.avg_cost}</TableCell><TableCell>{h.asset?.asset_type}</TableCell></>}</TableRow>;
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Add holding</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-4">
            <Input placeholder="Symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
            <Input placeholder="Quantity" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            <Input placeholder="Avg cost (optional)" type="number" value={avgCost} onChange={(e) => setAvgCost(e.target.value)} />
            <Button onClick={addHolding}>Save</Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
