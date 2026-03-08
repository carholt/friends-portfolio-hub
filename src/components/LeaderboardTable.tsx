import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LeaderboardEntry } from "@/hooks/useLeaderboard";

type LeaderboardTableProps = {
  rows: LeaderboardEntry[];
};

export function LeaderboardTable({ rows }: LeaderboardTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Rank</TableHead>
          <TableHead>Portfolio</TableHead>
          <TableHead className="text-right">Value</TableHead>
          <TableHead className="text-right">Return %</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={row.portfolio_id}>
            <TableCell>{index + 1}</TableCell>
            <TableCell>{row.portfolio_name}</TableCell>
            <TableCell className="text-right">{row.total_value.toLocaleString()}</TableCell>
            <TableCell className="text-right">{row.return_pct.toFixed(2)}%</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
