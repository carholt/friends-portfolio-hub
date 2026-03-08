import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";

type SortKey = "symbol" | "value" | "weight" | "totalReturn" | "upside";

export default function HoldingsTable({
  holdings,
  baseCurrency,
  onResolve,
  onEdit,
  onDelete,
}: {
  holdings: any[];
  baseCurrency: string;
  onResolve: (holding: any) => void;
  onEdit: (holding: any) => void;
  onDelete: (holding: any) => void;
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [compact, setCompact] = useState(true);
  const [riskFilter, setRiskFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const totalValue = useMemo(() => holdings.reduce((sum, h) => sum + Number(h.quantity) * Number(h.latest_price || 0), 0), [holdings]);

  const rows = useMemo(() => {
    const mapped = holdings.map((h) => {
      const value = Number(h.quantity) * Number(h.latest_price || 0);
      const cost = Number(h.quantity) * Number(h.avg_cost || 0);
      const totalReturn = value - cost;
      const totalReturnPct = cost > 0 ? (totalReturn / cost) * 100 : 0;
      const fairValue = Number(h.avg_cost || 0) * 1.12;
      const upside = Number(h.latest_price || 0) > 0 ? ((fairValue - Number(h.latest_price || 0)) / Number(h.latest_price || 1)) * 100 : 0;
      const unresolved = h.asset?.symbol_resolution_status === "invalid" || h.asset?.symbol_resolution_status === "ambiguous" || h.latest_price == null;
      const concentration = totalValue > 0 ? (value / totalValue) * 100 : 0;
      return {
        ...h,
        value,
        cost,
        totalReturn,
        totalReturnPct,
        fairValue,
        upside,
        unresolved,
        concentration,
        ai: totalReturnPct > 10 ? "Accumulate" : totalReturnPct < -10 ? "Risk" : "Hold",
      };
    });

    const filtered = mapped.filter((row) => {
      const q = search.toLowerCase();
      const matches = !q || String(row.asset?.symbol || "").toLowerCase().includes(q) || String(row.asset?.name || "").toLowerCase().includes(q);
      const riskMatch = riskFilter === "all" || (riskFilter === "high" ? row.concentration > 20 : row.concentration <= 20);
      return matches && riskMatch;
    });

    return filtered.sort((a, b) => {
      if (sortKey === "symbol") return String(a.asset?.symbol || "").localeCompare(String(b.asset?.symbol || ""));
      if (sortKey === "value") return b.value - a.value;
      if (sortKey === "weight") return b.concentration - a.concentration;
      if (sortKey === "totalReturn") return b.totalReturnPct - a.totalReturnPct;
      return b.upside - a.upside;
    });
  }, [holdings, search, riskFilter, sortKey, totalValue]);

  if (!holdings.length) {
    return (
      <Card>
        <CardHeader><CardTitle>No holdings yet</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Start by importing from your broker or add a holding manually to unlock performance, health, and AI insights.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle>Holdings</CardTitle>
        <div className="flex flex-col gap-2 lg:flex-row">
          <Input aria-label="Search holdings" placeholder="Search symbol or company" value={search} onChange={(e) => setSearch(e.target.value)} className="lg:max-w-sm" />
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="lg:w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="value">Sort: Value</SelectItem>
              <SelectItem value="symbol">Sort: Symbol</SelectItem>
              <SelectItem value="weight">Sort: Weight</SelectItem>
              <SelectItem value="totalReturn">Sort: Total return</SelectItem>
              <SelectItem value="upside">Sort: Upside</SelectItem>
            </SelectContent>
          </Select>
          <Select value={riskFilter} onValueChange={setRiskFilter}>
            <SelectTrigger className="lg:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All risk</SelectItem>
              <SelectItem value="high">High concentration</SelectItem>
              <SelectItem value="balanced">Balanced</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => setCompact((prev) => !prev)}>{compact ? "Expanded mode" : "Compact mode"}</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 overflow-x-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              <TableHead>Symbol / Company</TableHead><TableHead>Last Price</TableHead><TableHead>Fair Value / Upside</TableHead><TableHead>Total return</TableHead><TableHead>Value</TableHead><TableHead>Weight</TableHead><TableHead>AI</TableHead><TableHead>Risk</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <Fragment key={row.id}>
                <TableRow key={row.id} data-testid="holding-row">
                  <TableCell>
                    <div className="font-medium"><Link className="underline" to={`/assets/${row.asset?.symbol}`}>{row.asset?.symbol}</Link></div>
                    <div className="text-xs text-muted-foreground">{row.asset?.name || "Unknown"}</div>
                  </TableCell>
                  <TableCell>{formatCurrency(Number(row.latest_price || 0), baseCurrency)}</TableCell>
                  <TableCell>
                    <div>{formatCurrency(row.fairValue, baseCurrency)}</div>
                    <div className={`text-xs ${row.upside >= 0 ? "text-emerald-600" : "text-red-600"}`}>{row.upside.toFixed(1)}%</div>
                  </TableCell>
                  <TableCell className={row.totalReturn >= 0 ? "text-emerald-600" : "text-red-600"}>{formatCurrency(row.totalReturn, baseCurrency)} ({row.totalReturnPct.toFixed(1)}%)</TableCell>
                  <TableCell>{formatCurrency(row.value, baseCurrency)}</TableCell>
                  <TableCell>{row.concentration.toFixed(1)}%</TableCell>
                  <TableCell><Badge variant={row.ai === "Risk" ? "destructive" : row.ai === "Accumulate" ? "default" : "secondary"}>{row.ai}</Badge></TableCell>
                  <TableCell><Badge variant={row.concentration > 20 ? "destructive" : "secondary"}>{row.concentration > 20 ? "Concentrated" : "Balanced"}</Badge></TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>{expanded === row.id ? "Hide" : "Details"}</Button></TableCell>
                </TableRow>
                {expanded === row.id && (
                  <TableRow>
                    <TableCell colSpan={9}>
                      <div className="grid gap-2 text-sm md:grid-cols-2">
                        <div>Bucket: <span className="font-medium">{row.bucket || "General"}</span> · Shares: {row.quantity} · Avg buy: {formatCurrency(Number(row.avg_cost || 0), baseCurrency)}</div>
                        <div>AI note: {row.ai === "Risk" ? "Position has deteriorating return quality." : "Why this matters: aligns with portfolio objective."}</div>
                        <div>Symbol mapping: {row.unresolved ? "Needs review" : "Resolved"} · Exchange: {row.asset?.exchange || "Unknown"}</div>
                        <div className="flex flex-wrap gap-2">
                          {row.unresolved && <Button size="sm" variant="outline" onClick={() => onResolve(row)}>Fix symbol</Button>}
                          <Button size="sm" variant="outline" onClick={() => onEdit(row)}>Edit</Button>
                          <Button size="sm" variant="destructive" onClick={() => onDelete(row)}>Remove</Button>
                          <Button size="sm" variant="secondary" asChild><Link to={`/assets/${row.asset?.symbol}`}>Analyze</Link></Button>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
        {!compact && <p className="text-xs text-muted-foreground">Expanded mode keeps advanced details in-row for faster review and actions.</p>}
      </CardContent>
    </Card>
  );
}
