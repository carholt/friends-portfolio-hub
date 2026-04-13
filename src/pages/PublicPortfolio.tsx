import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrendingUp, Globe } from "lucide-react";
import { convertCurrency } from "@/lib/portfolio-utils";
import type { Tables } from "@/integrations/supabase/types";

interface Holding {
  id: string;
  quantity: number;
  avg_cost: number;
  cost_currency: string;
  asset: { id: string; symbol: string; name: string; asset_type: string; currency: string } | null;
  latest_price?: number | null;
}

type PublicPortfolioRow = Tables<"portfolios">;
type HoldingRow = Tables<"holdings">;
type AssetRow = Tables<"assets">;
type PriceRow = Tables<"asset_prices">;

export default function PublicPortfolio() {
  const { slug } = useParams<{ slug: string }>();
  const [portfolio, setPortfolio] = useState<PublicPortfolioRow | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [ownerName, setOwnerName] = useState("–");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const fetch = async () => {
      if (!slug) { setNotFound(true); setLoading(false); return; }

      const { data: p } = await supabase
        .from("portfolios")
        .select("*")
        .eq("public_slug", slug)
        .eq("visibility", "public")
        .single();

      if (!p) { setNotFound(true); setLoading(false); return; }
      setPortfolio(p);

      // Owner name
      const { data: profile } = await supabase.from("profiles").select("display_name").eq("user_id", p.owner_user_id).single();
      if (profile) setOwnerName(profile.display_name || "–");

      // Holdings with prices
      const { data: h } = await supabase
        .from("holdings")
        .select("*, asset:assets(*)")
        .eq("portfolio_id", p.id);

      if (h) {
        const typedHoldings = h as Array<HoldingRow & { asset: AssetRow | null }>;
        const assetIds = typedHoldings.map((hh) => hh.asset?.id).filter((id): id is string => Boolean(id));
        const priceMap: Record<string, number> = {};
        if (assetIds.length > 0) {
          const { data: prices } = await supabase
            .from("asset_prices")
            .select("asset_id, price")
            .in("asset_id", assetIds)
            .order("price_date", { ascending: false });
          if (prices) {
            for (const pr of prices as Array<Pick<PriceRow, "asset_id" | "price">>) {
              if (!priceMap[pr.asset_id]) priceMap[pr.asset_id] = Number(pr.price);
            }
          }
        }
        setHoldings(typedHoldings.map((hh) => ({
          ...hh,
          latest_price: hh.asset ? priceMap[hh.asset.id] ?? null : null,
        })));
      }
      setLoading(false);
    };
    fetch();
  }, [slug]);

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
    </div>
  );

  if (notFound) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Card className="max-w-md text-center">
        <CardContent className="pt-6">
          <Globe className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-xl font-bold mb-2">Portföljen hittades inte</h2>
          <p className="text-muted-foreground">Denna publika portfölj existerar inte eller har ändrat synlighet.</p>
        </CardContent>
      </Card>
    </div>
  );

  if (!portfolio) return null;

  const totalValue = holdings.reduce((sum, h) => {
    if (h.latest_price == null || !h.asset) return sum;
    const { value } = convertCurrency(h.quantity * h.latest_price, h.asset.currency, portfolio.base_currency);
    return sum + value;
  }, 0);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b glass">
        <div className="container flex items-center justify-between py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-gold">
              <TrendingUp className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold">PortfolioTracker</span>
          </div>
          <Badge variant="public">Publik portfölj</Badge>
        </div>
      </header>

      <main className="container py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-1">{portfolio.name}</h1>
          {portfolio.description && <p className="text-muted-foreground mb-2">{portfolio.description}</p>}
          <p className="text-sm text-muted-foreground">Av {ownerName} · Uppdaterad {new Date(portfolio.updated_at).toLocaleDateString("sv-SE")}</p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Totalvärde</CardTitle></CardHeader>
            <CardContent>
              <p className="text-2xl font-bold font-mono">
                {totalValue.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} {portfolio.base_currency}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Innehav</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{holdings.length}</p></CardContent>
          </Card>
        </div>

        {holdings.length > 0 && (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Namn</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead className="text-right">Antal</TableHead>
                  <TableHead className="text-right">Senaste pris</TableHead>
                  <TableHead className="text-right">Värde ({portfolio.base_currency})</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holdings.map(h => {
                  const rawValue = h.latest_price != null ? h.quantity * h.latest_price : null;
                  const converted = rawValue != null && h.asset ? convertCurrency(rawValue, h.asset.currency, portfolio.base_currency) : null;
                  return (
                    <TableRow key={h.id}>
                      <TableCell className="font-mono font-semibold">{h.asset?.symbol ?? "–"}</TableCell>
                      <TableCell>{h.asset?.name ?? "–"}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-xs">{h.asset?.asset_type}</Badge></TableCell>
                      <TableCell className="text-right font-mono">{h.quantity}</TableCell>
                      <TableCell className="text-right font-mono">{h.latest_price != null ? h.latest_price.toLocaleString("sv-SE") : "N/A"}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {converted ? (
                          <>
                            {converted.value.toLocaleString("sv-SE", { maximumFractionDigits: 0 })}
                            {!converted.converted && <span className="text-xs text-warning ml-1">⚠ FX</span>}
                          </>
                        ) : "–"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </main>
    </div>
  );
}
