import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function IdeaCard({ symbol, score, notes }: { symbol: string; score: number; notes: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{symbol}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm">Score: <span className="font-semibold">{score.toFixed(0)}</span></p>
        <p className="text-sm text-muted-foreground">{notes}</p>
      </CardContent>
    </Card>
  );
}
