import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { buildPreviewRows, detectBrokerByHeaders, parseCsvRows, parseXlsxRows, type ParsedImportPreviewRow } from "@/lib/transaction-import";

const mapFields = ["external_id", "type", "trade_date", "settle_date", "isin", "symbol", "exchange", "name", "quantity", "price", "price_currency", "fx_rate", "fees", "fees_currency", "total_local", "total_foreign"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portfolioId: string;
  onImported: () => void;
}

export default function TransactionImportDialog({ open, onOpenChange, portfolioId, onImported }: Props) {
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [broker, setBroker] = useState<"nordea" | "generic">("generic");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [previewRows, setPreviewRows] = useState<ParsedImportPreviewRow[]>([]);
  const [busy, setBusy] = useState(false);

  const validRows = useMemo(() => previewRows.filter((r) => r.errors.length === 0), [previewRows]);
  const uniqueAssets = useMemo(() => new Set(previewRows.map((r) => r.inferredAssetKey).filter(Boolean)).size, [previewRows]);

  const parseFile = async (file: File) => {
    const ext = file.name.toLowerCase().split(".").pop();
    const buffer = await file.arrayBuffer();
    const text = ext === "csv" ? new TextDecoder().decode(buffer) : "";
    const rows = ext === "xlsx" ? parseXlsxRows(buffer) : parseCsvRows(text);
    const detectedBroker = detectBrokerByHeaders(rows);
    setRawRows(rows);
    setHeaders(rows[0] ? Object.keys(rows[0]) : []);
    setBroker(detectedBroker);
    const parsed = buildPreviewRows(rows, detectedBroker);
    setPreviewRows(parsed);
  };

  const refreshGenericPreview = () => {
    setPreviewRows(buildPreviewRows(rawRows, "generic", mapping));
  };

  const ensureAssets = async (rows: ParsedImportPreviewRow[]) => {
    const symbols = [...new Set(rows.map((r) => r.tx.symbol).filter(Boolean) as string[])];
    if (symbols.length === 0) return new Map<string, string>();
    const { data: existing } = await supabase.from("assets").select("id,symbol").in("symbol", symbols);
    const bySymbol = new Map<string, string>((existing || []).map((a: any) => [String(a.symbol).toUpperCase(), a.id]));

    const missing = symbols.filter((s) => !bySymbol.has(s));
    if (missing.length > 0) {
      const inserts = missing.map((s) => ({ symbol: s, name: s, asset_type: "stock", currency: "USD" }));
      const { data: created } = await supabase.from("assets").insert(inserts).select("id,symbol");
      (created || []).forEach((a: any) => bySymbol.set(String(a.symbol).toUpperCase(), a.id));
    }
    return bySymbol;
  };

  const handleImport = async () => {
    setBusy(true);
    const clean = validRows;
    if (clean.length === 0) {
      toast.error("No valid rows to import");
      setBusy(false);
      return;
    }

    const symbolMap = await ensureAssets(clean);
    const { data: auth } = await supabase.auth.getUser();
    const ownerId = auth.user?.id;
    if (!ownerId) {
      toast.error("Not authenticated");
      setBusy(false);
      return;
    }

    const payload = clean.map(({ tx }) => ({
      portfolio_id: portfolioId,
      owner_user_id: ownerId,
      user_id: ownerId,
      asset_id: tx.symbol ? symbolMap.get(tx.symbol) ?? null : null,
      broker: tx.broker,
      external_id: tx.external_id,
      type: tx.type,
      trade_date: tx.trade_date,
      settle_date: tx.settle_date,
      isin: tx.isin,
      symbol: tx.symbol,
      exchange: tx.exchange,
      name: tx.name,
      quantity: tx.quantity,
      price: tx.price,
      price_currency: tx.price_currency,
      fx_rate: tx.fx_rate,
      fees: tx.fees,
      fees_currency: tx.fees_currency,
      total_local: tx.total_local,
      total_foreign: tx.total_foreign,
      raw: tx.raw,
      traded_at: tx.trade_date,
      currency: tx.price_currency || "USD",
      metadata_json: tx.raw,
    }));

    for (let i = 0; i < payload.length; i += 500) {
      const chunk = payload.slice(i, i + 500);
      const { error } = await supabase.from("transactions" as never).insert(chunk as never);
      if (error) {
        toast.error(error.message);
        setBusy(false);
        return;
      }
    }

    const { error: rebuildError } = await supabase.rpc("rebuild_holdings", { _portfolio_id: portfolioId });
    if (rebuildError) {
      toast.error(rebuildError.message);
      setBusy(false);
      return;
    }

    const { error: refreshError } = await supabase.rpc("refresh_asset_research" as never, { _portfolio_id: portfolioId } as never);
    if (refreshError) {
      toast.error(refreshError.message);
      setBusy(false);
      return;
    }

    toast.success(`Imported ${clean.length} transactions`);
    onImported();
    onOpenChange(false);
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-auto">
        <DialogHeader><DialogTitle>Import transactions</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <Input type="file" accept=".csv,.xlsx" onChange={(e) => { const file = e.target.files?.[0]; if (file) parseFile(file); }} />
          <div className="text-sm text-muted-foreground">Detected broker: <Badge variant="secondary">{broker}</Badge></div>

          {broker === "generic" && headers.length > 0 && (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {mapFields.map((field) => (
                <div key={field}>
                  <Label className="text-xs">{field}</Label>
                  <Select value={mapping[field] || "__none"} onValueChange={(value) => setMapping((prev) => ({ ...prev, [field]: value === "__none" ? "" : value }))}>
                    <SelectTrigger><SelectValue placeholder="Ignore" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Ignore</SelectItem>
                      {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              <Button type="button" onClick={refreshGenericPreview} className="col-span-2">Apply mapping</Button>
            </div>
          )}

          <div className="flex gap-2 text-xs">
            <Badge>{previewRows.length} rows</Badge>
            <Badge variant="outline">{validRows.length} valid</Badge>
            <Badge variant="outline">{uniqueAssets} inferred assets</Badge>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead><TableHead>Type</TableHead><TableHead>Date</TableHead><TableHead>Symbol/ISIN</TableHead><TableHead>Qty</TableHead><TableHead>Price</TableHead><TableHead>Total</TableHead><TableHead>Errors</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.slice(0, 200).map((row, i) => (
                <TableRow key={i}>
                  <TableCell>{row.errors.length === 0 ? <Badge>OK</Badge> : <Badge variant="destructive">Issue</Badge>}</TableCell>
                  <TableCell>{row.tx.type}</TableCell>
                  <TableCell>{row.tx.trade_date || "-"}</TableCell>
                  <TableCell>{row.tx.symbol || row.tx.isin || "-"}</TableCell>
                  <TableCell>{row.tx.quantity ?? "-"}</TableCell>
                  <TableCell>{row.tx.price ?? "-"}</TableCell>
                  <TableCell>{row.tx.total_local ?? "-"}</TableCell>
                  <TableCell className="text-xs">{row.errors.join(", ") || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex justify-end">
            <Button onClick={handleImport} disabled={busy || validRows.length === 0}>{busy ? "Importing..." : "Confirm import"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
