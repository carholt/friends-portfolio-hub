import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { buildPreviewRows, buildProviderSymbol, detectBrokerByHeaders, mapNordeaExchange, parseCsvRows, parseXlsxRows, type ParsedImportPreviewRow } from "@/lib/transaction-import";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portfolioId: string;
  onImported: () => void;
}

export default function TransactionImportDialog({ open, onOpenChange, portfolioId, onImported }: Props) {
  const [previewRows, setPreviewRows] = useState<ParsedImportPreviewRow[]>([]);
  const [broker, setBroker] = useState<"nordea" | "generic">("generic");
  const [busy, setBusy] = useState(false);

  const validRows = useMemo(() => previewRows.filter((r) => r.errors.length === 0), [previewRows]);

  const parseFile = async (file: File) => {
    const ext = file.name.toLowerCase().split(".").pop();
    const buffer = await file.arrayBuffer();
    const text = ext === "csv" ? new TextDecoder().decode(buffer) : "";
    const rows = ext === "xlsx" ? parseXlsxRows(buffer) : parseCsvRows(text);
    const detectedBroker = detectBrokerByHeaders(rows);
    setBroker(detectedBroker);
    setPreviewRows(buildPreviewRows(rows, detectedBroker));
  };

  const ensureAssets = async (rows: ParsedImportPreviewRow[]) => {
    const keys = [...new Set(rows.map((r) => `${r.tx.symbol_raw}|${r.tx.exchange_code || ""}`).filter(Boolean))];
    const symbols = [...new Set(rows.map((r) => r.tx.symbol_raw).filter(Boolean) as string[])];
    const { data: existing } = await supabase.from("assets").select("id,symbol,exchange").in("symbol", symbols);
    const byKey = new Map<string, string>((existing || []).map((a: any) => [`${String(a.symbol).toUpperCase()}|${String(a.exchange || "").toUpperCase()}`, a.id]));

    const missing = keys.filter((k) => !byKey.has(k));
    if (missing.length > 0) {
      const inserts = missing.map((key) => {
        const [symbol, exchange] = key.split("|");
        const providerSymbol = buildProviderSymbol(symbol, exchange || null);
        return {
          symbol,
          name: symbol,
          asset_type: "stock",
          exchange: exchange || null,
          currency: "CAD",
          metadata_json: { exchange_code: exchange || null, provider_symbol: providerSymbol },
        };
      });
      const { data: created } = await supabase.from("assets").insert(inserts).select("id,symbol,exchange");
      (created || []).forEach((a: any) => byKey.set(`${String(a.symbol).toUpperCase()}|${String(a.exchange || "").toUpperCase()}`, a.id));
    }

    return byKey;
  };

  const handleImport = async () => {
    setBusy(true);
    if (validRows.length === 0) {
      toast.error("Inga giltiga rader att importera");
      setBusy(false);
      return;
    }

    const symbolMap = await ensureAssets(validRows);
    const { data: auth } = await supabase.auth.getUser();
    const ownerId = auth.user?.id;
    if (!ownerId) {
      toast.error("Inte inloggad");
      setBusy(false);
      return;
    }

    const payload = validRows.map(({ tx }) => ({
      portfolio_id: portfolioId,
      broker: tx.broker,
      trade_id: tx.trade_id,
      trade_type: tx.trade_type,
      symbol_raw: tx.symbol_raw,
      isin: tx.isin,
      exchange_raw: tx.exchange_raw,
      traded_at: tx.traded_at,
      settle_at: tx.settle_at,
      quantity: tx.quantity,
      price: tx.price,
      trade_currency: tx.trade_currency,
      fx_rate: tx.fx_rate,
      fees: tx.fees,
      gross: tx.gross,
      net: tx.net,
      base_currency: tx.base_currency,
      raw_row: tx.raw_row,
      asset_id: symbolMap.get(`${tx.symbol_raw}|${tx.exchange_code || ""}`) || null,
    }));

    const { error } = await supabase.from("transactions" as never).upsert(payload as never, { onConflict: "portfolio_id,broker,trade_id", ignoreDuplicates: false } as never);
    if (error) {
      toast.error(`Import misslyckades: ${error.message}`);
      setBusy(false);
      return;
    }

    const { error: rebuildError } = await supabase.rpc("recompute_holdings_from_transactions" as never, { _portfolio_id: portfolioId } as never);
    if (rebuildError) {
      toast.error(`Kunde inte uppdatera innehav: ${rebuildError.message}`);
      setBusy(false);
      return;
    }

    const normalizedAssets = validRows.filter((row) => !!row.tx.provider_symbol).length;
    toast.success(`Importerade ${validRows.length} transaktioner. Innehav uppdaterade. ${normalizedAssets} tillgångar normaliserade. Priser väntar på nästa uppdatering.`);
    onImported();
    onOpenChange(false);
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-auto">
        <DialogHeader><DialogTitle>Import transactions (Nordea)</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <Input type="file" accept=".csv,.xlsx" onChange={(e) => { const file = e.target.files?.[0]; if (file) parseFile(file); }} />
          <div className="text-sm text-muted-foreground">Detected broker: <Badge variant="secondary">{broker}</Badge></div>

          <div className="flex gap-2 text-xs">
            <Badge>{previewRows.length} rows</Badge>
            <Badge variant="outline">{validRows.length} valid</Badge>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead><TableHead>Type</TableHead><TableHead>Date</TableHead><TableHead>Ticker</TableHead><TableHead>Exchange</TableHead><TableHead>Qty</TableHead><TableHead>Errors</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.slice(0, 200).map((row, i) => {
                const exchange = mapNordeaExchange(row.tx.exchange_raw).exchange_code;
                return (
                  <TableRow key={i}>
                    <TableCell>{row.errors.length === 0 ? <Badge>OK</Badge> : <Badge variant="destructive">Issue</Badge>}</TableCell>
                    <TableCell>{row.tx.trade_type}</TableCell>
                    <TableCell>{row.tx.traded_at || "-"}</TableCell>
                    <TableCell>{row.tx.symbol_raw || "-"}</TableCell>
                    <TableCell>{exchange || "-"}</TableCell>
                    <TableCell>{row.tx.quantity || "-"}</TableCell>
                    <TableCell className="text-xs">{row.errors.join(", ") || "-"}</TableCell>
                  </TableRow>
                );
              })}
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
