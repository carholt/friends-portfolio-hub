import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Upload, FileText, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { parseCSV, parseJSONImport, validateImportRows } from "@/lib/portfolio-utils";
import { logAuditAction } from "@/lib/audit";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  portfolioId: string;
  onImported: () => void;
}

interface ImportRow {
  symbol: string;
  name: string;
  asset_type: string;
  exchange: string;
  quantity: number;
  avg_cost: number;
  cost_currency: string;
  valid: boolean;
  errors: string[];
}

export default function ImportDialog({ open, onOpenChange, portfolioId, onImported }: Props) {
  const { user } = useAuth();
  const [preview, setPreview] = useState<ImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [rawText, setRawText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processData = (rows: any[]) => {
    const parsed: ImportRow[] = validateImportRows(rows);
    setPreview(parsed);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setRawText(text);
      if (file.name.endsWith(".json")) {
        try {
          const { holdings } = parseJSONImport(text);
          processData(holdings);
        } catch { toast.error("Ogiltig JSON-fil"); }
      } else {
        const rows = parseCSV(text);
        processData(rows);
      }
    };
    reader.readAsText(file);
  };

  const handlePasteCSV = () => {
    if (!rawText.trim()) return;
    try {
      const parsed = JSON.parse(rawText);
      if (parsed.holdings) {
        processData(parsed.holdings);
        return;
      }
    } catch {}
    const rows = parseCSV(rawText);
    processData(rows);
  };

  const handleImport = async () => {
    if (!user) return;
    const validRows = preview.filter(r => r.valid);
    if (validRows.length === 0) { toast.error("Inga giltiga rader att importera"); return; }

    setImporting(true);
    let imported = 0;

    for (const row of validRows) {
      // Upsert asset
      const { data: existing } = await supabase.from("assets").select("id").eq("symbol", row.symbol).single();
      let assetId: string;
      if (existing) {
        assetId = existing.id;
      } else {
        const { data: newAsset, error } = await supabase.from("assets").insert({
          symbol: row.symbol,
          name: row.name,
          asset_type: row.asset_type as any,
          exchange: row.exchange || null,
          currency: row.cost_currency,
        }).select("id").single();
        if (error || !newAsset) continue;
        assetId = newAsset.id;
      }

      const { error } = await supabase.from("holdings").insert({
        portfolio_id: portfolioId,
        asset_id: assetId,
        quantity: row.quantity,
        avg_cost: row.avg_cost,
        cost_currency: row.cost_currency,
      });
      if (!error) imported++;
    }

    await logAuditAction("import", "portfolio", portfolioId, { imported });
    toast.success(`${imported} innehav importerade`);
    setPreview([]);
    setRawText("");
    onOpenChange(false);
    onImported();
    setImporting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importera innehav</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="file">
          <TabsList className="w-full">
            <TabsTrigger value="file" className="flex-1">Fil</TabsTrigger>
            <TabsTrigger value="paste" className="flex-1">Klistra in</TabsTrigger>
          </TabsList>

          <TabsContent value="file" className="space-y-4">
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Klicka för att välja CSV eller JSON-fil</p>
              <input ref={fileInputRef} type="file" accept=".csv,.json" onChange={handleFileUpload} className="hidden" />
            </div>
          </TabsContent>

          <TabsContent value="paste" className="space-y-4">
            <Textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={`symbol,name,asset_type,exchange,quantity,avg_cost,cost_currency\nXAU,Gold,metal,,10,2000,USD`}
              rows={6}
              className="font-mono text-xs"
            />
            <Button variant="outline" onClick={handlePasteCSV} className="w-full">Förhandsgranska</Button>
          </TabsContent>
        </Tabs>

        {preview.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <span className="text-sm font-medium">{preview.filter(r => r.valid).length} giltiga / {preview.length} rader</span>
            </div>
            <div className="max-h-60 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Namn</TableHead>
                    <TableHead>Typ</TableHead>
                    <TableHead className="text-right">Antal</TableHead>
                    <TableHead className="text-right">Snittpris</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Errors</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((r, i) => (
                    <TableRow key={i} className={!r.valid ? "opacity-50" : ""}>
                      <TableCell className="font-mono">{r.symbol}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell>{r.asset_type}</TableCell>
                      <TableCell className="text-right">{r.quantity}</TableCell>
                      <TableCell className="text-right">{r.avg_cost}</TableCell>
                      <TableCell>
                        {r.valid ? (
                          <Badge variant="success" className="text-xs">OK</Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs gap-1" title={r.errors.join(", ")}><AlertCircle className="h-3 w-3" /> {r.errors[0] || "Ogiltig"}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-destructive">{r.valid ? "—" : r.errors.join(", ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button variant="hero" className="w-full" onClick={handleImport} disabled={importing || preview.filter(r => r.valid).length === 0}>
              {importing ? "Importerar…" : `Importera ${preview.filter(r => r.valid).length} innehav`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
