import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { parseCSV, parseExcelImport } from "@/lib/portfolio-utils";
import { logAuditAction } from "@/lib/audit";
import { buildAssetIdentifier } from "@/lib/asset-identifier";

type ImportStep = 1 | 2 | 3 | 4;
type ImportStatus = "resolved" | "fallback" | "missing" | "skipped";

interface ImportSummary {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

interface PreviewRow {
  date: string;
  name: string;
  isin: string;
  type: string;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  currency: string;
  status: ImportStatus;
  statusLabel: string;
  importRow: any | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  portfolioId: string;
  onImported: () => void;
}

const toKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const normalized = text.replace(/\s/g, "").replace(/\.(?=.*[,])/g, "").replace(/,/g, ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};

function pickField(row: Record<string, unknown>, aliases: string[]): string {
  const entries = Object.entries(row);
  const byKey = new Map(entries.map(([key, value]) => [toKey(key), value]));
  for (const alias of aliases) {
    const value = byKey.get(toKey(alias));
    if (value !== undefined && String(value ?? "").trim() !== "") return String(value).trim();
  }
  return "";
}

function buildPreviewRows(rawRows: Array<Record<string, unknown>>): PreviewRow[] {
  return rawRows.map((row) => {
    const date = pickField(row, ["date", "datum", "tradedate", "avslutsdatum"]);
    const name = pickField(row, ["name", "namn", "instrument", "symbol", "ticker", "kortnamn"]);
    const isin = pickField(row, ["isin"]).toUpperCase();
    const type = pickField(row, ["type", "transaktionstyp", "trade_type"]);
    const currency = (pickField(row, ["currency", "valuta", "cost_currency", "base currency"]) || "USD").toUpperCase();
    const quantity = parseNumber(pickField(row, ["quantity", "antal", "holdings", "shares", "antal/nominellt"]));
    const price = parseNumber(pickField(row, ["price", "kurs", "avg_cost", "average purchase price", "genomsnitt"]));
    const amount = parseNumber(pickField(row, ["amount", "belopp", "total"]));

    const broken = !date && quantity == null && amount == null;
    if (broken) {
      return {
        date,
        name,
        isin,
        type,
        quantity,
        price,
        amount,
        currency,
        status: "skipped",
        statusLabel: "⚠ Missing data",
        importRow: null,
      };
    }

    const symbol = buildAssetIdentifier(isin || null, name || null);
    const normalizedRow = {
      symbol,
      isin: isin || null,
      name: name || symbol,
      quantity: quantity ?? 0,
      avg_cost: price ?? 0,
      cost_currency: currency || "USD",
      asset_type: "stock",
    };
    if (!isin && !name) {
      return {
        date,
        name,
        isin,
        type,
        quantity,
        price,
        amount,
        currency,
        status: "missing",
        statusLabel: "⚠ Missing data",
        importRow: normalizedRow,
      };
    }

    if (isin) {
      return {
        date,
        name,
        isin,
        type,
        quantity,
        price,
        amount,
        currency,
        status: "resolved",
        statusLabel: "✔ Resolved (ISIN)",
        importRow: normalizedRow,
      };
    }

    if (!name || !currency || price == null) {
      return {
        date,
        name,
        isin,
        type,
        quantity,
        price,
        amount,
        currency,
        status: "missing",
        statusLabel: "⚠ Missing data",
        importRow: normalizedRow,
      };
    }

    return {
      date,
      name,
      isin,
      type,
      quantity,
      price,
      amount,
      currency,
      status: "fallback",
      statusLabel: "⚠ Fallback (NAME)",
      importRow: normalizedRow,
    };
  });
}

export default function ImportDialog({ open, onOpenChange, portfolioId, onImported }: Props) {
  const [step, setStep] = useState<ImportStep>(1);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [resultSummary, setResultSummary] = useState<{ imported: number; skipped: number; fallback: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importableRows = useMemo(
    () => previewRows.map((row) => row.importRow).filter((row): row is any => Boolean(row)),
    [previewRows],
  );

  const previewSummary = useMemo(() => {
    const skippedRows = previewRows.filter((row) => row.status === "skipped").length;
    const fallbackRows = previewRows.filter((row) => row.status === "fallback").length;
    const validRows = previewRows.filter((row) => row.status !== "skipped").length;
    return {
      totalRows: previewRows.length,
      validRows,
      fallbackRows,
      skippedRows,
    };
  }, [previewRows]);

  const resetImport = () => {
    setStep(1);
    setFile(null);
    setParsing(false);
    setImporting(false);
    setPreviewRows([]);
    setResultSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const runSnapshotImport = async (rowsToImport: any[]): Promise<ImportSummary> => {
    const { data, error } = await supabase.rpc("import_holdings_snapshot", {
      _portfolio_id: portfolioId,
      _mode: "replace",
      _rows_json: rowsToImport as any,
    });

    if (error) throw error;

    const summary = (data ?? {}) as Partial<ImportSummary>;
    return {
      inserted: Number(summary.inserted ?? 0),
      updated: Number(summary.updated ?? 0),
      skipped: Number(summary.skipped ?? 0),
      errors: Number(summary.errors ?? 0),
    };
  };

  const parseUploadedFile = async (uploadedFile: File) => {
    setFile(uploadedFile);
    setParsing(true);
    setPreviewRows([]);
    setResultSummary(null);

    try {
      const extension = uploadedFile.name.toLowerCase().split(".").pop();
      let rawRows: Array<Record<string, unknown>> = [];

      if (extension === "xlsx") {
        const buffer = await uploadedFile.arrayBuffer();
        rawRows = parseExcelImport(buffer).holdings as Array<Record<string, unknown>>;
      } else {
        const text = await uploadedFile.text();
        rawRows = parseCSV(text) as Array<Record<string, unknown>>;
      }

      const nextPreview = buildPreviewRows(rawRows);
      setPreviewRows(nextPreview);
      setStep(2);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not parse file.";
      toast.error(message);
    } finally {
      setParsing(false);
    }
  };

  const runImportPipeline = async () => {
    setImporting(true);

    try {
      const summary = await runSnapshotImport(importableRows);
      const inserted = summary.inserted + summary.updated;
      const skipped = previewSummary.skippedRows + summary.skipped + summary.errors;
      const fallback = previewSummary.fallbackRows;

      console.log({ inserted, skipped, fallback });

      await logAuditAction("import", "portfolio", portfolioId, {
        flow: "upload_preview_import_result",
        total_rows: previewSummary.totalRows,
        importable_rows: importableRows.length,
        fallback_rows: fallback,
        skipped_rows: skipped,
        ...summary,
      });

      setResultSummary({ imported: inserted, skipped, fallback });
      setStep(4);
      onImported();
      toast.success("Import completed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import failed.";
      toast.error(message);
    } finally {
      setImporting(false);
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    void parseUploadedFile(selected);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) resetImport();
      }}
    >
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import holdings (Step {step}/4)</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:bg-muted/50 transition"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const dropped = event.dataTransfer.files?.[0];
                if (!dropped) return;
                void parseUploadedFile(dropped);
              }}
            >
              <Upload className="mx-auto mb-2" />
              <p className="font-medium">Upload CSV or XLSX</p>
              <p className="text-xs text-muted-foreground">Drag and drop your file here, or click to browse.</p>
            </div>
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={onFileChange} />
            {file && <p className="text-sm text-muted-foreground">File: {file.name}</p>}
            {parsing && <p className="text-sm">Parsing file...</p>}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">File: {file?.name}</div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Total rows: {previewSummary.totalRows}</Badge>
              <Badge variant="outline">Valid rows: {previewSummary.validRows}</Badge>
              <Badge variant="outline">Fallback rows: {previewSummary.fallbackRows}</Badge>
              <Badge variant="outline">Skipped rows: {previewSummary.skippedRows}</Badge>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>ISIN</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewRows.slice(0, 20).map((row, index) => (
                  <TableRow key={`${row.isin}-${index}`}>
                    <TableCell>{row.date || "-"}</TableCell>
                    <TableCell>{row.name || "-"}</TableCell>
                    <TableCell>{row.isin || "-"}</TableCell>
                    <TableCell>{row.type || "-"}</TableCell>
                    <TableCell>{row.quantity ?? "-"}</TableCell>
                    <TableCell>{row.price ?? "-"}</TableCell>
                    <TableCell>{row.currency || "-"}</TableCell>
                    <TableCell>{row.statusLabel}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex gap-2">
              <Button variant="outline" onClick={resetImport}>Upload another file</Button>
              <Button onClick={() => setStep(3)}>Continue</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm">Ready to import {importableRows.length} rows.</p>
            <Button onClick={runImportPipeline} disabled={importing}>
              {importing ? "Importing..." : `Import ${importableRows.length} rows`}
            </Button>
          </div>
        )}

        {step === 4 && resultSummary && (
          <div className="space-y-4">
            <p>✔ Imported: {resultSummary.imported} rows</p>
            <p>⚠ Skipped: {resultSummary.skipped} rows</p>
            <p>⚠ Fallback used: {resultSummary.fallback} rows</p>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
