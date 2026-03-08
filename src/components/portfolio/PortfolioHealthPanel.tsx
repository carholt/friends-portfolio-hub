import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

const dimensions = [
  { key: "diversification", label: "Diversification", help: "Measures spread across holdings and buckets." },
  { key: "concentration", label: "Concentration risk", help: "Lower single-position concentration improves this score." },
  { key: "quality", label: "Return quality", help: "Compares profitable positions versus weak performers." },
  { key: "valuation", label: "Valuation attractiveness", help: "Blend of fair value upside and current profitability." },
  { key: "resilience", label: "Drawdown resilience", help: "Penalizes large losing positions that can drag the portfolio." },
  { key: "income", label: "Income generation", help: "Estimated yield contribution from dividend-focused positions." },
] as const;

export type HealthScores = Record<(typeof dimensions)[number]["key"], number>;

export function buildHealthScores(holdings: any[], totalValue: number): HealthScores {
  const safeTotal = totalValue || 1;
  const weights = holdings.map((h) => (Number(h.quantity) * Number(h.latest_price || 0)) / safeTotal);
  const maxWeight = weights.length ? Math.max(...weights) : 0;
  const hhi = weights.reduce((sum, w) => sum + w * w, 0);
  const gains = holdings.filter((h) => Number(h.latest_price || 0) >= Number(h.avg_cost || 0)).length;
  const losers = holdings.length - gains;
  const avgUpside = holdings.length
    ? holdings.reduce((sum, h) => sum + ((Number(h.avg_cost || 0) > 0 ? (Number(h.avg_cost || 0) - Number(h.latest_price || 0)) / Number(h.avg_cost || 1) : 0) * -100), 0) / holdings.length
    : 0;
  const downsideWeight = holdings.reduce((sum, h) => {
    const value = Number(h.quantity) * Number(h.latest_price || 0);
    const pnl = Number(h.latest_price || 0) - Number(h.avg_cost || 0);
    return pnl < 0 ? sum + value : sum;
  }, 0) / safeTotal;

  return {
    diversification: Math.max(20, Math.min(100, 100 - hhi * 100)),
    concentration: Math.max(15, Math.min(100, 100 - maxWeight * 120)),
    quality: holdings.length ? Math.max(0, Math.min(100, ((gains - losers) / holdings.length) * 50 + 50)) : 50,
    valuation: Math.max(0, Math.min(100, avgUpside + 50)),
    resilience: Math.max(0, Math.min(100, 100 - downsideWeight * 100)),
    income: Math.max(5, Math.min(100, 30 + holdings.filter((h) => /income|dividend|reit/i.test(String(h.bucket || ""))).length * 12)),
  };
}

export default function PortfolioHealthPanel({ scores }: { scores: HealthScores }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio Health</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {dimensions.map((d) => {
          const value = Math.round(scores[d.key]);
          const positive = value >= 65;
          const warning = value < 45;
          return (
            <div key={d.key} className="space-y-1" title={d.help}>
              <div className="flex items-center justify-between text-sm">
                <span>{d.label}</span>
                <div className="flex items-center gap-2">
                  <Badge variant={positive ? "default" : warning ? "destructive" : "secondary"}>{positive ? "Strong" : warning ? "Watch" : "Stable"}</Badge>
                  <span className="font-semibold">{value}</span>
                </div>
              </div>
              <Progress value={value} />
              <p className="text-xs text-muted-foreground">{positive ? "Positive signal" : warning ? "Potential risk to review" : "Mixed signal with room to improve"} · {d.help}</p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
