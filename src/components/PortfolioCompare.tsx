import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type CompareRow = {
  portfolio_id: string;
  name: string;
  owner: string;
  total_value: number;
  total_cost: number;
  return_pct: number;
  largest_position: string;
  risk_score: number;
};

export function PortfolioCompare({ rows }: { rows: CompareRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio comparison</CardTitle>
      </CardHeader>
      <CardContent className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th>Name</th><th>Owner</th><th>Value</th><th>Return %</th><th>Largest</th><th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.portfolio_id} className="border-t">
                <td className="py-2">{row.name}</td>
                <td>{row.owner}</td>
                <td>{row.total_value.toFixed(2)}</td>
                <td>{row.return_pct.toFixed(2)}%</td>
                <td>{row.largest_position}</td>
                <td>{row.risk_score.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
