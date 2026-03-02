import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import CreatePortfolioDialog from "@/components/CreatePortfolioDialog";
import ImportDialog from "@/components/ImportDialog";
import { MoreHorizontal, Plus, Upload } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface PortfolioRow {
  id: string;
  name: string;
  visibility: string;
  latest_value: number | null;
  start_value: number | null;
}

export default function PortfoliosPage() {
  const [items, setItems] = useState<PortfolioRow[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showImportFor, setShowImportFor] = useState<string | null>(null);
  const [searchParams] = useSearchParams();

  const load = async () => {
    const { data: portfolios } = await supabase.from("portfolios").select("id,name,visibility").order("created_at", { ascending: false });
    const { data: valuations } = await supabase.from("portfolio_valuations").select("portfolio_id,total_value,as_of_date").order("as_of_date", { ascending: false });
    const latest = new Map<string, number>();
    const earliest = new Map<string, number>();
    for (const row of valuations || []) if (!latest.has(row.portfolio_id)) latest.set(row.portfolio_id, Number(row.total_value));
    for (const row of [...(valuations || [])].reverse()) earliest.set(row.portfolio_id, Number(row.total_value));

    setItems((portfolios || []).map((p) => ({ id: p.id, name: p.name, visibility: p.visibility, latest_value: latest.get(p.id) ?? null, start_value: earliest.get(p.id) ?? null })));
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (searchParams.get("import") === "1" && items[0]) setShowImportFor(items[0].id);
  }, [searchParams, items]);

  return (
    <AppLayout>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Portfolios</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowImportFor(items[0]?.id || null)} className="gap-2" disabled={!items[0]}><Upload className="h-4 w-4" /> Import</Button>
          <Button onClick={() => setShowCreate(true)} className="gap-2"><Plus className="h-4 w-4" /> Create</Button>
        </div>
      </div>

      {items.length === 0 ? (
        <Card><CardContent className="py-12 text-center">No portfolios yet. Create or import to get started.</CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((p) => {
            const ret = p.latest_value != null && p.start_value != null ? (((p.latest_value - p.start_value) / (p.start_value || 1)) * 100) : null;
            return (
              <Card key={p.id}>
                <CardHeader className="flex flex-row items-start justify-between">
                  <div>
                    <CardTitle>{p.name}</CardTitle>
                    <Badge variant="secondary" className="mt-1">{p.visibility}</Badge>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => setShowImportFor(p.id)}>Import</DropdownMenuItem>
                      <DropdownMenuItem>Export</DropdownMenuItem>
                      <DropdownMenuItem>Edit visibility</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm">Total value: <span className="font-semibold">{p.latest_value?.toLocaleString() ?? "—"}</span></p>
                  <p className="text-sm text-muted-foreground">1M return: {ret == null ? "—" : `${ret.toFixed(1)}%`}</p>
                  <Link to={`/portfolio/${p.id}`}><Button className="w-full">Open</Button></Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreatePortfolioDialog open={showCreate} onOpenChange={setShowCreate} onCreated={load} />
      {showImportFor && <ImportDialog open={!!showImportFor} onOpenChange={() => setShowImportFor(null)} portfolioId={showImportFor} onImported={load} />}
    </AppLayout>
  );
}
