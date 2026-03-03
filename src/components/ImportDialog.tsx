import { useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { parseCSV, parseExcelImport, parseJSONImport, validateImportRows } from "@/lib/portfolio-utils";
import { logAuditAction } from "@/lib/audit";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ImportFormat = "csv" | "json" | "xlsx";
type ImportMode = "replace" | "merge";

interface Props { open: boolean; onOpenChange: (v: boolean) => void; portfolioId: string; onImported: () => void; }

export default function ImportDialog({ open, onOpenChange, portfolioId, onImported }: Props) {
  const [step, setStep] = useState(1);
  const [format, setFormat] = useState<ImportFormat>("csv");
  const [mode, setMode] = useState<ImportMode>("replace");
  const [rows, setRows] = useState<any[]>([]);
  const [detectedNordea, setDetectedNordea] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validRows = useMemo(() => rows.filter((r) => r.valid), [rows]);

  const parseFile = (payload: string | ArrayBuffer, fileFormat: ImportFormat) => {
    if (fileFormat === "xlsx") {
      const spreadsheet = parseExcelImport(payload as ArrayBuffer);
      setDetectedNordea(spreadsheet.detectedNordea);
      setRows(validateImportRows(spreadsheet.holdings));
      setStep(3);
      return;
    }

    const parsed = fileFormat === "json" ? parseJSONImport(payload as string).holdings : parseCSV(payload as string);
    setDetectedNordea(false);
    setRows(validateImportRows(parsed));
    setStep(3);
  };

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        parseFile(ev.target?.result as string | ArrayBuffer, format);
      } catch {
        toast.error("Could not parse file.");
      }
    };
    if (format === "xlsx") {
      reader.readAsArrayBuffer(file);
      return;
    }
    reader.readAsText(file);
  };

  const runImport = async () => {
    setBusy(true);
    if (mode === "replace") {
      await supabase.from("holdings").delete().eq("portfolio_id", portfolioId);
    }

    for (const row of validRows) {
      const { data: asset } = await supabase.from("assets").select("id").eq("symbol", row.symbol).maybeSingle();
      const assetId = asset?.id || (await supabase.from("assets").insert({
        symbol: row.symbol,
        name: row.name || row.symbol,
        asset_type: row.asset_type as any,
        exchange: row.exchange || null,
        currency: row.cost_currency,
        metadata_json: row.metadata_json ?? null,
      }).select("id").single()).data?.id;
      if (!assetId) continue;

      const { data: existing } = await supabase.from("holdings").select("id,quantity,avg_cost").eq("portfolio_id", portfolioId).eq("asset_id", assetId).maybeSingle();
      if (existing) {
        const qty = mode === "merge" ? Number(existing.quantity) + row.quantity : row.quantity;
        const avg = mode === "merge" ? ((Number(existing.quantity) * Number(existing.avg_cost)) + (row.quantity * row.avg_cost)) / qty : row.avg_cost;
        await supabase.from("holdings").update({ quantity: qty, avg_cost: avg, cost_currency: row.cost_currency }).eq("id", existing.id);
      } else {
        await supabase.from("holdings").insert({ portfolio_id: portfolioId, asset_id: assetId, quantity: row.quantity, avg_cost: row.avg_cost, cost_currency: row.cost_currency });
      }
    }

    await logAuditAction("import", "portfolio", portfolioId, { mode, valid_rows: validRows.length, total_rows: rows.length });
    setBusy(false);
    onOpenChange(false);
    onImported();
    toast.success(`Imported ${validRows.length} holdings.`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Import holdings (Step {step}/4)</DialogTitle></DialogHeader>

        {step === 1 && <div className="space-y-3"><p className="text-sm">Choose file format.</p><Select value={format} onValueChange={(v) => setFormat(v as ImportFormat)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="csv">CSV (symbol,quantity required)</SelectItem><SelectItem value="json">JSON</SelectItem><SelectItem value="xlsx">Excel (.xlsx)</SelectItem></SelectContent></Select><Button onClick={() => setStep(2)}>Continue</Button></div>}
        {step === 2 && <div className="space-y-3"><p className="text-sm">Upload your {format.toUpperCase()} file.</p><div className="border-dashed border rounded p-10 text-center cursor-pointer" onClick={() => fileInputRef.current?.click()}><Upload className="mx-auto mb-2" />Click to upload</div><input ref={fileInputRef} type="file" accept={format === "csv" ? ".csv" : format === "json" ? ".json" : ".xlsx"} className="hidden" onChange={onUpload} /><Button variant="outline" onClick={() => setStep(1)}>Back</Button></div>}

        {step >= 3 && <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-sm">Preview and validation ({validRows.length}/{rows.length} valid)</p>
              {detectedNordea && <Badge variant="secondary">Nordea format detected</Badge>}
            </div>
            <Select value={mode} onValueChange={(v) => setMode(v as ImportMode)}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="replace">Replace (default)</SelectItem><SelectItem value="merge">Merge</SelectItem></SelectContent></Select>
          </div>
          <Table><TableHeader><TableRow><TableHead>Symbol</TableHead><TableHead>Qty</TableHead><TableHead>Avg cost</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{rows.map((r, i) => <TableRow key={i}><TableCell>{r.symbol}</TableCell><TableCell>{r.quantity}</TableCell><TableCell>{r.avg_cost}</TableCell><TableCell>{r.valid ? <Badge>Valid</Badge> : <Badge variant="destructive">{r.errors[0]}</Badge>}</TableCell></TableRow>)}</TableBody></Table>
          <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(2)}>Back</Button><Button onClick={() => setStep(4)} disabled={validRows.length === 0}>Confirm</Button></div>
        </div>}

        {step === 4 && <div className="space-y-3"><p className="text-sm">You are about to {mode} holdings for this portfolio.</p><Button onClick={runImport} disabled={busy}>{busy ? "Importing..." : "Run import"}</Button></div>}
      </DialogContent>
    </Dialog>
  );
}
