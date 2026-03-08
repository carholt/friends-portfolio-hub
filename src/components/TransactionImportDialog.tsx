import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { buildPreviewRows, parseXlsxRows, type ParsedImportPreviewRow } from "@/lib/transaction-import";
import { detectMapping, parseDelimitedFile, type ImportMapping } from "@/lib/import-engine";
import { importTransactionsBatch } from "@/lib/transactions-batch-import";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portfolioId: string;
  onImported: () => void;
}

const AI_MAPPING_ENABLED = false;

export default function TransactionImportDialog({ open, onOpenChange, portfolioId, onImported }: Props) {
  const [step, setStep] = useState(1);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [previewRows, setPreviewRows] = useState<ParsedImportPreviewRow[]>([]);
  const [fingerprint, setFingerprint] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const validRows = useMemo(() => previewRows.filter((row) => row.errors.length === 0), [previewRows]);

  const updatePreview = (next: ImportMapping) => {
    setMapping(next);
    setPreviewRows(buildPreviewRows(rawRows, next));
  };

  const parseFile = async (file: File) => {
    const ext = file.name.toLowerCase().split(".").pop();
    const buffer = await file.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(buffer);
    const parsed = ext === "xlsx" ? { headers: Object.keys(parseXlsxRows(buffer)[0] || {}), rows: parseXlsxRows(buffer), sampleRows: parseXlsxRows(buffer).slice(0, 50), delimiter: "," as const, fingerprint: `xlsx-${file.name}-${file.size}` } : parseDelimitedFile(text);

    setHeaders(parsed.headers);
    setRawRows(parsed.rows);
    setFingerprint(parsed.fingerprint);

    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (userId) {
      const { data: profile } = await supabase
        .from("broker_import_profiles" as never)
        .select("mapping")
        .eq("owner_user_id", userId)
        .eq("file_fingerprint", parsed.fingerprint)
        .maybeSingle();
      if ((profile as any)?.mapping) {
        const saved = (profile as any).mapping as ImportMapping;
        updatePreview(saved);
        setStep(3);
        return;
      }
    }

    const detected = detectMapping(parsed.headers, parsed.sampleRows as Record<string, string>[]);
    updatePreview(detected);
    setStep(2);
  };

  const persistMapping = async (finalMapping: ImportMapping) => {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return;

    await supabase.from("broker_import_profiles" as never).upsert({
      owner_user_id: userId,
      broker_key: finalMapping.broker_key,
      file_fingerprint: fingerprint,
      mapping: finalMapping,
    } as never, { onConflict: "owner_user_id,file_fingerprint" } as never);
  };

  const handleImport = async () => {
    if (!mapping) return;
    setBusy(true);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user?.id) {
      toast.error("Not logged in");
      setBusy(false);
      return;
    }

    try {
      const summary = await importTransactionsBatch(portfolioId, validRows);
      await persistMapping(mapping);
      toast.success(`Imported ${summary.processed} rows. Skipped ${summary.skipped + (previewRows.length - validRows.length)}. Holdings updated.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Import failed: ${message}`);
      setBusy(false);
      return;
    }
    onImported();
    onOpenChange(false);
    setBusy(false);
  };

  const needsQuestions = !!mapping && (mapping.confidence < 0.85 || mapping.questions.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-auto">
        <DialogHeader><DialogTitle>Import Engine (Step {step}/4)</DialogTitle></DialogHeader>

        {step === 1 && <div className="space-y-4">
          <Input type="file" accept=".csv,.tsv,.xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) parseFile(file); }} />
          <p className="text-xs text-muted-foreground">CSV/TSV required. XLSX supported.</p>
        </div>}

        {step === 2 && mapping && <div className="space-y-3">
          <div className="flex gap-2 text-sm"><Badge>{mapping.kind}</Badge><Badge variant="secondary">{mapping.broker_key}</Badge><Badge variant="outline">confidence {(mapping.confidence * 100).toFixed(0)}%</Badge></div>{mapping.confidence < 0.6 && !AI_MAPPING_ENABLED && <p className="text-xs text-muted-foreground">AI-assisted mapping is available but OFF by default.</p>}
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-xs">Ticker column</p><Select value={mapping.columns.symbol || ""} onValueChange={(value) => updatePreview({ ...mapping, columns: { ...mapping.columns, symbol: value } })}><SelectTrigger><SelectValue placeholder="Select column" /></SelectTrigger><SelectContent>{headers.map((header) => <SelectItem key={header} value={header}>{header}</SelectItem>)}</SelectContent></Select></div>
            <div><p className="text-xs">Exchange column</p><Select value={mapping.columns.exchange || ""} onValueChange={(value) => updatePreview({ ...mapping, columns: { ...mapping.columns, exchange: value } })}><SelectTrigger><SelectValue placeholder="Select column" /></SelectTrigger><SelectContent>{headers.map((header) => <SelectItem key={header} value={header}>{header}</SelectItem>)}</SelectContent></Select></div>
            <div><p className="text-xs">Decimals</p><Select value={mapping.decimal} onValueChange={(value) => updatePreview({ ...mapping, decimal: value as "," | "." })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value=",">comma</SelectItem><SelectItem value=".">dot</SelectItem></SelectContent></Select></div>
          </div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setStep(1)}>Back</Button><Button onClick={() => setStep(3)}>Continue</Button></div>
        </div>}

        {step === 3 && mapping && <div className="space-y-3">
          {mapping.confidence < 0.85 && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Low-confidence symbol mapping detected ({(mapping.confidence * 100).toFixed(0)}%).</div>
              <Button size="sm" variant="outline" onClick={() => window.location.assign('/settings/symbol-resolution')}>Fix mapping</Button>
            </div>
          )}
          {needsQuestions && <div className="rounded border p-3 text-sm">{mapping.questions.slice(0, 4).map((question) => <p key={question}>• {question}</p>)}</div>}
          <div className="flex gap-2 text-xs"><Badge>{previewRows.length} rows</Badge><Badge variant="outline">{validRows.length} valid</Badge></div>
          <Table>
            <TableHeader><TableRow><TableHead>Status</TableHead><TableHead>Date</TableHead><TableHead>Symbol</TableHead><TableHead>Exchange</TableHead><TableHead>Qty</TableHead><TableHead>Errors</TableHead></TableRow></TableHeader>
            <TableBody>{previewRows.slice(0, 120).map((row, idx) => <TableRow key={idx}><TableCell>{row.errors.length === 0 ? <Badge>OK</Badge> : <Badge variant="destructive">Issue</Badge>}</TableCell><TableCell>{row.tx.traded_at || "-"}</TableCell><TableCell>{row.tx.symbol_raw || "-"}</TableCell><TableCell>{row.tx.exchange_code || "-"}</TableCell><TableCell>{row.tx.quantity || "-"}</TableCell><TableCell className="text-xs">{row.errors.join(", ") || "-"}</TableCell></TableRow>)}</TableBody>
          </Table>
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>Fix mapping</Button>
            <Button onClick={() => setStep(4)} disabled={validRows.length === 0}>Continue</Button>
          </div>
        </div>}

        {step === 4 && mapping && <div className="space-y-3">
          <p className="text-sm">Ready to import {validRows.length} transaction rows.</p>
          <div className="text-xs text-muted-foreground">Method: Average Cost.</div>
          <Button onClick={handleImport} disabled={busy || validRows.length === 0}>{busy ? "Importing..." : "Confirm import"}</Button>
        </div>}
      </DialogContent>
    </Dialog>
  );
}
