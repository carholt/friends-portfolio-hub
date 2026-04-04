import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, X } from "lucide-react";
import { toast } from "sonner";
import { groupNordeaHoldingsByAccount, parseCSV, parseExcelImport, parseJSONImport, validateImportRows, type NordeaAccountGroup } from "@/lib/portfolio-utils";
import { applyTickerResolutionsToRows, normalizeTicker } from "@/lib/ticker-resolution";
import { applyImportResolution, type SymbolResolutionStatus, type SymbolCandidate } from "@/lib/symbol-resolution";
import { logAuditAction } from "@/lib/audit";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseDelimitedFile } from "@/lib/import-engine";
import { detectHoldingsImportIssue } from "@/lib/import-guards";
import { resolveIsin } from "@/lib/isin-resolution";
import { resolveIsins } from "@/lib/isin-batch-resolution";

type ImportFormat = "csv" | "json" | "xlsx";
type ImportMode = "replace" | "merge";
type Visibility = "private" | "authenticated" | "group" | "public";

interface PortfolioChoice { id: string; name: string; base_currency: string; }
interface AccountSelection {
  target: string;
  portfolioName: string;
  baseCurrency: string;
  visibility: Visibility;
}

interface ResolverItem { isin: string; name: string; mic?: string; }
type ResolverStatus = "resolving" | "resolved" | "manual_required";

interface ImportSummary { inserted: number; updated: number; skipped: number; errors: number; }

interface Props { open: boolean; onOpenChange: (v: boolean) => void; portfolioId: string; onImported: () => void; }

const formatResolvedTicker = (ticker: string, exchange?: string | null) => {
  const normalizedTicker = normalizeTicker(ticker);
  const normalizedExchange = String(exchange || "").toUpperCase().trim();
  if (!normalizedExchange) return normalizedTicker;
  if (normalizedTicker.includes(":")) return normalizedTicker;
  if (normalizedTicker.endsWith(".TO") || normalizedTicker.endsWith(".V")) return normalizedTicker;
  return `${normalizedTicker}:${normalizedExchange}`;
};

export default function ImportDialog({ open, onOpenChange, portfolioId, onImported }: Props) {
  const [step, setStep] = useState(1);
  const [format, setFormat] = useState<ImportFormat>("csv");
  const [mode, setMode] = useState<ImportMode>("replace");
  const [rows, setRows] = useState<any[]>([]);
  const [detectedNordea, setDetectedNordea] = useState(false);
  const [busy, setBusy] = useState(false);
  const [existingPortfolios, setExistingPortfolios] = useState<PortfolioChoice[]>([]);
  const [nordeaAccounts, setNordeaAccounts] = useState<NordeaAccountGroup[]>([]);
  const [accountSelections, setAccountSelections] = useState<Record<string, AccountSelection>>({});
  const [tickerResolutions, setTickerResolutions] = useState<Record<string, string>>({});
  const [tickerSuggestions, setTickerSuggestions] = useState<Record<string, string[]>>({});
  const [resolverStatus, setResolverStatus] = useState<Record<string, ResolverStatus>>({});
  const [resolverErrors, setResolverErrors] = useState<Record<string, string>>({});
  const [allowManualNordeaImport, setAllowManualNordeaImport] = useState(false);
  const [previewResolution, setPreviewResolution] = useState<Record<string, { status: SymbolResolutionStatus; reason?: string }>>({});
  const [importManualInvalid, setImportManualInvalid] = useState(false);
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const [lastImportSummary, setLastImportSummary] = useState<ImportSummary | null>(null);
  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalSteps = detectedNordea ? 6 : 4;
  const validRows = useMemo(() => rows.filter((r) => r.valid), [rows]);
  const getPreviewResolutionKey = useCallback((row: any) => (
    detectedNordea
      ? String(row?.metadata_json?.isin ?? row.symbol ?? "").toUpperCase().trim()
      : String(row.symbol || "").toUpperCase().trim()
  ), [detectedNordea]);
  const invalidResolutionCount = useMemo(() => (
    validRows.filter((row) => previewResolution[getPreviewResolutionKey(row)]?.status === "invalid").length
  ), [getPreviewResolutionKey, previewResolution, validRows]);
  const resolvedPreviewCount = useMemo(() => (
    validRows.filter((row) => previewResolution[getPreviewResolutionKey(row)]?.status === "resolved").length
  ), [getPreviewResolutionKey, previewResolution, validRows]);
  const resolverItems = useMemo<ResolverItem[]>(() => {
    if (!detectedNordea) return [];
    const byIsin = new Map<string, ResolverItem>();
    validRows.forEach((row) => {
      const isin = String(row?.metadata_json?.isin ?? row.symbol ?? "").trim();
      if (!isin || byIsin.has(isin)) return;
      byIsin.set(isin, { isin, name: String(row.name || "").trim() || isin, mic: String(row?.metadata_json?.mic || "").trim() || undefined });
    });
    return [...byIsin.values()];
  }, [detectedNordea, validRows]);

  useEffect(() => {
    if (!detectedNordea) return;
    const defaults: Record<string, string> = {};
    resolverItems.forEach((item) => {
      defaults[item.isin] = tickerResolutions[item.isin] || "";
    });
    setTickerResolutions(defaults);
  }, [detectedNordea, resolverItems]);

  const resolveViaApi = useCallback(async (isin: string) => resolveIsin(isin), []);
  const resolveBatchViaApi = useCallback(async (isins: string[]) => resolveIsins(isins), []);

  useEffect(() => {
    if (!detectedNordea || step !== 3 || resolverItems.length === 0) return;

    let active = true;
    const runPrefetch = async () => {
      const unresolvedItems = resolverItems.filter((item) => !tickerResolutions[item.isin]?.trim());
      if (unresolvedItems.length === 0) return;

      const preResolved = await resolveBatchViaApi(unresolvedItems.map((item) => item.isin));

      if (!active) return;

      setTickerResolutions((prev) => {
        const next = { ...prev };
        unresolvedItems.forEach(({ isin }) => {
          const result = preResolved.get(String(isin || "").toUpperCase().trim());
          if (next[isin]?.trim()) return;
          if (result?.ticker) {
            next[isin] = formatResolvedTicker(String(result.ticker), String(result.exchange || ""));
          }
        });
        return next;
      });

      setTickerSuggestions((prev) => {
        const next = { ...prev };
        unresolvedItems.forEach(({ isin }) => {
          const result = preResolved.get(String(isin || "").toUpperCase().trim());
          if (result?.ticker) {
            const formatted = formatResolvedTicker(String(result.ticker), String(result.exchange || ""));
            next[isin] = [formatted];
          }
        });
        return next;
      });
    };

    runPrefetch().catch(() => {
      // non-blocking prefetch
    });

    return () => {
      active = false;
    };
  }, [detectedNordea, resolveBatchViaApi, resolverItems, step, tickerResolutions]);

  const retryResolve = useCallback(async (isin: string) => {
    setResolverStatus((prev) => ({ ...prev, [isin]: "resolving" }));
    setResolverErrors((prev) => ({ ...prev, [isin]: "" }));
    const result = await resolveViaApi(isin);
    if (result?.ticker) {
      const formatted = formatResolvedTicker(String(result.ticker), String(result.exchange || ""));
      setTickerResolutions((prev) => ({ ...prev, [isin]: formatted }));
      setTickerSuggestions((prev) => ({ ...prev, [isin]: [formatted] }));
      setResolverStatus((prev) => ({ ...prev, [isin]: "resolved" }));
      return;
    }

    setResolverStatus((prev) => ({ ...prev, [isin]: "manual_required" }));
    setResolverErrors((prev) => ({ ...prev, [isin]: String(result?.error || "unresolved") }));
  }, [resolveViaApi]);

  const fetchSuggestion = async (item: ResolverItem) => {
    await retryResolve(item.isin);
  };

  const defaultImportSummary: ImportSummary = { inserted: 0, updated: 0, skipped: 0, errors: 0 };

  const runSnapshotImport = async (targetPortfolioId: string, importRows: any[], importMode: ImportMode): Promise<ImportSummary> => {
    const { data, error } = await supabase.rpc("import_holdings_snapshot", {
      _portfolio_id: targetPortfolioId,
      _mode: importMode,
      _rows_json: importRows as any,
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

  const resetImport = () => {
    setStep(1);
    setRows([]);
    setDetectedNordea(false);
    setNordeaAccounts([]);
    setAccountSelections({});
    setTickerResolutions({});
    setTickerSuggestions({});
    setResolverStatus({});
    setResolverErrors({});
    setAllowManualNordeaImport(false);
    setPreviewResolution({});
    setImportWarning(null);
    setDetectedColumns([]);
    setImportManualInvalid(false);
    setLastImportSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const parseFile = async (payload: string | ArrayBuffer, fileFormat: ImportFormat) => {
    if (fileFormat === "xlsx") {
      const spreadsheet = parseExcelImport(payload as ArrayBuffer);
      const validated = validateImportRows(spreadsheet.holdings);
      setDetectedNordea(spreadsheet.detectedNordea);
      setRows(validated);

      if (spreadsheet.detectedNordea) {
        const groups = spreadsheet.nordeaAccounts ?? groupNordeaHoldingsByAccount(spreadsheet.holdings);
        setNordeaAccounts(groups);

        const { data: userPortfolios } = await supabase
          .from("portfolios")
          .select("id,name,base_currency")
          .order("created_at", { ascending: false });

        setExistingPortfolios(userPortfolios || []);
        const defaults: Record<string, AccountSelection> = {};
        groups.forEach((group) => {
          defaults[group.accountKey] = {
            target: "new",
            portfolioName: `Nordea - ${group.accountName}`,
            baseCurrency: group.baseCurrency || spreadsheet.baseCurrency || "SEK",
            visibility: "private",
          };
        });
        setAccountSelections(defaults);
      }

      setStep(3);
      return;
    }

    const parsed = fileFormat === "json" ? parseJSONImport(payload as string).holdings : parseCSV(payload as string);
    if (fileFormat === "csv") {
      const analysis = parseDelimitedFile(payload as string);
      setDetectedColumns(analysis.headers);
      const issue = detectHoldingsImportIssue(payload as string);
      if (issue) {
        setImportWarning(issue);
        if (issue.includes("transaction export")) return;
      } else {
        setImportWarning(null);
      }
    }
    setDetectedNordea(false);
    setNordeaAccounts([]);
    setAccountSelections({});
    setRows(validateImportRows(parsed));
    setStep(3);
  };

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        await parseFile(ev.target?.result as string | ArrayBuffer, format);
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



  useEffect(() => {
    const uniqueSymbols = detectedNordea
      ? [...new Set(validRows.map((row) => String(row?.metadata_json?.isin ?? row.symbol ?? "").toUpperCase().trim()).filter(Boolean))]
      : [...new Set(validRows.map((row) => String(row.symbol || "").toUpperCase().trim()).filter(Boolean))];
    if (uniqueSymbols.length === 0) {
      setPreviewResolution({});
      return;
    }

    let active = true;
    const nextState: Record<string, { status: SymbolResolutionStatus; reason?: string }> = {};
    const runResolution = async () => {
      if (detectedNordea) {
        const batchResults = await resolveBatchViaApi(uniqueSymbols);
        uniqueSymbols.forEach((symbol) => {
          const fallbackData = batchResults.get(symbol);
          const resolvedTicker = fallbackData?.ticker
            ? formatResolvedTicker(String(fallbackData.ticker), String(fallbackData.exchange || ""))
            : "";
          nextState[symbol] = resolvedTicker ? { status: "resolved" } : { status: "invalid", reason: String(fallbackData?.error || "no ticker suggestion") };
          if (resolvedTicker) {
            setTickerResolutions((prev) => {
              if (prev[symbol]?.trim()) return prev;
              return { ...prev, [symbol]: resolvedTicker };
            });
          }
        });
      } else {
        const queue = [...uniqueSymbols];
        const workers = Array.from({ length: Math.min(4, queue.length) }).map(async () => {
          while (queue.length) {
            const symbol = queue.shift();
            if (!symbol) break;
            const { data } = await supabase.functions.invoke("resolve-symbol", { body: { symbol } });
            const resolution = applyImportResolution(symbol, ((data?.candidates || []) as SymbolCandidate[]));
            nextState[symbol] = { status: resolution.status, reason: resolution.reason };
          }
        });
        await Promise.all(workers);
      }
    };

    runResolution().then(() => {
      if (active) setPreviewResolution(nextState);
    });

    return () => {
      active = false;
    };
  }, [detectedNordea, resolveBatchViaApi, validRows]);

  const runImport = async () => {
    setBusy(true);

    try {
      const hasInvalidPreview = invalidResolutionCount > 0;
      if (hasInvalidPreview && !importManualInvalid) {
        toast.error(`${invalidResolutionCount} symbol(s) are invalid/unresolvable in the Resolution column. Resolve them or choose import anyway as manual/unpriced.`);
        return;
      }

      if (!detectedNordea) {
        const summary = await runSnapshotImport(portfolioId, validRows, mode);
        setLastImportSummary(summary);
        await logAuditAction("import", "portfolio", portfolioId, {
          mode,
          valid_rows: validRows.length,
          total_rows: rows.length,
          ...summary,
        });
        onOpenChange(false);
        onImported();
        toast.success(`Import complete: ${summary.inserted} inserted, ${summary.updated} updated, ${summary.skipped} skipped, ${summary.errors} errors.`);
        return;
      }

      const unresolved = resolverItems.some((item) => !tickerResolutions[item.isin]?.trim());
      if (unresolved && !allowManualNordeaImport) {
        toast.error("Some ISINs are unresolved. Resolve them or confirm manual import for unresolved rows.");
        return;
      }

      const importRows = applyTickerResolutionsToRows(validRows, tickerResolutions);

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        toast.error("Could not identify user for Nordea import.");
        return;
      }

      let totalSummary: ImportSummary = { ...defaultImportSummary };
      for (const group of nordeaAccounts) {
        const selection = accountSelections[group.accountKey];
        if (!selection) continue;

        let targetPortfolioId = selection.target;
        if (selection.target === "new") {
          const { data: created, error } = await supabase.from("portfolios").insert({
            owner_user_id: userData.user.id,
            name: selection.portfolioName.trim(),
            base_currency: selection.baseCurrency,
            visibility: selection.visibility,
            broker: "nordea",
          }).select("id").single();

          if (error || !created?.id) {
            const technicalDetail = error?.message || "Portfolio insert returned no id.";
            const auditDetails = {
              broker: "nordea",
              account_key: group.accountKey,
              account_name: group.accountName,
              selection,
              visibility: selection.visibility,
              base_currency: selection.baseCurrency,
              import_mode: mode,
              technical_detail: technicalDetail,
            };

            await logAuditAction("import_portfolio_create_failed", "portfolio", undefined, auditDetails);
            console.error("Nordea portfolio create failed", auditDetails);

            const friendlyMessage = `Could not create portfolio for ${group.accountName}.`;
            const detailedMessage = `${friendlyMessage}: ${technicalDetail}`;
            toast.error(import.meta.env.DEV ? detailedMessage : friendlyMessage, {
              description: !import.meta.env.DEV ? "Open details for technical information." : undefined,
            });
            return;
          }

          targetPortfolioId = created.id;
        }

        const accountRows = importRows.filter((row) => row.account_key === group.accountKey);
        const summary = await runSnapshotImport(targetPortfolioId, accountRows, mode);
        totalSummary = {
          inserted: totalSummary.inserted + summary.inserted,
          updated: totalSummary.updated + summary.updated,
          skipped: totalSummary.skipped + summary.skipped,
          errors: totalSummary.errors + summary.errors,
        };
        await logAuditAction("import", "portfolio", targetPortfolioId, {
          mode,
          broker: "nordea",
          account_key: group.accountKey,
          valid_rows: accountRows.length,
          total_rows: rows.length,
          ...summary,
        });
      }

      setLastImportSummary(totalSummary);
      onOpenChange(false);
      onImported();
      toast.success(`Nordea import complete: ${totalSummary.inserted} inserted, ${totalSummary.updated} updated, ${totalSummary.skipped} skipped, ${totalSummary.errors} errors.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import failed.";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const allResolved = resolverItems.every((item) => tickerResolutions[item.isin]?.trim());
  const nordeaResolvedCount = useMemo(() => (
    resolverItems.filter((item) => Boolean(tickerResolutions[item.isin]?.trim())).length
  ), [resolverItems, tickerResolutions]);

  useEffect(() => {
    if (!detectedNordea || step !== 5 || resolverItems.length === 0) return;

    let active = true;
    const runPass = async () => {
      const unresolvedItems = resolverItems.filter((item) => !tickerResolutions[item.isin]?.trim());
      const alreadyResolvedItems = resolverItems.filter((item) => tickerResolutions[item.isin]?.trim());

      alreadyResolvedItems.forEach((item) => {
        const existingTicker = tickerResolutions[item.isin]?.trim();
        if (!existingTicker) return;
        setResolverStatus((prev) => ({ ...prev, [item.isin]: "resolved" }));
        setTickerSuggestions((prev) => ({ ...prev, [item.isin]: [existingTicker] }));
      });

      if (unresolvedItems.length === 0 || !active) return;

      setResolverStatus((prev) => ({
        ...prev,
        ...Object.fromEntries(unresolvedItems.map((item) => [item.isin, "resolving"] as const)),
      }));
      setResolverErrors((prev) => ({
        ...prev,
        ...Object.fromEntries(unresolvedItems.map((item) => [item.isin, ""] as const)),
      }));

      const batchResults = await resolveBatchViaApi(unresolvedItems.map((item) => item.isin));
      if (!active) return;

      unresolvedItems.forEach((item) => {
        const result = batchResults.get(String(item.isin || "").toUpperCase().trim());
        if (result?.ticker) {
          const formatted = formatResolvedTicker(String(result.ticker), String(result.exchange || ""));
          setTickerResolutions((prev) => ({ ...prev, [item.isin]: formatted }));
          setTickerSuggestions((prev) => ({ ...prev, [item.isin]: [formatted] }));
          setResolverStatus((prev) => ({ ...prev, [item.isin]: "resolved" }));
          return;
        }

        setResolverStatus((prev) => ({ ...prev, [item.isin]: "manual_required" }));
        setResolverErrors((prev) => ({ ...prev, [item.isin]: String(result?.error || "unresolved") }));
      });
    };

    runPass().catch(() => {
      // non-blocking: row-level status/error is set on each request path
    });

    return () => {
      active = false;
    };
  }, [detectedNordea, resolverItems, resolveBatchViaApi, step, tickerResolutions]);

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetImport(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Import holdings (Step {step}/{totalSteps})</DialogTitle></DialogHeader>

        {step === 1 && <div className="space-y-3"><p className="text-sm">Import mode: <span className="font-medium">Import holdings</span></p><p className="text-xs text-muted-foreground">Transaction files are not supported in this dialog. Use "Import transactions".</p><p className="text-sm">Choose file format.</p><Select value={format} onValueChange={(v) => setFormat(v as ImportFormat)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="csv">CSV (symbol,quantity required)</SelectItem><SelectItem value="json">JSON</SelectItem><SelectItem value="xlsx">Excel (.xlsx)</SelectItem></SelectContent></Select><div className="flex gap-2"><Button onClick={() => setStep(2)}>Continue</Button><Button variant="outline" onClick={resetImport}>Reset import</Button></div></div>}
        {step === 2 && <div className="space-y-3"><p className="text-sm">Upload your {format.toUpperCase()} file.</p><div className="border-dashed border rounded p-10 text-center cursor-pointer" onClick={() => fileInputRef.current?.click()}><Upload className="mx-auto mb-2" />Click to upload</div><input ref={fileInputRef} type="file" accept={format === "csv" ? ".csv" : format === "json" ? ".json" : ".xlsx"} className="hidden" onChange={onUpload} />{importWarning && <p className="text-sm text-destructive">{importWarning}</p>}{detectedColumns.length > 0 && <p className="text-xs text-muted-foreground">Detected columns: {detectedColumns.join(", ")}</p>}<div className="flex gap-2"><Button variant="outline" onClick={() => setStep(1)}>Back</Button><Button variant="outline" onClick={resetImport}>Reset import</Button></div></div>}

        {step === 3 && <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-sm">Preview and validation ({validRows.length}/{rows.length} valid)</p>
              {detectedNordea && <Badge variant="secondary">Nordea format detected</Badge>}
              {detectedNordea ? (
                <Badge variant={nordeaResolvedCount < resolverItems.length ? "secondary" : "outline"}>
                  ISIN mappings: {nordeaResolvedCount}/{resolverItems.length} prefilled
                </Badge>
              ) : (
                <Badge variant={invalidResolutionCount > 0 ? "destructive" : "outline"}>
                  Resolution: {resolvedPreviewCount}/{validRows.length} resolved
                </Badge>
              )}
            </div>
            <Select value={mode} onValueChange={(v) => setMode(v as ImportMode)}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="replace">Replace (default)</SelectItem><SelectItem value="merge">Merge</SelectItem></SelectContent></Select>
          </div>
          <p className="text-xs text-muted-foreground">
            {detectedNordea
              ? "Nordea ISIN ticker suggestions are prefetched now and prefilled for review in Step 5."
              : "Current mapping: symbol→symbol, quantity→quantity, avg cost→avg_cost"}
          </p><Table><TableHeader><TableRow><TableHead>Symbol</TableHead><TableHead>Qty</TableHead><TableHead>Avg cost</TableHead><TableHead>Row status</TableHead><TableHead>Ticker resolution</TableHead><TableHead /></TableRow></TableHeader><TableBody>{rows.map((r, i) => { const key = getPreviewResolutionKey(r); const resolution = previewResolution[key]; return <TableRow key={i}><TableCell>{r.symbol}</TableCell><TableCell>{r.quantity}</TableCell><TableCell>{r.avg_cost}</TableCell><TableCell>{r.valid ? <Badge>Valid</Badge> : <Badge variant="destructive">{r.errors[0]}</Badge>}</TableCell><TableCell>{resolution?.status === "resolved" ? <Badge>resolved</Badge> : resolution?.status === "ambiguous" ? <Badge variant="secondary">ambiguous</Badge> : resolution?.status === "invalid" ? <Badge variant="destructive">invalid</Badge> : <span className="text-xs text-muted-foreground">checking…</span>}</TableCell><TableCell>{!r.valid && <Button variant="ghost" size="sm" onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}><X className="h-4 w-4" /></Button>}</TableCell></TableRow>; })}</TableBody></Table>
          <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={importManualInvalid} onChange={(e) => setImportManualInvalid(e.target.checked)} />Import anyway as manual/unpriced for invalid symbols</label>
          <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(2)}>Back</Button><Button onClick={() => setStep(4)} disabled={validRows.length === 0}>Continue</Button></div>
        </div>}

        {detectedNordea && step === 4 && <div className="space-y-4">
          <p className="text-sm font-medium">Select destination portfolio(s)</p>
          {nordeaAccounts.map((account) => {
            const selection = accountSelections[account.accountKey];
            return (
              <div key={account.accountKey} className="border rounded p-3 space-y-2">
                <div className="text-sm font-medium">{account.accountName} ({account.accountKey})</div>
                <div className="text-xs text-muted-foreground">{account.holdingsCount} holdings · {account.marketValueBase == null ? "Market value n/a" : `${account.marketValueBase.toFixed(2)} ${account.baseCurrency}`}</div>
                <Select value={selection?.target || "new"} onValueChange={(v) => setAccountSelections((prev) => ({ ...prev, [account.accountKey]: { ...prev[account.accountKey], target: v } }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Create new portfolio</SelectItem>
                    {existingPortfolios.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>

                {selection?.target === "new" && <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div className="space-y-1"><Label>Portfolio name</Label><Input value={selection.portfolioName} onChange={(e) => setAccountSelections((prev) => ({ ...prev, [account.accountKey]: { ...prev[account.accountKey], portfolioName: e.target.value } }))} /></div>
                  <div className="space-y-1"><Label>Base currency</Label><Input value={selection.baseCurrency} onChange={(e) => setAccountSelections((prev) => ({ ...prev, [account.accountKey]: { ...prev[account.accountKey], baseCurrency: e.target.value.toUpperCase() } }))} /></div>
                  <div className="space-y-1"><Label>Visibility</Label><Select value={selection.visibility} onValueChange={(v) => setAccountSelections((prev) => ({ ...prev, [account.accountKey]: { ...prev[account.accountKey], visibility: v as Visibility } }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="private">Private</SelectItem><SelectItem value="authenticated">Logged-in</SelectItem><SelectItem value="group">Group</SelectItem><SelectItem value="public">Public</SelectItem></SelectContent></Select></div>
                </div>}
              </div>
            );
          })}
          <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(3)}>Back</Button><Button onClick={() => setStep(allResolved ? 6 : 5)}>{allResolved ? "Continue to import" : "Continue"}</Button></div>
        </div>}

        {detectedNordea && step === 5 && <div className="space-y-3">
          <p className="text-sm font-medium">Resolve tickers ({nordeaResolvedCount}/{resolverItems.length} mapped)</p>
          <Table><TableHeader><TableRow><TableHead>Name / ISIN</TableHead><TableHead>Status</TableHead><TableHead>Ticker (required)</TableHead><TableHead>Suggestions</TableHead></TableRow></TableHeader><TableBody>
            {resolverItems.map((item) => {
              const status = resolverStatus[item.isin] || "resolving";
              const value = tickerResolutions[item.isin] || "";
              const isResolved = Boolean(value.trim());
              return (
                <TableRow key={item.isin}>
                  <TableCell>
                    <div className="font-medium">{item.name}</div>
                    <div className="text-xs text-muted-foreground">{item.isin}</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {status === "resolved" || isResolved ? "✅ resolved" : status === "manual_required" ? "⚠ manual_required" : "⏳ resolving"}
                  </TableCell>
                  <TableCell>
                    <Input
                      value={value}
                      onChange={(e) => {
                        const next = normalizeTicker(e.target.value);
                        setTickerResolutions((prev) => ({ ...prev, [item.isin]: next }));
                        setResolverStatus((prev) => ({ ...prev, [item.isin]: next ? "resolved" : "manual_required" }));
                      }}
                      placeholder="e.g. AAPL"
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2 items-center">
                      <Button variant="outline" size="sm" onClick={() => fetchSuggestion(item)}>Suggest</Button>
                      {status === "resolving" ? (
                        <div className="text-xs">Resolving...</div>
                      ) : isResolved ? (
                        <div className="text-xs">{(tickerSuggestions[item.isin] || [value]).join(", ")}</div>
                      ) : (
                        <div className="text-xs">
                          No market data found{resolverErrors[item.isin] ? ` (${resolverErrors[item.isin]})` : ""} · fallback: {value || "UNKNOWN"}
                        </div>
                      )}
                      {status === "manual_required" && (
                        <Button variant="ghost" size="sm" onClick={() => retryResolve(item.isin)}>Retry</Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody></Table>
          {!allResolved && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={allowManualNordeaImport}
                onChange={(e) => setAllowManualNordeaImport(e.target.checked)}
              />
              Continue with manual import for unresolved rows
            </label>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(4)}>Back</Button>
            <Button onClick={() => setStep(6)} disabled={!allResolved && !allowManualNordeaImport}>Continue</Button>
          </div>
        </div>}

        {((!detectedNordea && step === 4) || (detectedNordea && step === 6)) && <div className="space-y-3"><p className="text-sm">You are about to {mode} holdings{detectedNordea ? " into selected portfolios" : " for this portfolio"}.</p>{lastImportSummary && <p className="text-xs text-muted-foreground">Last import summary: {lastImportSummary.inserted} inserted · {lastImportSummary.updated} updated · {lastImportSummary.skipped} skipped · {lastImportSummary.errors} errors</p>}<div className="flex gap-2"><Button onClick={runImport} disabled={busy}>{busy ? "Importing..." : "Run import"}</Button><Button variant="outline" onClick={resetImport}>Reset import</Button></div></div>}
      </DialogContent>
    </Dialog>
  );
}
