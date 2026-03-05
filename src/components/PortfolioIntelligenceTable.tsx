import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { calculateIntelligence } from "@/lib/intelligence";

const longColumns = ["investment_recommendation", "properties_ownership", "management_team", "share_structure", "location", "projected_growth", "market_buzz", "cost_structure_financing", "cash_debt_position"];
const overrideBuckets = ["Major Producer", "Mid Tier Producer", "Junior Producer", "Near Term Producer", "Late Stage Developer", "Early Stage Explorer", "Developer", "Explorer", "Unclassified"];

export default function PortfolioIntelligenceTable({ portfolioId, holdings, prices, baseCurrency, canOverrideBucket }: { portfolioId: string; holdings: any[]; prices: Map<string, number>; baseCurrency: string; canOverrideBucket: boolean }) {
  const [research, setResearch] = useState<Record<string, any>>({});
  const [showResearch, setShowResearch] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("asset_research" as never).select("*").eq("portfolio_id", portfolioId).then(({ data }) => {
      const map: Record<string, any> = {};
      (data || []).forEach((r: any) => { map[r.asset_id] = r; });
      setResearch(map);
    });
  }, [portfolioId]);

  const total = useMemo(() => holdings.reduce((sum, h) => sum + (Number(h.quantity) * Number(prices.get(h.asset_id) || 0)), 0), [holdings, prices]);

  const saveCell = (assetId: string, key: string, value: any) => {
    const existing = research[assetId] || { portfolio_id: portfolioId, asset_id: assetId, assumptions: {}, sources: [] };
    const next = { ...existing, [key]: value };
    setResearch((prev) => ({ ...prev, [assetId]: next }));

    window.clearTimeout((saveCell as any)._timer);
    (saveCell as any)._timer = window.setTimeout(async () => {
      await supabase.from("asset_research" as never).upsert(next as never, { onConflict: "portfolio_id,asset_id" });
      await supabase.rpc("refresh_asset_research" as never, { _portfolio_id: portfolioId } as never);
      const { data } = await supabase.from("asset_research" as never).select("*").eq("portfolio_id", portfolioId);
      const map: Record<string, any> = {};
      (data || []).forEach((r: any) => { map[r.asset_id] = r; });
      setResearch(map);
      setSavedAt(new Date().toLocaleTimeString());
    }, 450);
  };

  const exportRows = holdings.map((h: any) => {
    const r = research[h.asset_id] || {};
    const calc = calculateIntelligence({
      shares: Number(h.quantity),
      avgCost: Number(h.avg_cost || 0),
      currentPrice: prices.get(h.asset_id) ?? null,
      projectedPrice: r.projected_price == null ? null : Number(r.projected_price),
      portfolioTotal: total,
    });
    return {
      TICKER: h.asset?.symbol,
      NAME: h.asset?.name,
      BUCKET: r.bucket_override || r.bucket_computed || "Unclassified",
      "BUCKET CONFIDENCE": r.bucket_confidence ?? 0,
      TYPE: r.thesis_type || "",
      Weight: calc.weight == null ? "unpriced" : `${(calc.weight * 100).toFixed(2)}%`,
      SHARES: Number(h.quantity),
      "AVERAGE BUY PRICE": Number(h.avg_cost || 0),
      INVESTMENT: calc.investment,
      "PROJECTED PRICE": r.projected_price ?? "",
      "POTENTIAL UPSIDE": calc.potentialUpside == null ? "" : `${(calc.potentialUpside * 100).toFixed(2)}%`,
      ROI: calc.roi == null ? "" : `${(calc.roi * 100).toFixed(2)}%`,
      Rating: r.rating || "",
    };
  });

  return <div className="space-y-3">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm"><Switch checked={showResearch} onCheckedChange={setShowResearch} /> Show research columns {savedAt && <span className="text-xs text-muted-foreground">Saved {savedAt}</span>}</div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => {
          const headers = Object.keys(exportRows[0] || {});
          const csv = [headers.join(","), ...exportRows.map((r) => headers.map((h) => `"${String((r as any)[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
          const blob = new Blob([csv], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "portfolio-intelligence.csv"; a.click();
        }}>Export CSV</Button>
      </div>
    </div>

    <div className="overflow-auto border rounded max-h-[68vh]">
      <TooltipProvider>
        <Table>
          <TableHeader className="sticky top-0 bg-background z-20"><TableRow>
            <TableHead>TICKER</TableHead><TableHead>NAME</TableHead><TableHead>BUCKET</TableHead><TableHead>TYPE</TableHead><TableHead>Weight</TableHead><TableHead>SHARES</TableHead><TableHead>AVERAGE BUY PRICE</TableHead><TableHead>INVESTMENT</TableHead><TableHead>PROJECTED PRICE</TableHead><TableHead>POTENTIAL UPSIDE</TableHead><TableHead>ROI</TableHead><TableHead>Rating</TableHead><TableHead>Assumptions</TableHead>
            {showResearch && <><TableHead>INVESTMENT RECOMMENDATION</TableHead><TableHead>Properties / Ownership</TableHead><TableHead>Management Team</TableHead><TableHead>Share Structure</TableHead><TableHead>Location</TableHead><TableHead>Projected Growth</TableHead><TableHead>Market Buzz</TableHead><TableHead>Cost Structure / Financing</TableHead><TableHead>Cash / Debt Position</TableHead><TableHead>Low valuation estimate</TableHead><TableHead>High valuation estimate</TableHead></>}
          </TableRow></TableHeader>
          <TableBody>{holdings.map((h: any) => {
            const r = research[h.asset_id] || { assumptions: {}, sources: [] };
            const calc = calculateIntelligence({ shares: Number(h.quantity), avgCost: Number(h.avg_cost || 0), currentPrice: prices.get(h.asset_id) ?? null, projectedPrice: r.projected_price == null ? null : Number(r.projected_price), portfolioTotal: total });
            const confidence = Number(r.bucket_confidence || 0);
            const confidenceClass = confidence >= 0.9 ? "bg-green-500" : confidence >= 0.6 ? "bg-yellow-500" : "bg-red-500";
            return <TableRow key={h.id}>
              <TableCell>{h.asset?.symbol}</TableCell><TableCell>{h.asset?.name}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span>{r.bucket_override || r.bucket_computed || "Unclassified"}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className={`inline-block h-2.5 w-2.5 rounded-full ${confidenceClass}`} />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Confidence: {(confidence * 100).toFixed(0)}%</p>
                      <p>{r.bucket_reason || "Insufficient data"}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                {canOverrideBucket && <Select value={r.bucket_override || "__none"} onValueChange={(value) => saveCell(h.asset_id, "bucket_override", value === "__none" ? null : value)}>
                  <SelectTrigger className="mt-1 h-8"><SelectValue placeholder="Override bucket" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Use computed bucket</SelectItem>
                    {overrideBuckets.map((bucket) => <SelectItem key={bucket} value={bucket}>{bucket}</SelectItem>)}
                  </SelectContent>
                </Select>}
              </TableCell>
              <TableCell><Input value={r.thesis_type || ""} onChange={(e) => saveCell(h.asset_id, "thesis_type", e.target.value)} /></TableCell>
              <TableCell>{calc.weight == null ? "unpriced" : `${(calc.weight * 100).toFixed(2)}%`}</TableCell>
              <TableCell>{Number(h.quantity)}</TableCell>
              <TableCell>{Number(h.avg_cost || 0).toFixed(2)} {baseCurrency}</TableCell>
              <TableCell>{calc.investment.toFixed(2)} {baseCurrency}</TableCell>
              <TableCell><Input value={r.projected_price ?? ""} onChange={(e) => saveCell(h.asset_id, "projected_price", e.target.value ? Number(e.target.value) : null)} /></TableCell>
              <TableCell>{calc.potentialUpside == null ? "-" : `${(calc.potentialUpside * 100).toFixed(2)}%`}</TableCell>
              <TableCell>{calc.roi == null ? "-" : `${(calc.roi * 100).toFixed(2)}%`}</TableCell>
              <TableCell><Input value={r.rating || ""} onChange={(e) => saveCell(h.asset_id, "rating", e.target.value)} /></TableCell>
              <TableCell>
                <Drawer>
                  <DrawerTrigger asChild><Button variant="outline" size="sm">Scenario</Button></DrawerTrigger>
                  <DrawerContent><DrawerHeader><DrawerTitle>{h.asset?.symbol} assumptions</DrawerTitle></DrawerHeader>
                    <div className="p-4 space-y-3">
                      {[["gold_price_usd", 6000, 0, 12000], ["silver_price_usd", 75, 0, 200], ["target_multiple", 1.2, 0, 5], ["discount_rate", 0.08, 0, 0.5]].map(([k, d, mn, mx]) => {
                        const val = Number((r.assumptions || {})[k] ?? d);
                        return <div key={String(k)}><div className="text-xs">{String(k)}: {val}</div><Slider min={Number(mn)} max={Number(mx)} step={0.01} value={[val]} onValueChange={(v) => saveCell(h.asset_id, "assumptions", { ...(r.assumptions || {}), [k]: v[0] })} /></div>;
                      })}
                      <Textarea placeholder="Sources JSON array" value={JSON.stringify(r.sources || [], null, 2)} onChange={(e) => { try { saveCell(h.asset_id, "sources", JSON.parse(e.target.value || "[]")); } catch { /* no-op */ } }} />
                    </div>
                  </DrawerContent>
                </Drawer>
              </TableCell>
              {showResearch && (
                <>
                  {longColumns.map((col) => <TableCell key={col}><Textarea value={r[col] || ""} onChange={(e) => saveCell(h.asset_id, col, e.target.value)} /></TableCell>)}
                  <TableCell><Input value={r.low_valuation_estimate ?? ""} onChange={(e) => saveCell(h.asset_id, "low_valuation_estimate", e.target.value ? Number(e.target.value) : null)} /></TableCell>
                  <TableCell><Input value={r.high_valuation_estimate ?? ""} onChange={(e) => saveCell(h.asset_id, "high_valuation_estimate", e.target.value ? Number(e.target.value) : null)} /></TableCell>
                </>
              )}
            </TableRow>;
          })}</TableBody>
        </Table>
      </TooltipProvider>
    </div>
  </div>;
}
