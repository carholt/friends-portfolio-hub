import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { HoldingItem } from "@/lib/mining-dashboard";

type SortKey = keyof HoldingItem;

export function DashboardHoldingsTable({ holdings }: { holdings: HoldingItem[] }) {
  const [search, setSearch] = useState("");
  const [metalFilter, setMetalFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("position_value");
  const [desc, setDesc] = useState(true);

  const metals = useMemo(() => Array.from(new Set(holdings.map((h) => h.metal))), [holdings]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = holdings.filter((h) => {
      const matchesSearch = !q || h.symbol.toLowerCase().includes(q) || h.name.toLowerCase().includes(q) || h.jurisdiction.toLowerCase().includes(q);
      const matchesMetal = metalFilter === "all" || h.metal === metalFilter;
      return matchesSearch && matchesMetal;
    });

    return filtered.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return desc ? -cmp : cmp;
    });
  }, [holdings, search, metalFilter, sortKey, desc]);

  const toggleSort = (next: SortKey) => {
    if (sortKey === next) setDesc((v) => !v);
    else {
      setSortKey(next);
      setDesc(next === "position_value" || next === "portfolio_weight");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input aria-label="Search holdings" placeholder="Search symbol, company, jurisdiction" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select
          className="h-10 rounded-md border bg-background px-3 text-sm"
          value={metalFilter}
          onChange={(e) => setMetalFilter(e.target.value)}
        >
          <option value="all">All metals</option>
          {metals.map((metal) => <option key={metal} value={metal}>{metal}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {[
                ["symbol", "Symbol"],
                ["name", "Name"],
                ["stage", "Stage"],
                ["metal", "Metal"],
                ["jurisdiction", "Jurisdiction"],
                ["position_value", "Position Value"],
                ["portfolio_weight", "Portfolio Weight"],
                ["ev_oz_rating", "EV/oz rating"],
              ].map(([key, label]) => (
                <TableHead key={key}>
                  <button className="text-left hover:underline" onClick={() => toggleSort(key as SortKey)}>{label}</button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((h) => (
              <TableRow key={`${h.symbol}-${h.name}`}>
                <TableCell className="font-medium">{h.symbol}</TableCell>
                <TableCell>{h.name}</TableCell>
                <TableCell>{h.stage}</TableCell>
                <TableCell>{h.metal}</TableCell>
                <TableCell>{h.jurisdiction}</TableCell>
                <TableCell>${h.position_value.toLocaleString()}</TableCell>
                <TableCell>{h.portfolio_weight.toFixed(1)}%</TableCell>
                <TableCell>{h.ev_oz_rating}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
